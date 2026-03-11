import { afterEach, describe, expect, mock, test } from "bun:test";
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

describe("StrusClient", () => {
	let client: StrusClient;

	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test("observe extracts metadata and buffers it", () => {
		client = createClient();

		client.observe({
			method: "GET",
			path: "/api/patients",
			statusCode: 200,
			responseBody: {
				patients: [
					{ id: "1", name: "Alice", ssn: null },
					{ id: "2", name: "Bob", ssn: null },
				],
			},
		});

		expect((client as any).buffer).toHaveLength(1);
		const event = (client as any).buffer[0];
		expect(event.endpointId).toBe("GET /api/patients");
		expect(event.statusCode).toBe(200);
		expect(event.metadata.length).toBeGreaterThan(0);
	});

	test("observe does nothing when disabled", () => {
		client = createClient({ enabled: false });

		client.observe({
			method: "GET",
			path: "/api/test",
			statusCode: 200,
			responseBody: { ok: true },
		});

		expect((client as any).buffer).toHaveLength(0);
	});

	test("flush sends batch to endpoint", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(
				new Response(JSON.stringify({ ingested: 1 }), { status: 200 }),
			),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();

			client.observe({
				method: "POST",
				path: "/api/claims",
				statusCode: 201,
				responseBody: { id: "claim-1", status: "pending" },
			});

			client.flush();
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(fetchMock).toHaveBeenCalledTimes(1);
			const [url, options] = fetchMock.mock.calls[0] as unknown as [
				string,
				RequestInit,
			];
			expect(url).toBe(FAKE_ENDPOINT);
			expect(options.method).toBe("POST");
			expect(options.headers).toEqual({
				"Content-Type": "application/json",
				"x-api-key": "test-key",
			});

			const body = JSON.parse(options.body as string);
			expect(body.events).toHaveLength(1);
			expect(body.events[0].endpointId).toBe("POST /api/claims");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("auto flushes when batchSize reached", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient({ batchSize: 3 });

			client.observe({
				method: "GET",
				path: "/1",
				statusCode: 200,
				responseBody: { a: 1 },
			});
			client.observe({
				method: "GET",
				path: "/2",
				statusCode: 200,
				responseBody: { b: 2 },
			});

			expect(fetchMock).not.toHaveBeenCalled();

			client.observe({
				method: "GET",
				path: "/3",
				statusCode: 200,
				responseBody: { c: 3 },
			});

			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(fetchMock).toHaveBeenCalledTimes(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("calls onError when fetch fails", async () => {
		const errors: unknown[] = [];
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.reject(new Error("network down")),
		) as any;

		try {
			client = createClient({ onError: (e: unknown) => errors.push(e) });

			client.observe({
				method: "GET",
				path: "/api/test",
				statusCode: 200,
				responseBody: { ok: true },
			});

			client.flush();
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(errors).toHaveLength(1);
			expect((errors[0] as Error).message).toBe("network down");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("shutdown flushes remaining buffer", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();

			client.observe({
				method: "GET",
				path: "/api/final",
				statusCode: 200,
				responseBody: { done: true },
			});

			await client.shutdown();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect((client as any).buffer).toHaveLength(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("endpointId normalizes method to uppercase", () => {
		client = createClient();

		client.observe({
			method: "get",
			path: "/api/lowercase",
			statusCode: 200,
			responseBody: {},
		});

		const event = (client as any).buffer[0];
		expect(event.endpointId).toBe("GET /api/lowercase");
	});
});

describe("flushAsync", () => {
	let client: StrusClient;

	afterEach(async () => {
		if (client) await client.shutdown();
	});

	test("sends all buffered events and awaits completion", async () => {
		const fetchMock = mock(() =>
			Promise.resolve(new Response("{}", { status: 200 })),
		);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();

			client.observe({
				method: "GET",
				path: "/api/data",
				statusCode: 200,
				responseBody: { ok: true },
			});

			await client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);
			expect((client as any).buffer).toHaveLength(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("resolves immediately when buffer is empty", async () => {
		client = createClient();
		await client.flushAsync();
	});

	test("waits for in-flight flush before sending new batch", async () => {
		const calls: string[] = [];
		let resolveFirst: () => void;
		const firstCall = new Promise<void>((r) => {
			resolveFirst = r;
		});

		const fetchMock = mock(() => {
			calls.push("fetch");
			if (calls.length === 1) {
				return firstCall.then(() => new Response("{}", { status: 200 }));
			}
			return Promise.resolve(new Response("{}", { status: 200 }));
		});
		const originalFetch = globalThis.fetch;
		globalThis.fetch = fetchMock as any;

		try {
			client = createClient();

			client.observe({
				method: "GET",
				path: "/1",
				statusCode: 200,
				responseBody: { a: 1 },
			});

			const first = client.flushAsync();

			client.observe({
				method: "GET",
				path: "/2",
				statusCode: 200,
				responseBody: { b: 2 },
			});

			const second = client.flushAsync();

			expect(fetchMock).toHaveBeenCalledTimes(1);

			resolveFirst!();
			await first;
			await second;

			expect(fetchMock).toHaveBeenCalledTimes(2);
			expect((client as any).buffer).toHaveLength(0);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
