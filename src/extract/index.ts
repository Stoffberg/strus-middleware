export { DEFAULT_EXTRACTION_CONFIG, mergeConfig } from "./config";
export { extractMetadata } from "./extract";
export { walkFields } from "./fields";
export { isExcludedPath, PHI_PII_PATTERNS } from "./patterns";
export {
	extractArraySignal,
	extractEnumSignal,
	extractNewValueSignal,
	extractNullSignal,
	isLikelyEnum,
} from "./signals";
export type {
	ExtractionConfig,
	ExtractionResult,
	FieldSignal,
	FieldSignalValue,
	SignalType,
} from "./types";
