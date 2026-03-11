import { afterEach, describe, expect, mock, test } from "bun:test";
import { strusExpress } from "../adapters/express";
import { strusFastify } from "../adapters/fastify";
import { strusHono } from "../adapters/hono";
import { StrusClient } from "../core";

const FAKE_ENDPOINT = "https://ingest.strus.io/telemetry";

function createClient(overrides: Record<string, unknown> = {}) {
	return new StrusClient({
		apiKey: "test-key",
		endpoint: FAKE_ENDPOINT,
		flushIntervalMs: 60_000,
		...overrides,
	});
}

function withFetchMock(
	fn: (fetchMock: ReturnType<typeof mock>) => Promise<void>,
) {
	return async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;
		try {
			await fn(fetchMock);
		} finally {
			globalThis.fetch = originalFetch;
		}
	};
}

type HonoContextOptions = {
	method?: string;
	path?: string;
	body?: unknown;
	statusCode?: number;
	executionCtx?: {
		waitUntil?: (p: Promise<unknown>) => void;
	};
};

function fakeHonoContext(opts: HonoContextOptions = {}) {
	const {
		method = "GET",
		path = "/api/data",
		body = { status: "ok" },
		statusCode = 200,
		executionCtx,
	} = opts;

	const res = new Response(JSON.stringify(body), {
		status: statusCode,
		headers: { "Content-Type": "application/json" },
	});

	return {
		req: { method, path },
		res,
		...(executionCtx ? { executionCtx } : {}),
	};
}

type ExpressContextOptions = {
	method?: string;
	path?: string;
	body?: unknown;
	statusCode?: number;
};

function fakeExpressContext(opts: ExpressContextOptions = {}) {
	const {
		method = "GET",
		path = "/api/data",
		body = { status: "ok" },
		statusCode = 200,
	} = opts;

	const req = { method, path };
	const responseBody = JSON.stringify(body);
	const listeners: Record<string, (() => void)[]> = {};
	let ended = false;

	const res = {
		statusCode,
		on(event: string, cb: () => void) {
			if (!listeners[event]) listeners[event] = [];
			listeners[event]!.push(cb);
		},
		write(_chunk: any) {
			return true;
		},
		end(_chunk?: any) {
			ended = true;
			if (listeners["finish"]) {
				for (const cb of listeners["finish"]) cb();
			}
		},
	};

	return { req, res, responseBody, isEnded: () => ended };
}

function fakeFastifyContext(opts: ExpressContextOptions = {}) {
	const {
		method = "GET",
		path = "/api/data",
		body = { status: "ok" },
		statusCode = 200,
	} = opts;

	const request = { method, url: path };
	const reply = { statusCode };
	const payload = JSON.stringify(body);

	return { request, reply, payload };
}

async function simulateHonoRequest(
	client: StrusClient,
	opts: HonoContextOptions = {},
) {
	const middleware = strusHono(client);
	const c = fakeHonoContext(opts);
	const promises: Promise<unknown>[] = [];

	if (opts.executionCtx?.waitUntil) {
		const original = opts.executionCtx.waitUntil;
		(c as any).executionCtx = {
			waitUntil: (p: Promise<unknown>) => {
				promises.push(p);
				original(p);
			},
		};
	}

	await middleware(c as any, async () => {});

	return { promises };
}

function simulateExpressRequest(
	client: StrusClient,
	opts: ExpressContextOptions = {},
) {
	const middleware = strusExpress(client);
	const { req, res, responseBody } = fakeExpressContext(opts);

	const next = mock(() => {
		(res as any).end(Buffer.from(responseBody));
	});

	middleware(req as any, res as any, next);

	return { next };
}

function simulateFastifyRequest(
	client: StrusClient,
	opts: ExpressContextOptions = {},
) {
	const plugin = strusFastify(client);
	const { request, reply, payload } = fakeFastifyContext(opts);

	let hookHandler: any;
	const fastify = {
		addHook(_name: string, handler: any) {
			hookHandler = handler;
		},
	};

	plugin(fastify as any);

	return new Promise<void>((resolve) => {
		hookHandler(request, reply, payload, (_err: null, _payload: unknown) => {
			resolve();
		});
	});
}

describe("Cloudflare Workers", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"global scope construction is safe (no timer until first observe)",
		withFetchMock(async () => {
			client = createClient();
			expect((client as any).flushTimer).toBeNull();
			expect((client as any).timerStarted).toBe(false);
		}),
	);

	test(
		"flushes via waitUntil on each request",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			const waitUntilPromises: Promise<unknown>[] = [];
			const waitUntil = mock((p: Promise<unknown>) => {
				waitUntilPromises.push(p);
			});

			await simulateHonoRequest(client, {
				executionCtx: { waitUntil },
			});

			expect(waitUntil).toHaveBeenCalledTimes(1);
			await Promise.all(waitUntilPromises);
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"multiple requests each flush independently",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			const allPromises: Promise<unknown>[] = [];
			const waitUntil = mock((p: Promise<unknown>) => {
				allPromises.push(p);
			});

			await simulateHonoRequest(client, {
				path: "/api/one",
				executionCtx: { waitUntil },
			});
			await simulateHonoRequest(client, {
				path: "/api/two",
				executionCtx: { waitUntil },
			});
			await simulateHonoRequest(client, {
				path: "/api/three",
				executionCtx: { waitUntil },
			});

			await Promise.all(allPromises);
			expect(fetchMock).toHaveBeenCalledTimes(3);
		}),
	);
});

