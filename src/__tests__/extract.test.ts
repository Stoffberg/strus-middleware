import { describe, expect, test } from "bun:test";
import { extractMetadata } from "../extract";

describe("extractMetadata", () => {
	test("extracts null signals from object fields", () => {
		const result = extractMetadata({ status: "approved", detail: null }, 200);
		expect(result.statusCode).toBe(200);

		const nullSignals = result.signals.filter(
			(s) => s.signalType === "null_rate",
		);
		const statusNull = nullSignals.find((s) => s.fieldPath === "status");
		expect(statusNull?.value).toEqual({ type: "null_rate", isNull: false });

		const detailNull = nullSignals.find((s) => s.fieldPath === "detail");
		expect(detailNull?.value).toEqual({ type: "null_rate", isNull: true });
	});

	test("extracts enum signals from short string values", () => {
		const result = extractMetadata({ status: "approved" }, 200);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.length).toBe(1);
		expect(enumSignals[0]?.value).toEqual({
			type: "enum_distribution",
			value: "approved",
		});
	});

	test("extracts array cardinality signals", () => {
		const result = extractMetadata({ items: [1, 2, 3], tags: ["a", "b"] }, 200);
		const arraySignals = result.signals.filter(
			(s) => s.signalType === "array_cardinality",
		);
		expect(arraySignals.length).toBe(2);

		const itemsSignal = arraySignals.find((s) => s.fieldPath === "items");
		expect(itemsSignal?.value).toEqual({
			type: "array_cardinality",
			length: 3,
		});
	});

	test("walks nested objects", () => {
		const result = extractMetadata(
			{ data: { outcome: "denied", count: 5 } },
			200,
		);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.some((s) => s.fieldPath === "data.outcome")).toBe(true);
	});

	test("walks arrays of objects", () => {
		const result = extractMetadata(
			{ results: [{ status: "ok" }, { status: "error" }] },
			200,
		);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.some((s) => s.fieldPath === "results[].status")).toBe(
			true,
		);
	});

	test("excludes PHI/PII fields by default", () => {
		const result = extractMetadata(
			{
				status: "approved",
				firstName: "John",
				lastName: "Doe",
				ssn: "123-45-6789",
				dateOfBirth: "1990-01-01",
				email: "john@example.com",
				outcome: "approved",
			},
			200,
		);

		const fieldPaths = result.signals.map((s) => s.fieldPath);
		expect(fieldPaths).toContain("status");
		expect(fieldPaths).toContain("outcome");
		expect(fieldPaths).not.toContain("firstName");
		expect(fieldPaths).not.toContain("lastName");
		expect(fieldPaths).not.toContain("ssn");
		expect(fieldPaths).not.toContain("dateOfBirth");
		expect(fieldPaths).not.toContain("email");
	});

	test("respects custom excludePaths", () => {
		const result = extractMetadata(
			{ status: "approved", internal: "data" },
			200,
			{
				excludePaths: ["internal"],
			},
		);
		const fieldPaths = result.signals.map((s) => s.fieldPath);
		expect(fieldPaths).toContain("status");
		expect(fieldPaths).not.toContain("internal");
	});

	test("does not treat UUIDs as enums", () => {
		const result = extractMetadata(
			{ id: "550e8400-e29b-41d4-a716-446655440000" },
			200,
		);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.length).toBe(0);
	});

	test("does not treat URLs as enums", () => {
		const result = extractMetadata(
			{ url: "https://example.com/api/v1/resource" },
			200,
		);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.length).toBe(0);
	});

	test("does not treat long text as enums", () => {
		const result = extractMetadata(
			{
				description:
					"This is a very long description that should not be treated as an enum value because it has way too many words in it",
			},
			200,
		);
		const enumSignals = result.signals.filter(
			(s) => s.signalType === "enum_distribution",
		);
		expect(enumSignals.length).toBe(0);
	});

	test("handles empty response body", () => {
		const result = extractMetadata({}, 204);
		expect(result.statusCode).toBe(204);
		expect(result.signals).toEqual([]);
	});

	test("handles null response body", () => {
		const result = extractMetadata(null, 200);
		expect(result.signals).toEqual([]);
	});

	test("respects maxDepth", () => {
		const deeplyNested = { a: { b: { c: { d: { e: { f: "deep" } } } } } };
		const result = extractMetadata(deeplyNested, 200, { maxDepth: 2 });
		const fieldPaths = result.signals.map((s) => s.fieldPath);
		expect(fieldPaths.some((p) => p.includes("d"))).toBe(false);
	});

	test("extracts new_value signals alongside enum signals", () => {
		const result = extractMetadata({ queueType: "standard" }, 200);
		const newValueSignals = result.signals.filter(
			(s) => s.signalType === "new_value",
		);
		expect(newValueSignals.length).toBe(1);
		expect(newValueSignals[0]?.value).toEqual({
			type: "new_value",
			value: "standard",
		});
	});
});
