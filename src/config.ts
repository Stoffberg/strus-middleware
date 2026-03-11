import type { ExtractionConfig } from "./extract";

export type StrusConfig = {
	apiKey: string;
	endpoint: string;
	batchSize: number;
	flushIntervalMs: number;
	extraction: Partial<ExtractionConfig>;
	enabled: boolean;
	onError: (error: unknown) => void;
};

export const DEFAULT_ENDPOINT = "https://strus.io/api/telemetry/ingest";

export const DEFAULT_CONFIG: Omit<StrusConfig, "apiKey"> = {
	endpoint: DEFAULT_ENDPOINT,
	batchSize: 50,
	flushIntervalMs: 5_000,
	extraction: {},
	enabled: true,
	onError: () => {},
};

export function resolveConfig(
	input: Pick<StrusConfig, "apiKey"> & Partial<Omit<StrusConfig, "apiKey">>,
): StrusConfig {
	return {
		...DEFAULT_CONFIG,
		...input,
	};
}
