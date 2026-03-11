# strus-middleware

API response monitoring middleware for [Strus](https://strus.io). Intercepts HTTP responses, extracts structural signals from response bodies, and sends them to Strus in batches.

Response bodies are processed in your server's process. Only field-level signals (null rates, enum distributions, array sizes) are sent to Strus. PHI/PII fields are automatically excluded.

## Install

```bash
npm install strus-middleware
```

## Quick Start

### Express

```typescript
import { StrusClient } from "strus-middleware";
import { strusExpress } from "strus-middleware/express";

const strus = new StrusClient({
  apiKey: "your_api_key",
});

app.use(strusExpress(strus));
```

### Hono

```typescript
import { StrusClient } from "strus-middleware";
import { strusHono } from "strus-middleware/hono";

const strus = new StrusClient({
  apiKey: "your_api_key",
});

app.use("*", strusHono(strus));
```

### Fastify

```typescript
import { StrusClient } from "strus-middleware";
import { strusFastify } from "strus-middleware/fastify";

const strus = new StrusClient({
  apiKey: "your_api_key",
});

fastify.register(strusFastify(strus));
```

### Direct Usage

If your framework isn't listed above, use `StrusClient` directly:

```typescript
import { StrusClient } from "strus-middleware";

const strus = new StrusClient({
  apiKey: "your_api_key",
});

strus.observe({
  method: "GET",
  path: "/api/patients",
  statusCode: 200,
  responseBody: data,
});

process.on("SIGTERM", () => strus.shutdown());
```

## Configuration

```typescript
const strus = new StrusClient({
  apiKey: "your_api_key",           // required
  endpoint: "https://...",          // defaults to Strus production
  batchSize: 50,                    // events per batch (default: 50)
  flushIntervalMs: 5000,            // flush interval in ms (default: 5000)
  enabled: true,                    // toggle on/off (default: true)
  extraction: {
    excludePaths: ["internal.debug"],
    maxDepth: 10,
  },
  onError: (err) => console.error(err),
});
```

### Extraction Options

The `extraction` field controls how response bodies are analyzed. All options are optional.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxDepth` | `number` | `5` | Maximum depth to walk nested objects |
| `excludePaths` | `string[]` | `[]` | Additional field paths to skip (on top of the built in PHI/PII list) |

PHI/PII fields like `firstName`, `lastName`, `ssn`, `email`, `dateOfBirth`, and similar patterns are excluded automatically. You never need to configure these.

## How It Works

The middleware intercepts responses and extracts structural metadata from the response body. The extraction happens synchronously in your process. Extracted signals are buffered and sent to Strus in batches via a background timer. When the buffer hits `batchSize`, it flushes immediately.

The adapters (Express, Hono, Fastify) handle the framework specific plumbing of capturing response bodies before they're sent to the client.

## Graceful Shutdown

Call `strus.shutdown()` before your process exits to flush any remaining buffered events:

```typescript
process.on("SIGTERM", async () => {
  await strus.shutdown();
  process.exit(0);
});
```

## License

MIT