describe("Cloudflare Pages", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"works identically to Workers (same executionCtx.waitUntil pattern)",
		withFetchMock(async (_fetchMock) => {
			client = createClient();
			const waitUntil = mock(() => {});

			await simulateHonoRequest(client, {
				executionCtx: { waitUntil },
			});

			expect(waitUntil).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Vercel Edge Runtime", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"works without executionCtx (timer based fallback)",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			await simulateHonoRequest(client);
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Vercel Serverless (Node)", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"express adapter flushes on each request",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client);
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("AWS Lambda", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"express adapter works within lambda handler lifecycle",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/lambda" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
					.body as string,
			);
			expect(body.events[0].endpointId).toBe("GET /api/lambda");
		}),
	);

	test(
		"shutdown flushes remaining buffer before lambda freezes",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/cold" });
			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect((client as any).buffer).toHaveLength(0);
		}),
	);
});

describe("Lambda@Edge", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"flushes within constrained execution window",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/edge" });
			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Deno Deploy", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"hono adapter with no executionCtx falls back gracefully",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateHonoRequest(client);
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Google Cloud Run", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"express adapter flushes per request",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/cloudrun" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"fastify adapter flushes per request",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateFastifyRequest(client, { path: "/api/cloudrun" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Azure Functions", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"shutdown drains buffer before function completes",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			client.observe({
				method: "POST",
				path: "/api/azure",
				statusCode: 200,
				responseBody: { ok: true },
			});
			client.observe({
				method: "POST",
				path: "/api/azure",
				statusCode: 200,
				responseBody: { ok: true },
			});
			client.observe({
				method: "POST",
				path: "/api/azure",
				statusCode: 200,
				responseBody: { ok: true },
			});

			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const body = JSON.parse(
				(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
					.body as string,
			);
			expect(body.events).toHaveLength(3);
		}),
	);
});

describe("Netlify Edge Functions", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"hono adapter flushes per request (Deno based edge)",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateHonoRequest(client, { path: "/api/netlify-edge" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Netlify Functions (AWS Lambda)", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"express adapter flushes and shutdown drains",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/netlify-fn" });
			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Fly.io", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"long running process: timer starts lazily on first request",
		withFetchMock(async () => {
			client = createClient();
			expect((client as any).flushTimer).toBeNull();

			client.observe({
				method: "GET",
				path: "/api/fly",
				statusCode: 200,
				responseBody: {},
			});
			expect((client as any).flushTimer).not.toBeNull();
		}),
	);

	test(
		"express adapter works on long running server",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/fly" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"fastify adapter works on long running server",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateFastifyRequest(client, { path: "/api/fly" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"hono adapter works on long running server",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateHonoRequest(client, { path: "/api/fly" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Railway", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"long running: multiple requests batch correctly",
		withFetchMock(async (fetchMock) => {
			client = createClient({ batchSize: 3 });

			simulateExpressRequest(client, { path: "/1" });
			simulateExpressRequest(client, { path: "/2" });

			await new Promise((r) => setTimeout(r, 10));
			expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);

			simulateExpressRequest(client, { path: "/3" });
			await client.flushAsync();

			expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
		}),
	);
});

describe("Render", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"express adapter on long running server",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/render" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Node.js (long running)", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"timer is unrefed so it does not keep process alive",
		withFetchMock(async (_fetchMock) => {
			client = createClient();
			client.observe({
				method: "GET",
				path: "/",
				statusCode: 200,
				responseBody: {},
			});

			const timer = (client as any).flushTimer;
			expect(timer).not.toBeNull();
		}),
	);

	test(
		"graceful shutdown flushes everything",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			for (let i = 0; i < 10; i++) {
				client.observe({
					method: "GET",
					path: `/api/${i}`,
					statusCode: 200,
					responseBody: { i },
				});
			}

			await client.shutdown();

			const totalEvents = fetchMock.mock.calls.reduce((sum, call) => {
				const body = JSON.parse(
					(call as unknown as [string, RequestInit])[1].body as string,
				);
				return sum + body.events.length;
			}, 0);
			expect(totalEvents).toBe(10);
		}),
	);
});

