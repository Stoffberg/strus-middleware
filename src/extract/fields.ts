import { isExcludedPath } from "./patterns";
import {
	extractArraySignal,
	extractEnumSignal,
	extractNewValueSignal,
	extractNullSignal,
	isLikelyEnum,
} from "./signals";
import type { ExtractionConfig, FieldSignal } from "./types";

export function walkFields(
	data: unknown,
	config: ExtractionConfig,
	basePath = "",
	depth = 0,
): FieldSignal[] {
	if (depth > config.maxDepth) return [];

	const signals: FieldSignal[] = [];

	if (data === null || data === undefined) {
		if (basePath) {
			signals.push(extractNullSignal(basePath, data));
		}
		return signals;
	}

	if (Array.isArray(data)) {
		if (basePath) {
			signals.push(extractArraySignal(basePath, data.length));
		}

		const sampleSize = Math.min(data.length, config.maxArraySample);
		for (let i = 0; i < sampleSize; i++) {
			signals.push(...walkFields(data[i], config, `${basePath}[]`, depth + 1));
		}

		return signals;
	}

	if (typeof data === "object") {
		const obj = data as Record<string, unknown>;
		for (const key of Object.keys(obj)) {
			const fieldPath = basePath ? `${basePath}.${key}` : key;

			if (config.excludePaths.includes(fieldPath)) continue;
			if (isExcludedPath(fieldPath, config.excludePatterns)) continue;

			const value = obj[key];

			signals.push(extractNullSignal(fieldPath, value));

			if (value === null || value === undefined) {
				continue;
			}

			if (typeof value === "string") {
				if (isLikelyEnum(value, config.maxEnumCardinality)) {
					signals.push(extractEnumSignal(fieldPath, value));
					signals.push(extractNewValueSignal(fieldPath, value));
				}
			} else if (typeof value === "number" || typeof value === "boolean") {
			} else if (Array.isArray(value)) {
				signals.push(...walkFields(value, config, fieldPath, depth + 1));
			} else if (typeof value === "object") {
				signals.push(...walkFields(value, config, fieldPath, depth + 1));
			}
		}
	}

	return signals;
}
