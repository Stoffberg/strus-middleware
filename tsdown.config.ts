import { defineConfig } from "tsdown";

export default defineConfig({
	entry: [
		"./src/index.ts",
		"./src/extract/index.ts",
		"./src/adapters/express.ts",
		"./src/adapters/hono.ts",
		"./src/adapters/fastify.ts",
	],
	format: "esm",
	dts: true,
	outDir: "./dist",
	clean: true,
});
