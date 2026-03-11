import type { StrusClient } from "../core";

type NextRequest = Request & {
	method: string;
	nextUrl?: { pathname: string };
	url: string;
};

type RouteHandler = (
	req: NextRequest,
	ctx?: unknown,
) => Response | Promise<Response>;

type NextFetchEvent = {
	waitUntil?: (promise: Promise<unknown>) => void;
};

function getWaitUntil(): ((promise: Promise<unknown>) => void) | undefined {
	try {
		const ctx = (globalThis as any)[Symbol.for("@next/request-context")];
		const value = ctx?.get?.();
		return value?.waitUntil;
	} catch {
		return undefined;
	}
}

function getPathname(req: NextRequest): string {
	if (req.nextUrl?.pathname) return req.nextUrl.pathname;

	try {
		return new URL(req.url).pathname;
	} catch {
		return req.url;
	}
}

export function strusNextjs(client: StrusClient) {
	function wrapHandler(handler: RouteHandler): RouteHandler {
		return async (req: NextRequest, ctx?: unknown) => {
			if (!client.config.enabled) {
				return handler(req, ctx);
			}

			const response = await handler(req, ctx);

			const path = getPathname(req);

			try {
				const cloned = response.clone();
				const body = await cloned.json();

				client.observe({
					method: req.method,
					path,
					statusCode: response.status,
					responseBody: body,
				});
			} catch {
				client.observe({
					method: req.method,
					path,
					statusCode: response.status,
					responseBody: null,
				});
			}

			const flush = client.flushAsync();

			const event = ctx as NextFetchEvent | undefined;
			if (event?.waitUntil) {
				event.waitUntil(flush);
			} else {
				const waitUntil = getWaitUntil();
				if (waitUntil) {
					waitUntil(flush);
				}
			}

			return response;
		};
	}

	return { wrapHandler };
}
