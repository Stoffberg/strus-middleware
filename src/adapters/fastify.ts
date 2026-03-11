import type { StrusClient } from "../core";

type FastifyRequest = {
	method: string;
	url: string;
};

type FastifyReply = {
	statusCode: number;
};

type FastifyInstance = {
	addHook: (
		hook: string,
		handler: (
			request: FastifyRequest,
			reply: FastifyReply,
			payload: unknown,
			done: (err: null, payload: unknown) => void,
		) => void,
	) => void;
};

type FastifyPluginDone = (err?: Error) => void;

export function strusFastify(client: StrusClient) {
	return (
		fastify: FastifyInstance,
		_opts: unknown,
		done: FastifyPluginDone,
	) => {
		fastify.addHook(
			"onSend",
			(
				request: FastifyRequest,
				reply: FastifyReply,
				payload: unknown,
				hookDone: (err: null, payload: unknown) => void,
			) => {
				if (!client.config.enabled) {
					hookDone(null, payload);
					return;
				}

				try {
					const body =
						typeof payload === "string" ? JSON.parse(payload) : payload;

					const url = new URL(request.url, "http://localhost");
					client.observe({
						method: request.method,
						path: url.pathname,
						statusCode: reply.statusCode,
						responseBody: body,
					});
				} catch {
					const url = new URL(request.url, "http://localhost");
					client.observe({
						method: request.method,
						path: url.pathname,
						statusCode: reply.statusCode,
						responseBody: null,
					});
				}

				client.flushAsync();

				hookDone(null, payload);
			},
		);

		done();
	};
}
