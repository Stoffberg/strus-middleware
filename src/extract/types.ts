export type SignalType =
	| "null_rate"
	| "enum_distribution"
	| "array_cardinality"
	| "error_rate"
	| "new_value";

export type FieldSignal = {
	fieldPath: string;
	signalType: SignalType;
	value: FieldSignalValue;
};

export type FieldSignalValue =
	| { type: "null_rate"; isNull: boolean }
	| { type: "enum_distribution"; value: string }
	| { type: "array_cardinality"; length: number }
	| { type: "new_value"; value: string };

export type ExtractionConfig = {
	excludePaths: string[];
	excludePatterns: RegExp[];
	maxDepth: number;
	maxArraySample: number;
	maxEnumCardinality: number;
};

export type ExtractionResult = {
	statusCode: number;
	signals: FieldSignal[];
};
