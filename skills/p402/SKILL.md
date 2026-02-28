---
name: p402
description: >
  Build cost-aware AI applications with P402.io, the payment-aware AI orchestration layer combining
  multi-provider LLM routing (300+ models) with x402 stablecoin micropayments on Base. Use this skill
  when the user wants to: route AI requests across providers with cost/speed/quality optimization, add
  spending limits or billing guards to AI agents, implement session-based budget management, integrate
  x402 USDC micropayments for AI services, set up A2A agent communication with payment rails, create
  AP2 spending mandates, migrate from single-provider OpenAI/Anthropic to multi-provider routing,
  implement semantic caching for LLM costs, or compare model pricing. Trigger for any mention of P402,
  x402 payments, AI cost reduction, multi-model routing, agent spending controls, or payment-aware
  orchestration, even without exact terms.
---

# P402: Payment-Aware AI Orchestration

P402.io is an infrastructure layer that solves two problems at once: fragmented AI provider APIs and broken micropayment economics. It routes LLM requests to the optimal provider based on cost, speed, or quality, while settling payments in USDC/USDT on Base blockchain using the x402 protocol.

The key mental model: P402 sits between your application and AI providers the same way a payment network sits between merchants and banks. It handles routing, authorization, and settlement so your code just makes API calls.

## Why P402 Exists

Traditional payment processors charge ~$0.30 per transaction, which makes micropayments for AI API calls (often $0.001-$0.05) economically impossible. P402 uses stablecoin settlement on Base L2 where transaction costs are fractions of a cent, enabling true pay-per-request economics for AI agents.

Most AI applications are "cost-blind" -- they hardcode a single provider and overpay by 70-85%. P402 makes applications "cost-aware" by exposing real-time pricing across 300+ models and routing intelligently.

## Core Concepts

### The Session Lifecycle

Sessions are the foundational primitive. Every interaction with P402 flows through a session:

1. **Create** a session with a budget cap and optional policies
2. **Fund** the session (USDC via Base Pay, direct transfer, or test credits)
3. **Use** the session for chat completions -- P402 tracks spending per request
4. **Expire** -- sessions auto-close when budget is exhausted or time limit is reached

Sessions enforce spending boundaries. An agent with a $10 session physically cannot spend $10.01. This is the core safety mechanism for autonomous agent spending.

### Routing Modes

Every chat completion request can specify a routing mode that controls how P402 selects the provider and model:

| Mode | Optimizes For | Best For | Typical Provider |
|------|--------------|----------|-----------------|
| `cost` | Lowest price, acceptable quality | Batch processing, background tasks, high-volume | DeepSeek V3.2, Haiku 4.5, GPT-4o-mini |
| `quality` | Best output, price secondary | Final outputs, complex reasoning, user-facing answers | Claude Opus 4.6, GPT-5.2, Gemini 3.1 Pro |
| `speed` | Lowest latency, price secondary | Real-time chat, interactive UX, streaming | Groq (LPU), Flash models |
| `balanced` | Equal weight across all factors | General purpose, default choice | Sonnet 4.6, GPT-4o-mini, Gemini 3.1 Pro |

The router scores every available model using a proprietary weighted algorithm, filters by capability requirements and policy constraints, and returns the optimal choice. If the selected provider fails, automatic failover retries with the next-best alternative.

**Decision guidance for developers:** Start with `balanced` as your default. Switch to `cost` for any task where quality above "good enough" does not matter (summarization, classification, extraction). Use `quality` only for tasks where the output is the final product a human will read or where reasoning depth is critical. Use `speed` when time-to-first-byte matters more than cost (real-time chat, autocomplete).

### The Billing Guard

