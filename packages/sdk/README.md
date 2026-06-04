# @p402/sdk

[![npm](https://img.shields.io/npm/v/@p402/sdk?color=B6FF2E)](https://www.npmjs.com/package/@p402/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Official TypeScript SDK for the [P402 AI Payment Router](https://p402.io).

Route LLM requests across 300+ models, enforce session budgets, and settle micropayments in USDC on Base — all from a single client.

## Installation

```bash
npm install @p402/sdk
# peer dep:
npm install viem
```

## Quick Start

```typescript
import P402Client from '@p402/sdk';

const p402 = new P402Client({
  apiKey: process.env.P402_API_KEY,
});

const response = await p402.chat({
  messages: [{ role: 'user', content: 'Hello!' }],
  p402: { mode: 'cost' },
});

console.log(response.choices[0].message.content);
console.log(response.p402_metadata); // { provider, cost_usd, latency_ms, cached }
```

## Constructor

```typescript
new P402Client(config?: P402Config)

interface P402Config {
  apiKey?: string;     // P402 API key — or set P402_API_KEY env var
  routerUrl?: string;  // Default: 'https://p402.io'
  network?: Network;   // Default: 'eip155:8453' (Base Mainnet)
  debug?: boolean;     // Log all requests/responses
}
```

## Methods

### `chat(request)` → `ChatCompletionResponse`

OpenAI-compatible chat completion. P402 routes to the optimal provider.

```typescript
const response = await p402.chat({
  model: 'gpt-4o',        // Optional — P402 can choose for you
  messages: [...],
  p402: {
    mode: 'cost',         // 'cost' | 'quality' | 'speed' | 'balanced'
    cache: true,          // Semantic cache (default: false)
    maxCost: 0.01,        // Reject if estimated cost exceeds this (USD)
    session_id: 'sess_x', // Attach to a budget session
  }
});
```

### `createSession(params)` → `Session`

Create a budget-capped agent session.

```typescript
const session = await p402.createSession({
  budget_usd: 10.00,
  expires_in_hours: 24,
  agent_id: 'my-agent-v1',
});
// session.id — pass as p402.session_id in chat requests
```

### `getSession(sessionId)` → `Session`

```typescript
const { budget } = await p402.getSession(session.id);
// budget.remaining_usd, budget.used_usd, budget.total_usd
```

### `fundSession(sessionId, amount, txHash?)` → `Session`

Add budget to an existing session.

### `meter.recordEvent(input)` → `MeterEventResult`

Record an economic event for an AI action you ran outside P402's hosted router (Path B: customer apps that call OpenAI / Anthropic / Gemini directly, then post only economics back to P402).

**Privacy contract.** This endpoint refuses any content-bearing top-level key (`prompt`, `response`, `messages`, `content`, `file`, `document`, `transcript`, `chat_history`, `pii`, `phi`, `secret`, `source_code`, ...). The SDK rejects locally — no network request fires — before the router gets a chance to reject. P402 meters economics, not content.

```typescript
const result = await p402.meter.recordEvent({
  request_id: 'req_abc123',
  attribution: {
    department_id: 'claims',
    workflow_id: 'prior_authorization',
    action_type: 'claims_summary',
  },
  model: {
    provider: 'google',
    model_used: 'gemini-2.0-flash',
  },
  usage: {
    input_tokens: 2140,
    output_tokens: 801,
    cost_usd: 0.0041,
    latency_ms: 720,
  },
  outcome: {
    status: 'accepted',
    quality_score: 0.91,
  },
});

if (result.deferred) {
  // 202: canonical ledger insert failed; durability outbox captured the
  // row. The retry worker will replay. No event_id yet.
  console.log('deferred to outbox', result.request_id);
} else {
  // 200: canonical write landed.
  console.log('event_id', result.event_id);
}
```

### `meter.listEvents(params?)` → `{ events: MeterEvent[] }`

List recent economic events for the tenant. All filters optional.

```typescript
const { events } = await p402.meter.listEvents({
  privacy_mode: 'metadata_only',
  department_id: 'claims',
  provider: 'google',
  evidence_status: 'present',
  since: new Date(Date.now() - 24 * 3600 * 1000),
  limit: 100,
});
```

### `meter.getEvent(eventId)` → `MeterEvent`

Fetch one event with the full privacy posture (mode, source, storage decisions, retention expiry).

### `outcomes.record(input)` → `OutcomeResult`

Record the outcome of a recorded action (feeds the Optimize layer).

```typescript
await p402.outcomes.record({
  request_id: 'req_abc123',
  status: 'accepted',        // accepted | rejected | retried | escalated | human_reviewed | failed
  quality_score: 0.91,       // optional, [0, 1]
});
```

### `plan(request)` → `PlanResponse`

Dry-run routing — see which facilitator would handle a payment without settling.

```typescript
const plan = await p402.plan({
  payment: { amount: '1.00', asset: 'USDC', network: 'eip155:8453' }
});
// plan.allow, plan.candidates[0].payment.treasuryAddress
```

### `settle(request)` → `SettleResponse`

Submit an EIP-3009 authorization or tx hash for settlement.

### `listMandates(status?)` → `{ data: Mandate[] }`

List AP2 spending mandates.

### `createMandate(params)` → `Mandate`

Create an AP2 mandate — signed spending authorization from user to agent.

### `listPolicies()` → `{ data: Policy[] }`

List governance policies.

### `health()` → `boolean`

Check if the P402 router is reachable.

## Routing Modes

| Mode | Optimizes For | Best For |
|---|---|---|
| `cost` | Lowest price | Batch processing, background tasks |
| `quality` | Best output | Final user-facing outputs |
| `speed` | Lowest latency | Real-time / interactive UX |
| `balanced` | Equal weight | General purpose (default) |

## Error Handling

```typescript
import P402Client, { P402Error } from '@p402/sdk';

try {
  await p402.chat({ messages });
} catch (err) {
  if (err instanceof P402Error) {
    switch (err.code) {
      case 'BUDGET_EXCEEDED':  // Session out of funds
      case 'POLICY_DENIED':    // Governance policy blocked it
      case 'RATE_LIMITED':     // Too many requests
      case 'UNAUTHORIZED':     // Invalid API key
      case 'NETWORK_ERROR':    // Router unreachable
    }
  }
}
```

## EIP-712 Mandate Helpers

```typescript
import { createMandateMessage, getMandateTypedData, MANDATE_DOMAIN } from '@p402/sdk';

const mandate = createMandateMessage({
  grantor: 'did:pkh:eip155:8453:0xUser...',
  grantee: 'did:pkh:eip155:8453:0xAgent...',
  maxAmountUSD: '50.00',
  allowedActions: ['ai.completion', 'ai.embedding'],
  validDays: 30,
});

// Sign with wagmi/viem signTypedData
const typedData = getMandateTypedData(mandate);
// { domain, types, primaryType: 'Mandate', message }
```

## TypeScript

Full type coverage. Key types:

```typescript
import type {
  P402Config, ChatCompletionRequest, ChatCompletionResponse,
  Session, Mandate, Policy,
  PlanRequest, PlanResponse, SettleRequest, SettleResponse,
  EIP3009Authorization, EIP712Mandate, SignedMandate,
  Network, PaymentScheme, P402ErrorCode
} from '@p402/sdk';
```

## Links

- [Docs](https://p402.io/docs)
- [Dashboard](https://p402.io/dashboard)
- [Examples](../../examples/)
- [Source](src/)
