import { PHI_PII_PATTERNS } from "./patterns";
import type { ExtractionConfig } from "./types";

export const DEFAULT_EXTRACTION_CONFIG: ExtractionConfig = {
	excludePaths: [],
	excludePatterns: PHI_PII_PATTERNS,
	maxDepth: 10,
	maxArraySample: 5,
	maxEnumCardinality: 50,
};

export function mergeConfig(
	overrides: Partial<ExtractionConfig>,
): ExtractionConfig {
	return {
		...DEFAULT_EXTRACTION_CONFIG,
		...overrides,
		excludePatterns: [
			...DEFAULT_EXTRACTION_CONFIG.excludePatterns,
			...(overrides.excludePatterns || []),
		],
		excludePaths: [
			...DEFAULT_EXTRACTION_CONFIG.excludePaths,
			...(overrides.excludePaths || []),
		],
	};
}
