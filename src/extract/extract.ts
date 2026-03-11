import { DEFAULT_EXTRACTION_CONFIG, mergeConfig } from "./config";
import { walkFields } from "./fields";
import type { ExtractionConfig, ExtractionResult, FieldSignal } from "./types";

export function extractMetadata(
	responseBody: unknown,
	statusCode: number,
	configOverrides?: Partial<ExtractionConfig>,
): ExtractionResult {
	const config = configOverrides
		? mergeConfig(configOverrides)
		: DEFAULT_EXTRACTION_CONFIG;

	let signals: FieldSignal[];

	try {
		signals = walkFields(responseBody, config);
	} catch {
		signals = [];
	}

	return {
		statusCode,
		signals,
	};
}
