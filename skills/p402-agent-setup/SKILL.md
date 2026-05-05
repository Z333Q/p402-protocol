---
name: p402-agent-setup
version: 0.2.0
description: Guide developers through setting up P402 as their AI routing and payment layer for autonomous agents and AI tools. Covers OpenClaw, CrewAI, AutoGPT, LangChain, custom Python or TypeScript agents, and any framework that accepts an OpenAI-compatible endpoint. Handles secrets management for Zo Computer, Replit, Railway, Render, Fly.io, VPS, and Docker. Use this skill whenever a user asks about connecting an agent to P402, configuring an OpenAI-compatible provider with a different baseURL, installing the P402 MCP server, managing budget caps and session lifecycles, multi-rail stablecoin settlement on Base or Tempo, the @p402/mpp-method package, mppx integration, x402 backwards compatibility, paying for AI agent traffic with USDC or USDC.e, or running an always-on agent without unbounded inference costs. Trigger on mentions of OpenClaw, MCP server, agent hosting, autonomous agent budget, multi-rail payment routing, Tempo settlement, Base settlement, mppx, x402, or any phrasing about pointing an agent at P402.
---

# P402 Agent Setup Skill

Help developers integrate P402 as the AI routing and payment infrastructure for autonomous agents. The goal is the cleanest possible path from "I have an agent running somewhere" to "my agent routes all inference through P402 with budget caps, semantic caching, and on-chain settlement on Base or Tempo."

## Core Context

P402 is an OpenAI-compatible API. Any agent framework or tool that can call an OpenAI-style endpoint can use P402 as a drop-in provider. **This is the key architectural insight: P402 is not a plugin or SDK dependency. It is a base URL swap.**

P402 settles on multiple rails:

- **Base mainnet** (chain 8453) for USDC and EURC via EIP-3009 gasless transfers
- **Tempo mainnet** (chain 4217) for USDC.e, USDT0, cUSD, and seven other TIP-20 stablecoins, with gas paid in stablecoin

Auto-routing picks the cheaper rail by default (Tempo, when both are healthy). Users can override per request.

The three integration depths, from simplest to richest:

1. **Provider swap** (5 minutes): Change `baseURL` to `https://p402.io/api/v2` and set the API key. The agent gets 300+ model routing, semantic caching, and Billing Guard protection with zero code changes.

2. **MCP server** (10 minutes): Install `@p402/mcp-server` globally or locally. The agent gains 6 tools for active session management, provider comparison, and health monitoring. The agent can self-manage its own budget.

3. **SDK or `@p402/mpp-method` integration** (30 minutes): Import `@p402/sdk` for high-level operations, or `@p402/mpp-method` for direct mppx-protocol integration when building custom server infrastructure.

Most agent users want option 1 or 2. Reach for option 3 only when building a custom agent framework, integrating mppx directly, or needing programmatic control over sessions and mandates.

## Decision Tree

When a user describes their setup, identify two things:

1. **What agent framework?** This determines provider configuration.
2. **What hosting environment?** This determines secrets management.

Then route to the appropriate reference file:

- For **OpenClaw** (any hosting): Read `references/openclaw.md`
- For **other agent frameworks** (CrewAI, AutoGPT, LangChain, custom): Read `references/generic-agent.md`
- For **environment and secrets** questions specific to Zo Computer, VPS, Railway, Replit, etc.: Read `references/environments.md`

If the user mentions both an agent framework and a hosting environment, read both relevant files and synthesize a complete answer.

## Response Guidelines

When responding to agent setup questions:

1. **Lead with the simplest working config.** Show the exact JSON, YAML, or code block they need to paste. No preamble about what P402 is.

2. **Recommend `model: "auto"` for routing decisions.** Most agents do not need to specify a model. P402's auto-routing selects the optimal model based on the routing mode. Specifying a model is the override path, not the default.