P402 enforces a multi-layer defense system on every request. Default limits are configurable per tenant via the [P402 dashboard](https://p402.io/dashboard). Developers should handle these error codes:

| Layer | Protection | Error Code | What To Do |
|-------|-----------|------------|------------|
| Rate limit | Requests per hour cap | `RATE_LIMIT_EXCEEDED` | Back off, use `retryAfterMs` from error |
| Daily circuit breaker | Daily spend cap | `DAILY_LIMIT_EXCEEDED` | Contact support or wait for daily reset |
| Concurrent requests | Simultaneous request cap | `TOO_MANY_CONCURRENT` | Queue requests, reduce parallelism |
| Anomaly detection | Statistical outlier detection | Logged warning (soft) | Unusual cost pattern flagged, not blocked |
| Per-request cap | Single request cost cap | `REQUEST_TOO_EXPENSIVE` | Use a cheaper model or reduce max_tokens |
| Budget reservation | Atomic budget check | Insufficient budget error | Fund the session with more USDC |

The guard runs a pre-check before every completion, executing all layers in sequence. If any hard layer fails, the request is rejected before it reaches the provider. This fail-closed design means an agent cannot spend money it has not been authorized to spend. View and adjust your limits at [p402.io/dashboard](https://p402.io/dashboard).

### The OpenAI-Compatible Interface

P402's chat completions endpoint is a drop-in replacement for OpenAI's API. The only additions are the `p402` extension object and the `p402_metadata` in the response:

```typescript
// Before: direct OpenAI call
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  headers: { 'Authorization': `Bearer ${OPENAI_KEY}` },
  body: JSON.stringify({ model: 'gpt-4o', messages })
});

// After: P402 (same shape, smarter routing)
const response = await fetch('https://p402.io/api/v2/chat/completions', {
  headers: { 'Authorization': `Bearer ${P402_KEY}` },
  body: JSON.stringify({
    messages,
    // model is optional -- P402 picks the best one
    p402: { mode: 'cost', session_id: 'sess_abc', cache: true }
  })
});
```

The response includes `p402_metadata` with the actual provider used, cost in USD, latency breakdown, and whether the response came from cache. Response headers also expose this: `X-P402-Provider`, `X-P402-Cost-USD`, `X-P402-Latency-MS`, `X-P402-Request-ID`.

### Semantic Cache

P402 can cache responses for semantically similar prompts. When enabled (`p402.cache: true`), the system:

1. Generates an embedding of the request via OpenRouter
2. Searches existing cache entries for high semantic similarity
3. Returns the cached response instantly if a strong match is found
4. Otherwise, forwards to the provider and caches the result

Caching is scoped by tenant -- no cross-tenant data leakage is possible. Default TTL is 1 hour, max age is 24 hours. Both are configurable per request via `p402.cache_ttl`. Tune cache settings in your [P402 dashboard](https://p402.io/dashboard).

Cache is most effective for: classification tasks, FAQ-style queries, repeated extractions, and any workload with natural prompt repetition. It is least effective for: creative generation, conversation continuations, and tasks requiring fresh data.

## Getting Started

The fastest way to try P402 is the **Base Mini App** at [mini.p402.io](https://mini.p402.io). Connect a Base Account, fund with USDC via Base Pay, and start chatting with real-time cost and savings tracking. No API key needed.

For API access, sign up at [p402.io](https://p402.io) to get your API key and access the full dashboard with analytics, session management, and billing configuration.

## API Quick Reference

**Base URL:** `https://p402.io`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/v2/chat/completions` | POST | Main routing endpoint (OpenAI-compatible) |
| `/api/v2/sessions` | POST | Create a new session |
| `/api/v2/sessions` | GET | List active sessions |
| `/api/v2/sessions/:id` | GET | Get session details and budget status |
| `/api/v2/sessions/:id` | DELETE | End a session |
| `/api/v2/providers` | GET | List all 300+ available providers/models |
| `/api/v2/providers/compare` | POST | Compare model pricing for a token count |
| `/api/v2/analytics/spend` | GET | Spending analytics |
| `/api/v2/analytics/recommendations` | GET | Cost optimization suggestions |
| `/api/v2/cache/stats` | GET | Cache hit rate and savings |
| `/api/a2a` | POST | A2A JSON-RPC endpoint |
| `/.well-known/agent.json` | GET | Agent discovery card |
| `/api/a2a/mandates` | POST | Create AP2 spending mandate |
| `/api/a2a/mandates/:id/use` | POST | Use a mandate for payment |

For complete request/response schemas and code examples in TypeScript, Python, and curl, read `references/api-reference.md`.

## Integration Patterns

### Pattern 1: Drop-In OpenAI Replacement (Simplest)

Change the base URL and API key. Optionally remove the `model` field to let P402 choose. Add `p402.mode` for routing control. This is a 2-line migration for any OpenAI SDK user.

### Pattern 2: Session-Budgeted Agent

Create a session with a dollar budget, pass `session_id` on every request, and P402 enforces the cap. When budget runs low, the session status changes to `exhausted` and requests are rejected. This is the pattern for autonomous agents that need spending guardrails.

### Pattern 3: A2A Agent-to-Agent Communication

Use the JSON-RPC endpoint at `/api/a2a` with Google's A2A protocol. Agents discover each other via `/.well-known/agent.json`, exchange tasks, and settle payments via the x402 extension. AP2 mandates pre-authorize spending. Read `references/a2a-protocol.md` for the full flow.

### Pattern 4: x402 Payment Settlement

For machine-to-machine payments using the HTTP 402 flow: service responds with payment requirements, client submits payment proof (EIP-3009 signature or transaction hash), service verifies and releases the resource. Three schemes are supported: `exact` (gasless EIP-3009), `onchain` (direct tx verification), and `receipt` (reuse prior payments). Read `references/payment-flows.md` for implementation details.

### Pattern 5: Cost Intelligence Dashboard

Use `/api/v2/analytics/spend` for spending data and `/api/v2/analytics/recommendations` for optimization suggestions. The recommendations endpoint identifies cheaper model alternatives and estimates potential savings. Use `/api/v2/providers/compare` to show users real-time pricing comparisons.

## Reference Files

Read these when you need deeper detail than this overview provides:

- **`references/api-reference.md`** -- Complete endpoint documentation with TypeScript interfaces, request/response examples, error codes, and authentication details. Read this when generating integration code.

- **`references/routing-guide.md`** -- Deep dive on the routing engine: scoring algorithm, provider capabilities, model tiers, failover logic, and advanced configuration like custom weights, provider exclusion, and capability filtering. Read this when the user needs fine-grained routing control.

- **`references/payment-flows.md`** -- x402 protocol implementation: the 3-step payment flow, EIP-3009 gasless transfers, onchain verification, receipt reuse, USDC contract addresses, and the settlement lifecycle. Read this when the user is integrating payment settlement.

- **`references/a2a-protocol.md`** -- Google A2A protocol integration: JSON-RPC methods, task lifecycle, agent discovery, AP2 mandates, the x402 payment extension, and the Bazaar service marketplace. Read this when the user is building agent-to-agent systems.

## Tech Stack Context

P402 is a Next.js App Router application using TypeScript. The design system follows neo-brutalist principles: primary color #B6FF2E (lime), 2px borders, no rounded corners, IBM Plex Sans + monospace fonts. When generating UI code for P402-related interfaces, follow this aesthetic.