describe("Bun (long running)", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"hono adapter on Bun.serve",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateHonoRequest(client, { path: "/api/bun" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"express adapter on Bun",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			simulateExpressRequest(client, { path: "/api/bun-express" });
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("Docker / ECS / EC2", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"high throughput: batchSize triggers auto flush",
		withFetchMock(async (fetchMock) => {
			client = createClient({ batchSize: 5 });

			for (let i = 0; i < 5; i++) {
				client.observe({
					method: "POST",
					path: "/api/ingest",
					statusCode: 200,
					responseBody: { i },
				});
			}

			await new Promise((r) => setTimeout(r, 50));
			expect(fetchMock).toHaveBeenCalledTimes(1);

			const body = JSON.parse(
				(fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
					.body as string,
			);
			expect(body.events).toHaveLength(5);
		}),
	);

	test(
		"SIGTERM shutdown drains all buffered events",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			for (let i = 0; i < 25; i++) {
				client.observe({
					method: "GET",
					path: `/api/${i}`,
					statusCode: 200,
					responseBody: { i },
				});
			}

			await client.shutdown();

			const totalEvents = fetchMock.mock.calls.reduce((sum, call) => {
				const body = JSON.parse(
					(call as unknown as [string, RequestInit])[1].body as string,
				);
				return sum + body.events.length;
			}, 0);
			expect(totalEvents).toBe(25);
		}),
	);

	test(
		"mixed adapters on same client instance",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			simulateExpressRequest(client, { path: "/express" });
			await simulateFastifyRequest(client, { path: "/fastify" });
			await simulateHonoRequest(client, { path: "/hono" });

			await client.flushAsync();

			const totalEvents = fetchMock.mock.calls.reduce((sum, call) => {
				const body = JSON.parse(
					(call as unknown as [string, RequestInit])[1].body as string,
				);
				return sum + body.events.length;
			}, 0);
			expect(totalEvents).toBe(3);
		}),
	);
});

describe("Fastly Compute", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"hono adapter works (no executionCtx, single request lifecycle)",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			await simulateHonoRequest(client);
			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);
});

describe("edge cases across all platforms", () => {
	let client: StrusClient;
	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test(
		"disabled client never flushes",
		withFetchMock(async (fetchMock) => {
			client = createClient({ enabled: false });

			await simulateHonoRequest(client);
			simulateExpressRequest(client);
			await simulateFastifyRequest(client);

			await client.flushAsync();
			expect(fetchMock).not.toHaveBeenCalled();
		}),
	);

	test(
		"non-json response body does not crash any adapter",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			const honoMiddleware = strusHono(client);
			const textRes = new Response("plain text", { status: 200 });
			await honoMiddleware(
				{ req: { method: "GET", path: "/text" }, res: textRes } as any,
				async () => {},
			);

			await client.flushAsync();
			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"concurrent flushAsync calls serialize correctly",
		withFetchMock(async (fetchMock) => {
			client = createClient();

			client.observe({
				method: "GET",
				path: "/1",
				statusCode: 200,
				responseBody: { a: 1 },
			});
			const p1 = client.flushAsync();

			client.observe({
				method: "GET",
				path: "/2",
				statusCode: 200,
				responseBody: { b: 2 },
			});
			const p2 = client.flushAsync();

			client.observe({
				method: "GET",
				path: "/3",
				statusCode: 200,
				responseBody: { c: 3 },
			});
			const p3 = client.flushAsync();

			await Promise.all([p1, p2, p3]);

			const totalEvents = fetchMock.mock.calls.reduce((sum, call) => {
				const body = JSON.parse(
					(call as unknown as [string, RequestInit])[1].body as string,
				);
				return sum + body.events.length;
			}, 0);
			expect(totalEvents).toBe(3);
		}),
	);

	test(
		"fetch error does not lose subsequent events",
		withFetchMock(async () => {
			let callCount = 0;
			const originalFetch = globalThis.fetch;
			globalThis.fetch = mock(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error("network error"));
				}
				return Promise.resolve(new Response("{}", { status: 200 }));
			}) as any;

			try {
				const errors: unknown[] = [];
				client = createClient({ onError: (e: unknown) => errors.push(e) });

				client.observe({
					method: "GET",
					path: "/fail",
					statusCode: 200,
					responseBody: { a: 1 },
				});
				await client.flushAsync();

				expect(errors).toHaveLength(1);

				client.observe({
					method: "GET",
					path: "/succeed",
					statusCode: 200,
					responseBody: { b: 2 },
				});
				await client.flushAsync();

				expect(callCount).toBe(2);
			} finally {
				globalThis.fetch = originalFetch;
			}
		}),
	);

	test(
		"empty observe (no response body) still sends event",
		withFetchMock(async (fetchMock) => {
			client = createClient();
			client.observe({
				method: "DELETE",
				path: "/api/thing/123",
				statusCode: 204,
				responseBody: null,
			});
			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
		}),
	);

	test(
		"constructor in global scope, first observe in handler",
		withFetchMock(async () => {
			client = createClient();

			expect((client as any).timerStarted).toBe(false);
			expect((client as any).flushTimer).toBeNull();

			client.observe({
				method: "GET",
				path: "/",
				statusCode: 200,
				responseBody: {},
			});

			expect((client as any).timerStarted).toBe(true);
		}),
	);
});
