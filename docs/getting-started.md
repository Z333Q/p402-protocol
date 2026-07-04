# Getting Started with P402

## 1. Get an API Key

1. Sign up at [p402.io](https://p402.io)
2. Go to [Dashboard → Settings → API Keys](https://p402.io/dashboard/settings)
3. Click **Generate Key** — copy it immediately (shown once)
4. Set it as an environment variable:

```bash
export P402_API_KEY=p402_live_...
```

## 2. Make Your First Request

```bash
curl -X POST https://p402.io/api/v2/chat/completions \
  -H "Authorization: Bearer $P402_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{ "role": "user", "content": "Hello from P402!" }],
    "p402": { "mode": "cost" }
  }'
```

You'll get back an OpenAI-compatible response plus `p402_metadata`:

```json
{
  "choices": [{ "message": { "role": "assistant", "content": "Hello! ..." } }],
  "p402_metadata": {
    "provider": "deepseek",
    "model": "deepseek-chat",
    "cost_usd": 0.000089,
    "latency_ms": 312,
    "cached": false
  }
}
```

## 3. Install the SDK

```bash
npm install @p402/sdk viem
```

```typescript
import P402Client from '@p402/sdk';

const p402 = new P402Client({ apiKey: process.env.P402_API_KEY });
const res = await p402.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
  p402: { mode: 'balanced' }
});
```

## 4. Install the CLI

```bash
npx p402 login     # Prompts for your API key
npx p402 chat "Hello!"
npx p402 health
```

## 5. Meter Events (Path B: no content ever leaves your process)

If you call OpenAI / Anthropic / Gemini directly and still want P402's
Meter / Monitor / Control / Optimize surfaces, post economics — never
content — back to the router:

```typescript
import P402Client from '@p402/sdk';

const p402 = new P402Client({ apiKey: process.env.P402_API_KEY });

// Single event
await p402.meter.recordEvent({
  request_id: 'req_abc',
  attribution: { department_id: 'claims', workflow_id: 'prior_auth' },
  model: { provider: 'openai', model_used: 'gpt-4o-mini' },
  usage: { input_tokens: 2140, output_tokens: 801, cost_usd: 0.0041 },
});

// Batch (SDK 1.2.1+) — one HTTP request, per-event UPSERT on the router
await p402.meter.recordEventsBatch([
  { request_id: 'req_1', usage: { cost_usd: 0.0002 } },
  { request_id: 'req_2', usage: { cost_usd: 0.0003 } },
]);
```

The SDK refuses to send any content-bearing key (`prompt`, `response`,
`messages`, `content`, `file`, `document`, `transcript`, ...). Guard
runs client-side before any network call.

For fire-and-forget buffered metering with automatic flush and retry
policy, see [examples/05-meter-events/](../examples/05-meter-events/).

## 6. Explore

| What | Where |
|---|---|
| Dashboard | [p402.io/dashboard](https://p402.io/dashboard) |
| Models + pricing | `npx p402 models list` or `/api/v2/models` |
| Routing guide | [docs/routing-guide.md](routing-guide.md) |
| Session budgets | [docs/sessions.md](sessions.md) |
| x402 payments | [docs/x402-payments.md](x402-payments.md) |
| A2A protocol | [docs/a2a-protocol.md](a2a-protocol.md) |
| Full examples | [examples/](../examples/) |

## Base URL

```
https://p402.io
```

All API versions are stable. No beta prefixes.

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer p402_live_...
```

Public endpoints (health, supported, models) do not require authentication.

→ [Authentication guide](authentication.md)
