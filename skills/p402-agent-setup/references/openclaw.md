# OpenClaw Integration Reference

[OpenClaw](https://github.com/openclaw/openclaw) is an open-source personal AI agent framework that runs as a persistent daemon on a user's machine or cloud VM. It connects to messaging platforms (WhatsApp, Telegram, Slack, Discord, iMessage, and others) and takes real-world actions. It is model-agnostic and configures providers in `openclaw.json`.

## Why P402 fits OpenClaw

OpenClaw agents run 24/7. Without budget controls, they accumulate unbounded inference costs across heartbeats, tool calls, sub-agent tasks, and background checks.

P402 solves three things at once:

1. **Session-scoped budget caps.** Set a hard ceiling. The agent stops when it hits the limit. No surprise bills.
2. **Semantic caching.** Cache hits return at zero cost in under 50ms via embedding similarity (>0.92 cosine threshold), tenant-scoped. OpenClaw's repetitive heartbeat traffic is cached aggressively.
3. **Multi-rail settlement on Base or Tempo.** Tempo settlement is materially cheaper than Base for high-volume agents. Auto-routing picks the cheaper healthy rail per request.

OpenClaw's model-agnostic gateway accepts any OpenAI-compatible provider, and P402 is exactly that.

## Option A: Provider Configuration (simplest)

OpenClaw configures providers in `openclaw.json` (or the equivalent config in the workspace). Add P402 as an OpenAI-compatible provider:

```json
{
  "providers": {
    "p402": {
      "type": "openai",
      "baseURL": "https://p402.io/api/v2",
      "apiKey": "${P402_API_KEY}"
    }
  }
}
```

Set `p402` as the default provider in the agent's model configuration. Every inference call from the OpenClaw agent now routes through P402.

### What the agent gets immediately

- Automatic model selection via `model: "auto"` based on routing mode
- Semantic cache: repeated or near-identical queries return cached responses at zero cost
- Billing Guard: 6-layer spending protection prevents runaway costs
- Multi-rail stablecoin settlement on Base or Tempo (auto-routed by default)
- Access to 300+ models without configuring each provider individually

### Recommended routing mode for OpenClaw

Most OpenClaw agents should use `cost` mode. Autonomous agents generate high request volumes, and cost mode routes to the cheapest capable model per request. For specific high-stakes tasks (code review, legal analysis, complex reasoning), the agent can override to `quality` on individual requests.

If OpenClaw's config supports per-request body modifications, set:

```json
{
  "p402": {
    "mode": "cost",
    "cache": true,
    "preferred_rail": "auto"
  }
}
```

### Fallback chain

OpenClaw supports exponential backoff and provider fallback. P402 can be the primary with a direct API key as the secondary:

```json
{
  "providers": {
    "p402": {
      "type": "openai",
      "baseURL": "https://p402.io/api/v2",
      "apiKey": "${P402_API_KEY}"
    },
    "anthropic-direct": {
      "type": "anthropic",
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  }
}
```

If P402 is unreachable, the agent falls back to direct Anthropic. In normal operation, all requests go through P402 for routing intelligence and budget controls.

## Option B: MCP Server (richer integration)

OpenClaw supports MCP servers natively. The P402 MCP server gives the agent 6 tools for active budget and provider management.

### Installation

```bash
npm install -g @p402/mcp-server
```

### OpenClaw MCP Configuration

Add to the agent's MCP server list (in `openclaw.json` or the workspace MCP config):

```json
{
  "mcpServers": {
    "p402": {
      "command": "p402-mcp",
      "env": {
        "P402_API_KEY": "${P402_API_KEY}"
      }
    }
  }
}
```

### Tools available to the agent

| Tool | What the agent can do with it |
|---|---|
| `p402_chat` | Route a message through the AI router with mode selection |
| `p402_create_session` | Create a new budget-capped session when the current one is exhausted |
| `p402_get_session` | Check remaining budget before executing expensive tasks |
| `p402_list_models` | Browse available models and their pricing |
| `p402_compare_providers` | Compare provider costs for a given token count |
| `p402_health` | Check router and facilitator health |

### Self-managing budget pattern

With the MCP server, the OpenClaw agent can be instructed (via SOUL.md or system instructions) to manage its own budget actively:

1. Check session balance before expensive operations using `p402_get_session`
2. Switch to `cost` mode when budget drops below 20% remaining
3. Notify the user via messaging channel when budget drops below 10%
4. Compare providers before large batch operations using `p402_compare_providers`

Example SOUL.md addition:

```markdown
## Budget Management

Before any task that may consume significant tokens (code generation, research, long-form writing), check your P402 session balance using the p402_get_session tool. If remaining budget is below $1.00, notify the user and suggest funding the session. Default to cost routing mode for routine tasks. Use quality mode only when the user explicitly requests high-quality output, or the task involves code review, legal analysis, or complex reasoning.

Tag every task with an appropriate analytics_tag (e.g., "morning-briefing", "user-research", "code-review") so spending can be attributed per workflow in the dashboard.
```

## Option C: SDK and `@p402/mpp-method`

For users building custom OpenClaw skills that need programmatic session management:

```bash
npm install @p402/sdk
```

```typescript
import { P402Client } from '@p402/sdk';

const p402 = new P402Client({
  routerUrl: 'https://p402.io',
  apiKey: process.env.P402_API_KEY,
});

const session = await p402.createSession({ budget_usd: 5 });

const response = await p402.chat({
  model: 'auto',
  messages: [{ role: 'user', content: 'Analyze this document...' }],
  p402: {
    mode: 'balanced',
    cache: true,
    session_id: session.id,
    analytics_tag: 'document-analysis',
  },
});

console.log(response.p402_metadata);
// { provider, model, cost_usd, direct_cost, savings, cached, latency_ms, payment_rail, charge_amount_raw, analytics_tag, ... }
```

For OpenClaw skills that need to issue or verify mppx payment credentials directly (rare; only needed for custom server integration), the `@p402/mpp-method` package on npm provides the lower-level primitives. Most OpenClaw users do not need this.

## Common questions

### "Do I need to change my agent's model setting?"

No. With `model: "auto"` (or `model` omitted), P402 selects the optimal model for the routing mode. If the agent's config specifies a specific model (e.g., `anthropic/claude-opus-4.7`), P402 routes to that exact model. The routing intelligence activates only when the model field is `auto` or omitted.

### "Will caching work with my agent's context?"

Yes. P402's semantic cache uses embedding similarity (>0.92 cosine threshold) and is tenant-scoped. Repetitive queries (heartbeats, tool calls, status checks) hit the cache and return at zero cost in under 50ms. This is especially valuable for OpenClaw's heartbeat cycle.

### "What about streaming?"

P402 supports SSE streaming, which is the default for OpenClaw's agent loop. The streaming `finalChunk` includes the full `p402_metadata` block. No special configuration needed.

### "Can multiple agents share a session?"

Sessions are tied to an API key, not a specific agent instance. Multiple OpenClaw agents (or a single agent with multiple workspaces) can share a session by using the same `session_id`. Budget consumption tracks across all requests to that session.

For attribution, set a different `analytics_tag` per agent so the dashboard shows spend by agent.

### "Which rail should my agent settle on?"

Leave `preferred_rail: "auto"`. The router picks the cheaper healthy rail per request and tie-breaks to Tempo (which has lower gas costs). Override only if you have a specific reason to prefer Base (e.g., your wallet is funded with USDC on Base and you want to avoid bridging).

### "How do I see what my agent has been spending?"

The dashboard at `https://p402.io/dashboard` shows session balances, spend history, model usage, cache hit rates, and per-tag analytics. The `analytics_tag` field on each request is the primary attribution dimension.

### "What happens if Base or Tempo settlement fails mid-call?"

The router automatically retries on the next-best rail (max 2 retries). The agent does not need to handle this; from the agent's perspective, the call either succeeds or returns an error after exhausting retries. Failures are logged in the response metadata.
