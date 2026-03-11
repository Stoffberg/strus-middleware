import type { StrusClient } from "../core";

type HonoContext = {
	req: {
		method: string;
		path: string;
	};
	res: {
		status: number;
	};
	executionCtx?: {
		waitUntil?: (promise: Promise<unknown>) => void;
	};
};

type HonoNext = () => Promise<void>;

export function strusHono(client: StrusClient) {
	return async (c: HonoContext, next: HonoNext) => {
		if (!client.config.enabled) {
			await next();
			return;
		}

		await next();

		try {
			const response = c.res as unknown as Response;
			const cloned = response.clone();
			const body = await cloned.json();

			client.observe({
				method: c.req.method,
				path: c.req.path,
				statusCode: c.res.status,
				responseBody: body,
			});
		} catch {
			client.observe({
				method: c.req.method,
				path: c.req.path,
				statusCode: c.res.status,
				responseBody: null,
			});
		}

		const waitUntil = c.executionCtx?.waitUntil;
		if (waitUntil) {
			waitUntil.call(c.executionCtx, client.flushAsync());
		}
	};
}
