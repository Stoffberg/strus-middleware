import type { FieldSignal } from "./types";

export function extractNullSignal(
	fieldPath: string,
	value: unknown,
): FieldSignal {
	return {
		fieldPath,
		signalType: "null_rate",
		value: { type: "null_rate", isNull: value === null || value === undefined },
	};
}

export function extractEnumSignal(
	fieldPath: string,
	value: string,
): FieldSignal {
	return {
		fieldPath,
		signalType: "enum_distribution",
		value: { type: "enum_distribution", value },
	};
}

export function extractArraySignal(
	fieldPath: string,
	length: number,
): FieldSignal {
	return {
		fieldPath,
		signalType: "array_cardinality",
		value: { type: "array_cardinality", length },
	};
}

export function extractNewValueSignal(
	fieldPath: string,
	value: string,
): FieldSignal {
	return {
		fieldPath,
		signalType: "new_value",
		value: { type: "new_value", value },
	};
}

export function isLikelyEnum(value: string, maxCardinality: number): boolean {
	if (value.length > 100) return false;
	if (/^\d+(\.\d+)?$/.test(value)) return false;
	if (
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		)
	)
		return false;
	if (/^https?:\/\//.test(value)) return false;
	if (value.includes("\n")) return false;
	if (value.split(/\s+/).length > 5) return false;

	void maxCardinality;
	return true;
}
