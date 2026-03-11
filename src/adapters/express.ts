import type { StrusClient } from "../core";

type ExpressRequest = {
	method: string;
	path: string;
};

type ExpressResponse = {
	statusCode: number;
	on: (event: string, callback: () => void) => void;
};

type ExpressNextFunction = () => void;

export function strusExpress(client: StrusClient) {
	const chunks: Map<ExpressResponse, Buffer[]> = new Map();

	return (
		req: ExpressRequest,
		res: ExpressResponse,
		next: ExpressNextFunction,
	) => {
		if (!client.config.enabled) {
			next();
			return;
		}

		const originalWrite = (res as any).write;
		const originalEnd = (res as any).end;
		const responseChunks: Buffer[] = [];
		chunks.set(res, responseChunks);

		(res as any).write = function (chunk: any, ...args: any[]) {
			if (chunk) {
				responseChunks.push(
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
				);
			}
			return originalWrite.apply(this, [chunk, ...args]);
		};

		(res as any).end = function (chunk: any, ...args: any[]) {
			if (chunk) {
				responseChunks.push(
					Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
				);
			}

			chunks.delete(res);

			try {
				const body = Buffer.concat(responseChunks).toString("utf-8");
				const parsed = JSON.parse(body);
				client.observe({
					method: req.method,
					path: req.path,
					statusCode: res.statusCode,
					responseBody: parsed,
				});
			} catch {
				client.observe({
					method: req.method,
					path: req.path,
					statusCode: res.statusCode,
					responseBody: null,
				});
			}

			return originalEnd.apply(this, [chunk, ...args]);
		};

		next();
	};
}
