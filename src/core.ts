import type { StrusConfig } from "./config";
import { resolveConfig } from "./config";
import type { ExtractionResult } from "./extract";
import { extractMetadata } from "./extract";

export type TelemetryPayload = {
	id: string;
	endpointId: string;
	statusCode: number;
	metadata: ExtractionResult["signals"];
};

export type ObserveInput = {
	method: string;
	path: string;
	statusCode: number;
	responseBody: unknown;
};

export class StrusClient {
	readonly config: StrusConfig;
	private buffer: TelemetryPayload[] = [];
	private flushTimer: ReturnType<typeof setInterval> | null = null;
	private pendingFlush: Promise<void> | null = null;
	private shutdownPromise: Promise<void> | null = null;

	constructor(
		input: Pick<StrusConfig, "apiKey"> & Partial<Omit<StrusConfig, "apiKey">>,
	) {
		this.config = resolveConfig(input);
		if (this.config.enabled) {
			this.flushTimer = setInterval(
				() => this.flush(),
				this.config.flushIntervalMs,
			);
			if (typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
				(this.flushTimer as { unref: () => void }).unref();
			}
		}
	}

	observe(input: ObserveInput): void {
		if (!this.config.enabled) return;

		try {
			const result = extractMetadata(
				input.responseBody,
				input.statusCode,
				this.config.extraction,
			);

			const endpointId = `${input.method.toUpperCase()} ${input.path}`;

			this.buffer.push({
				id: crypto.randomUUID(),
				endpointId,
				statusCode: result.statusCode,
				metadata: result.signals,
			});

			if (this.buffer.length >= this.config.batchSize) {
				this.flush();
			}
		} catch (error) {
			this.config.onError(error);
		}
	}

	flush(): void {
		if (this.pendingFlush || this.buffer.length === 0) return;

		const batch = this.buffer.splice(0);
		this.pendingFlush = this.sendBatch(batch).finally(() => {
			this.pendingFlush = null;
		});
	}

	flushAsync(): Promise<void> {
		if (this.buffer.length === 0) {
			return this.pendingFlush ?? Promise.resolve();
		}

		const batch = this.buffer.splice(0);

		const pending = this.pendingFlush
			? this.pendingFlush.then(() => this.sendBatch(batch))
			: this.sendBatch(batch);

		this.pendingFlush = pending.finally(() => {
			if (this.pendingFlush === pending) {
				this.pendingFlush = null;
			}
		});

		return this.pendingFlush;
	}

	async shutdown(): Promise<void> {
		if (this.shutdownPromise) return this.shutdownPromise;

		this.shutdownPromise = this.performShutdown();
		return this.shutdownPromise;
	}

	private async performShutdown(): Promise<void> {
		if (this.flushTimer) {
			clearInterval(this.flushTimer);
			this.flushTimer = null;
		}

		await this.flushAsync();
	}

	private async sendBatch(batch: TelemetryPayload[]): Promise<void> {
		try {
			const response = await fetch(this.config.endpoint, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.config.apiKey,
				},
				body: JSON.stringify({ events: batch }),
			});

			if (!response.ok) {
				this.config.onError(
					new Error(
						`Strus ingestion failed: ${response.status} ${response.statusText}`,
					),
				);
			}
		} catch (error) {
			this.config.onError(error);
		}
	}
}