3. **Include the security note about keys.** Agent VMs persist env vars across reboots. Never commit keys to Git-tracked workspace files. Use `.env` with `.gitignore`, or the platform's secrets manager.

4. **Show the session workflow.** After the provider is connected, walk them through: create session with budget cap, fund with stablecoin, start chatting. This is where the "aha" of budget controls clicks.

5. **Mention routing modes.** Most agent users benefit from `cost` mode (autonomous agents burn tokens fast). `balanced` is the default. `quality` is for high-stakes tasks. `speed` is for real-time conversational agents.

6. **Flag the MCP server as the upgrade path** for agents that run 24/7 and need to self-monitor spend.

7. **Use the P402 design system voice.** Direct, technical, no fluff. No em dashes. Commas, periods, colons, semicolons only.

## P402 Technical Reference

### Endpoints

- **Chat completions:** `POST https://p402.io/api/v2/chat/completions`
- **Sessions:** `POST https://p402.io/api/v2/sessions`
- **Fund session:** `POST https://p402.io/api/v2/sessions/fund`
- **Session stats:** `GET https://p402.io/api/v2/sessions/{id}/stats`
- **Provider comparison:** `POST https://p402.io/api/v2/providers/compare`
- **Models list:** `GET https://p402.io/api/v2/models`
- **Health:** `GET https://p402.io/api/v2/health`
- **Status page:** `https://www.p402.io/status` (no auth required, for uptime checks)
- **Dashboard:** `https://p402.io/dashboard` (session management, funding, analytics)

### Authentication

Two paths are supported:

- **API key:** `Authorization: Bearer <P402_API_KEY>` (recommended for agent integrations; created at p402.io)
- **mppx Payment credential:** `Authorization: Payment <base64url JSON credential>` (for clients integrating the Machine Payments Protocol directly)

x402 backwards compatibility: existing `X-PAYMENT` and `X-PAYMENT-REQUIRED` headers are accepted through May 2027.

### Request Body (Chat Completions)

Standard OpenAI-compatible body with an optional `p402` extension block:

```json
{
  "messages": [{"role": "user", "content": "..."}],
  "model": "auto",
  "p402": {
    "mode": "cost",
    "cache": true,
    "session_id": "sess_xxx",
    "preferred_rail": "auto",
    "analytics_tag": "research-agent-v1"
  }
}
```

When `model` is `"auto"` or omitted, P402 selects the optimal model for the routing mode. To target a specific model, use the OpenRouter-style identifier (e.g., `anthropic/claude-opus-4.7`, `openai/gpt-4o`, `groq/llama-3.3-70b`) as returned by `/api/v2/models`.

### Routing Modes

- `cost`: Cheapest capable model (DeepSeek V3, Haiku 4.5, GPT-4o-mini)
- `quality`: SOTA model (Claude Opus 4.7, GPT-5, Gemini 3 Pro)
- `speed`: Lowest TTFB (Groq LPU, Flash models)
- `balanced`: Weighted score 0.4 cost + 0.3 speed + 0.3 quality (default)

Simple Mode: a zero-cost heuristic gate runs before full routing on every request. For straightforward queries (5-question complexity score ≥ 4/5), it routes direct to a cheap model and skips the full intelligence pipeline. Hidden by default; the agent does not need to configure it.

### Multi-Rail Settlement

`preferred_rail` accepts `"tempo"`, `"base"`, or `"auto"` (default).

Auto-selection logic:

1. Skip rails with degraded facilitator health (poll interval 30s, threshold > 1% errors over 5 minutes).
2. Skip rails that don't support the requested currency.
3. Among healthy and currency-compatible rails, pick the cheaper.
4. Tie-break to Tempo (lower gas).
5. On settlement failure, retry on next-best rail (max 2 retries).

Most agents leave this as `"auto"`. Override only when there is a specific reason (cross-chain interop, jurisdictional preferences, etc.).

### Response Metadata

Every response includes a `p402_metadata` object:

```json
{
  "provider": "anthropic",
  "model": "anthropic/claude-sonnet-4.6",
  "cost_usd": 0.0023,
  "direct_cost": 0.0031,
  "savings": 0.0008,
  "input_tokens": 1200,
  "output_tokens": 450,
  "cached": false,
  "latency_ms": 1840,
  "payment_rail": "tempo",
  "charge_amount_raw": "1000",
  "analytics_tag": "research-agent-v1"
}
```

`payment_rail` indicates which chain settled the charge. `charge_amount_raw` is the bigint amount in the smallest token unit, as a string. `analytics_tag` echoes the tag from the request, useful for cost attribution per agent, feature, or customer.

### MCP Server

- **Package:** `@p402/mcp-server` on npm
- **Binary:** `p402-mcp`
- **Transport:** stdio
- **Tools:** `p402_chat`, `p402_create_session`, `p402_get_session`, `p402_list_models`, `p402_compare_providers`, `p402_health`

### Session Lifecycle

1. **Create:** `POST /api/v2/sessions` with `{ "budget_usd": 5 }`. Returns a `session_id`.
2. **Fund:** Pay USDC on Base or USDC.e on Tempo (whichever rail is preferred), then `POST /api/v2/sessions/fund` with `{ session_id, amount, tx_hash }`.
3. **Use:** Include `session_id` in the `p402` options block on every chat request.
4. **Monitor:** `GET /api/v2/sessions/{id}/stats` for usage analytics, or check the dashboard.
5. **States:** `active` | `exhausted` | `expired` | `ended` | `revoked`.

For now, funding is handled by the user (send stablecoin from a wallet). Embedded fiat-to-stablecoin onramp is on the roadmap.

### Billing Guard (Always Active)

Six layers protect every request:

- Rate limit: 1,000 req/hr per user (per payer address on the mppx path)
- Daily circuit breaker: $1,000/day cap (configurable per tenant)
- Concurrency: max 10 simultaneous reservations per user
- Anomaly detection: Z-score ≥ 3.0 from history (soft block)
- Per-request cap: $50 hard ceiling
- Atomic budget reservation: 5-minute TTL with automatic release on failure

A 429 response with structured JSON indicates a Billing Guard rejection. The error body identifies which layer fired.

### `@p402/mpp-method` Package

For developers building their own server infrastructure (not just calling P402's HTTP API), the `@p402/mpp-method` package on npm provides direct mppx-protocol integration with two methods:

- `p402Charge`: Multi-rail charge with auto-selection between Base and Tempo
- `baseCharge`: Direct EIP-3009 settlement on Base mainnet or Sepolia

Use this when building a custom agent framework that needs to issue or verify payment credentials directly. For most agent users, the HTTP API is the right surface.

### Upcoming (not yet shipped)

The following are on the roadmap and not yet available. Do not promise these to users as currently functional:

- **Session intent (`@p402/mpp-method` v0.2):** Per-token settlement via off-chain vouchers with periodic on-chain settlement. Enables true per-token pricing for the cheapest models. Target: Q3 2026.
- **Embedded fiat onramp:** Card-to-stablecoin funding directly in the dashboard. Target: post-Phase 4.
- **External security audit:** Scheduled for v0.3 of `@p402/mpp-method`. Target: Q4 2026.

## Keywords

OpenClaw, Zo Computer, Replit, Railway, Render, Fly.io, agent setup, provider configuration, MCP server, API key management, budget caps, session management, autonomous agent, always-on agent, OpenAI compatible, base URL, agent hosting, VM setup, cloud agent, personal AI agent, CrewAI, AutoGPT, LangChain, agent framework integration, p402 provider, routing mode, USDC settlement, USDC.e Tempo, multi-rail payment, Base settlement, Tempo settlement, mppx, x402, @p402/mpp-method, @p402/mcp-server, @p402/sdk, MCP, machine payments protocol, AI agent budget, AI agent costs, OpenRouter alternative, model routing, semantic cache.
