export type { StrusConfig } from "./config";
export { DEFAULT_CONFIG, DEFAULT_ENDPOINT, resolveConfig } from "./config";
export type { ObserveInput, TelemetryPayload } from "./core";
export { StrusClient } from "./core";
export type {
	ExtractionConfig,
	ExtractionResult,
	FieldSignal,
	FieldSignalValue,
	SignalType,
} from "./extract";
export {
	DEFAULT_EXTRACTION_CONFIG,
	extractMetadata,
	mergeConfig as mergeExtractionConfig,
} from "./extract";
