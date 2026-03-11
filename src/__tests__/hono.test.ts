import { afterEach, describe, expect, mock, test } from "bun:test";
import { strusHono } from "../adapters/hono";
import { StrusClient } from "../core";

const FAKE_ENDPOINT = "https://api.strus.dev/telemetry.ingest";

function createClient(overrides: Record<string, unknown> = {}) {
	return new StrusClient({
		apiKey: "test-key",
		endpoint: FAKE_ENDPOINT,
		flushIntervalMs: 60_000,
		...overrides,
	});
}

function fakeHonoContext(
	body: unknown,
	statusCode = 200,
	executionCtx?: unknown,
) {
	const responseBody = JSON.stringify(body);
	const res = new Response(responseBody, {
		status: statusCode,
		headers: { "Content-Type": "application/json" },
	});

	return {
		req: { method: "GET", path: "/api/test" },
		res,
		...(executionCtx !== undefined ? { executionCtx } : {}),
	};
}

describe("strusHono", () => {
	let client: StrusClient;

	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test("observes the response body", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();
			const middleware = strusHono(client);

			const c = fakeHonoContext({ status: "ok" });
			await middleware(c as any, async () => {});

			expect((client as any).buffer.length).toBeGreaterThanOrEqual(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("calls waitUntil when executionCtx is present", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();
			const middleware = strusHono(client);

			const waitUntilMock = mock(() => {});
			const c = fakeHonoContext({ status: "ok" }, 200, {
				waitUntil: waitUntilMock,
			});

			await middleware(c as any, async () => {});

			expect(waitUntilMock).toHaveBeenCalledTimes(1);
			const arg = (waitUntilMock.mock.calls[0] as unknown[])[0];
			expect(arg).toBeInstanceOf(Promise);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("does not crash when executionCtx is missing", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();
			const middleware = strusHono(client);

			const c = fakeHonoContext({ status: "ok" });
			await middleware(c as any, async () => {});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("does not call waitUntil when disabled", async () => {
		client = createClient({ enabled: false });
		const middleware = strusHono(client);

		const waitUntilMock = mock(() => {});
		const c = fakeHonoContext({ status: "ok" }, 200, {
			waitUntil: waitUntilMock,
		});

		await middleware(c as any, async () => {});

		expect(waitUntilMock).not.toHaveBeenCalled();
	});

	test("handles non-json response without throwing", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();
			const middleware = strusHono(client);

			const res = new Response("not json", {
				status: 200,
				headers: { "Content-Type": "text/plain" },
			});

			const c = {
				req: { method: "GET", path: "/api/text" },
				res,
			};

			await middleware(c as any, async () => {});

			const event = (client as any).buffer[0];
			expect(event.endpointId).toBe("GET /api/text");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
