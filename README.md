# strus-middleware

API response monitoring middleware for [Strus](https://strus.io). Intercepts HTTP responses, extracts structural signals from response bodies, and sends them to Strus in batches.

Response bodies are processed in your server's process. Only field-level signals (null rates, enum distributions, array sizes) are sent to Strus. PHI/PII fields are automatically excluded.

Works everywhere: Cloudflare Workers, Vercel, AWS Lambda, Deno Deploy, Fly.io, Railway, Render, Docker, plain Node.js, Bun, and anything else that runs JavaScript.

## Install

```bash
npm install strus-middleware
```

## Quick Start

Pick the adapter for your framework. The client is safe to construct at module level on any platform; it only starts its internal timer on the first request.

### Hono

Works on Cloudflare Workers, Cloudflare Pages, Vercel Edge, Deno Deploy, Bun, Node.js, and any other runtime Hono supports. On Workers and Pages, the adapter automatically uses `executionCtx.waitUntil` to ensure telemetry flushes complete before the isolate dies.

```typescript
import { Hono } from "hono";
import { StrusClient } from "strus-middleware";
import { strusHono } from "strus-middleware/hono";

const strus = new StrusClient({ apiKey: "sk_..." });
const app = new Hono();

app.use("*", strusHono(strus));

app.get("/api/patients", (c) => {
  return c.json({ patients: [] });
});

export default app;
```

### Next.js

Works on Vercel (Edge and Serverless), self-hosted Next.js, and Next.js on Cloudflare (via next-on-pages or OpenNext). The adapter wraps your route handlers and automatically picks up `waitUntil` from the Next.js request context on Vercel, or from the event argument when available.

```typescript
// app/api/patients/route.ts
import { StrusClient } from "strus-middleware";
import { strusNextjs } from "strus-middleware/nextjs";

const strus = new StrusClient({ apiKey: "sk_..." });
const { wrapHandler } = strusNextjs(strus);

export const GET = wrapHandler(async (req) => {
  const patients = await getPatients();
  return Response.json({ patients });
});

export const POST = wrapHandler(async (req) => {
  const body = await req.json();
  const patient = await createPatient(body);
  return Response.json(patient, { status: 201 });
});
```

Wrap each route handler you want to monitor. The original response is returned unchanged to the caller.

### Express

Works on Node.js, Bun, AWS Lambda (via serverless-express or similar), Google Cloud Run, Docker, EC2, Fly.io, Railway, Render, and anywhere Express runs.

```typescript
import express from "express";
import { StrusClient } from "strus-middleware";
import { strusExpress } from "strus-middleware/express";

const strus = new StrusClient({ apiKey: "sk_..." });
const app = express();

app.use(strusExpress(strus));

app.get("/api/patients", (req, res) => {
  res.json({ patients: [] });
});

app.listen(3000);
```

### Fastify

Works everywhere Fastify runs. Register it as a standard Fastify plugin.

```typescript
import Fastify from "fastify";
import { StrusClient } from "strus-middleware";
import { strusFastify } from "strus-middleware/fastify";

const strus = new StrusClient({ apiKey: "sk_..." });
const fastify = Fastify();

fastify.register(strusFastify(strus));

fastify.get("/api/patients", async () => {
  return { patients: [] };
});

fastify.listen({ port: 3000 });
```

### Direct Usage

If your framework is not listed above, use `StrusClient` directly. Call `observe` after each response and `flushAsync` to send events. Pass the returned Promise to whatever lifecycle hook your platform provides (`waitUntil`, `event.waitUntil`, Lambda callback, etc.).

```typescript
import { StrusClient } from "strus-middleware";

const strus = new StrusClient({ apiKey: "sk_..." });

// Inside your request handler:
strus.observe({
  method: "GET",
  path: "/api/patients",
  statusCode: 200,
  responseBody: data,
});

// Flush and wait for delivery:
await strus.flushAsync();

// Or on a platform with waitUntil:
ctx.waitUntil(strus.flushAsync());
```

## Platform Guide

The middleware handles platform differences automatically. Here is what happens on each platform so you know what to expect.

| Platform | Adapter | Flush mechanism | Notes |
|----------|---------|-----------------|-------|
| **Cloudflare Workers** | Hono | `executionCtx.waitUntil` | Automatic. Safe to construct client at module top level. |
| **Cloudflare Pages** | Hono | `executionCtx.waitUntil` | Same as Workers. |
| **Vercel Edge** | Hono or Next.js | Global `@next/request-context` `waitUntil` | Automatic via Next.js adapter. Hono adapter flushes per-request. |
| **Vercel Serverless** | Next.js or Express | Global `@next/request-context` `waitUntil` | Next.js adapter picks up `waitUntil` automatically. |
| **AWS Lambda** | Express or Direct | `await flushAsync()` before handler returns | Express adapter flushes per-request. Call `shutdown()` on `SIGTERM` for clean exit. |
| **Lambda@Edge** | Direct | `await flushAsync()` | Constrained execution window. Flush before returning. |
| **Deno Deploy** | Hono | Per-request flush | Timer fallback for long-lived Deno processes. |
| **Google Cloud Run** | Express or Fastify | Per-request flush + timer | Container stays alive between requests; timer handles the rest. |
| **Azure Functions** | Express or Direct | `await shutdown()` before function completes | Ensure buffer is drained. |
| **Netlify Edge Functions** | Hono | Per-request flush | Deno-based edge runtime. |
| **Netlify Functions** | Express | Per-request flush | AWS Lambda under the hood. |
| **Fly.io** | Any | Per-request flush + timer | Long-running containers. Timer starts on first request. |
| **Railway** | Any | Per-request flush + timer | Long-running containers. |
| **Render** | Any | Per-request flush + timer | Long-running containers. |
| **Docker / EC2 / ECS** | Any | Per-request flush + timer | Long-running. Call `shutdown()` on `SIGTERM`. |
| **Node.js** | Any | Per-request flush + timer | Timer is unrefed so it does not keep the process alive. |
| **Bun** | Any | Per-request flush + timer | Same as Node.js. |
| **Fastly Compute** | Hono or Direct | Per-request flush | Single-request lifecycle. |
| **Next.js on Cloudflare** | Next.js | `waitUntil` via event arg | Works with next-on-pages and OpenNext. |

## Configuration

```typescript
const strus = new StrusClient({
  apiKey: "sk_...",                    // required
  endpoint: "https://...",             // defaults to Strus production
  batchSize: 50,                       // events per batch (default: 50)
  flushIntervalMs: 5000,               // flush interval in ms (default: 5000)
  enabled: true,                       // toggle on/off (default: true)
  extraction: {
    excludePaths: ["internal.debug"],   // additional paths to skip
    maxDepth: 10,                       // max nesting depth to walk
  },
  onError: (err) => console.error(err),
});
```

### Extraction Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | `number` | `10` | Maximum depth to walk nested objects |
| `maxArraySample` | `number` | `5` | Number of array elements to sample |
| `maxEnumCardinality` | `number` | `50` | Max unique values before a string field stops being treated as an enum |
| `excludePaths` | `string[]` | `[]` | Additional field paths to skip (on top of the built-in PHI/PII list) |
| `excludePatterns` | `RegExp[]` | `[]` | Additional regex patterns for fields to skip |

PHI/PII fields like `firstName`, `lastName`, `ssn`, `email`, `dateOfBirth`, `diagnosis`, `medicalRecord`, and similar patterns are excluded automatically. You never need to configure these.

## How It Works

The middleware intercepts responses and extracts structural metadata from the response body. Extraction happens synchronously in your process. Only signals (null rates, enum distributions, array cardinalities, new values) are collected. The actual field values for sensitive data are never captured.

Each adapter calls `flushAsync()` after every request to send buffered events to Strus. On platforms with `waitUntil` (Cloudflare Workers, Vercel), the adapter pipes the flush promise through it so the runtime stays alive until delivery completes. On long-running servers, a background timer (unrefed, so it will not keep your process alive) provides an additional safety net.

The timer starts lazily on the first `observe` call, not in the constructor. This means constructing a `StrusClient` at module top level is safe on every platform, including Cloudflare Workers where global-scope timers are not allowed.

## Graceful Shutdown

On long-running servers, call `shutdown()` before your process exits to flush any remaining buffered events:

```typescript
process.on("SIGTERM", async () => {
  await strus.shutdown();
  process.exit(0);
});
```

On serverless platforms this is not necessary since the adapters flush per-request.

## License

MIT
