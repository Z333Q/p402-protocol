# P402 Routing Guide

Deep dive on the P402 smart routing engine: how it selects providers, scores models, handles failover, and how developers can fine-tune routing behavior.

## Table of Contents
1. [How Routing Works](#how-routing-works)
2. [Scoring Algorithm](#scoring-algorithm)
3. [Provider Landscape](#provider-landscape)
4. [Model Tiers](#model-tiers)
5. [Advanced Configuration](#advanced-configuration)
6. [Failover and Rate Limit Handling](#failover-and-rate-limit-handling)
7. [Common Routing Patterns](#common-routing-patterns)

---

## How Routing Works

When a request hits `/api/v2/chat/completions`, the routing engine executes this sequence:

1. **Parse** the request and extract routing hints from the `p402` options
2. **Filter** the model catalog by: availability (provider has valid API key or is accessible via OpenRouter), required capabilities (e.g., vision, code), minimum context window, tier restrictions, provider allowlist/blocklist
3. **Score** every remaining candidate model on three dimensions (cost, quality, speed) using the weights from the selected routing mode
4. **Select** the highest-scoring model
5. **Check** the Billing Guard (6-layer pre-check)
6. **Execute** the request against the selected provider
7. **Failover** to the next-best candidate if the selected provider returns 5xx or 429

The entire routing decision adds less than 50ms of overhead to the request. The routing decision is logged with the full scoring breakdown for observability.

## Scoring Algorithm

The router uses a proprietary weighted scoring model. Each candidate model is evaluated on three normalized dimensions:

**Cost Score:** Based on the model's per-token pricing relative to all available candidates. Cheaper models score higher.

**Quality Score:** Derived from model tier. Premium models (Claude Opus 4.6, GPT-5.2, Gemini 3.1 Pro) score highest. Mid-tier models (Sonnet 4.6, GPT-4o-mini, Gemini Flash) score moderately. Budget models (Haiku 4.5, DeepSeek V3.2, Llama 3.3) score lower but are often the best value.

**Speed Score:** Derived from expected inference speed. Budget and specialized inference models (Groq LPU) score highest. Premium models with larger parameter counts score lower.

**Routing Modes:**

Each mode applies a different weighting strategy:

| Mode | Strategy |
|------|----------|
| `cost` | Heavily favors price, with quality and speed as tiebreakers |
| `quality` | Heavily favors output quality, with cost and speed as tiebreakers |
| `speed` | Heavily favors low latency, with cost and quality as tiebreakers |
| `balanced` | Roughly equal weight across all three dimensions |

You can also pass custom weights to blend your own strategy:

```typescript
p402: {
  mode: { cost: 0.5, quality: 0.3, speed: 0.2 }  // Custom blend
}
```

The exact weighting values and scoring internals are managed by P402 and tuned continuously based on real-world performance data. Use the [provider comparison endpoint](https://p402.io/api/v2/providers/compare) to see how models rank for your specific workload.

## Provider Landscape

P402 accesses 300+ models primarily through **OpenRouter** as the upstream aggregator. This means developers do not need individual API keys for each provider; a single P402 API key provides access to the full catalog.

The provider registry includes direct adapters for:

| Provider | Adapter | Specialty |
|----------|---------|-----------|
| OpenAI | `openai` | GPT-5.2, o3, general purpose |
| Anthropic | `anthropic` | Claude family, long context, coding |
| Google | `google` | Gemini family, multimodal, massive context |
| Groq | `groq` | Ultra-low latency via LPU hardware |
| DeepSeek | `deepseek` | Cost-effective reasoning (R1/V3) |
| Mistral | `mistral` | Open-weight, efficient |
| Perplexity | `perplexity` | Real-time web search augmented |
| AI21 | `ai21` | Jamba/Jurassic models |
| Together | `together` | Open-source model hosting |
| Fireworks | `fireworks` | Fast inference for open models |
| Cohere | `cohere` | Enterprise NLP, RAG |

When a provider has a direct API key configured, P402 can route to it directly. When no direct key exists, it routes through OpenRouter transparently. This gives developers the best of both worlds: direct performance when available, broad coverage always.

## Model Tiers

P402 organizes models into three tiers that drive quality and speed scoring:

**Premium:**
Claude Opus 4.6, GPT-5.2, Gemini 3.1 Pro, o3. The most capable models for complex reasoning, nuanced writing, and multi-step analysis. Use when output quality is paramount.

**Mid:**
Claude Sonnet 4.6, GPT-4o-mini, Gemini Flash, Mistral Large, DeepSeek V3.2. Strong general-purpose models with good cost/quality tradeoffs. The sweet spot for most production workloads.

**Budget:**
Claude Haiku 4.5, Llama 3.3, Devstral 2, DeepSeek R1. Fast and cheap. Best for high-volume tasks where "good enough" quality is acceptable: classification, extraction, summarization, simple Q&A.

You can restrict routing to specific tiers via session policies. Configure this in your [P402 dashboard](https://p402.io/dashboard).

## Advanced Configuration

### Capability Filtering

Request models with specific capabilities:

```typescript
p402: {
  require_capabilities: ['vision', 'code']
  // Only models supporting both vision and code generation
}
```

Available capabilities: `chat`, `code`, `vision`, `reasoning`, `function_calling`.

### Provider Preferences

Steer routing toward or away from specific providers:

```typescript
p402: {
  prefer_providers: ['anthropic', 'openai'],  // Try these first
  exclude_providers: ['deepseek']              // Never route here
}
```

Provider preferences are soft hints: if preferred providers have no suitable models, the router falls back to the full catalog. Exclusions are hard constraints.

### Cost Caps

Prevent expensive requests:

```typescript
p402: {
  max_cost: 0.10  // Reject if estimated cost exceeds $0.10
}
```

This is enforced before the request is sent to the provider, using token count estimation.

## Failover and Rate Limit Handling

### Automatic Failover

When `p402.failover` is true (or when using session-based requests), the router automatically retries with the next-best scoring model if the primary provider returns:
- HTTP 5xx (server error)
- HTTP 429 (rate limited)
- Network timeout

Default: up to 3 retries with exponentially decreasing score threshold.

### Rate Limit Strategy

The `rateLimitStrategy` option controls behavior when a provider is rate-limited:

| Strategy | Behavior |
|----------|----------|
| `switch` | Immediately route to the next-best provider (default) |
| `queue` | Queue the request and retry after the rate limit window |
| `fail` | Return the 429 to the caller immediately |

For production workloads, `switch` is almost always the right choice. Use `fail` only when you need deterministic provider selection and prefer errors over alternative models.

## Common Routing Patterns

### High-Volume Batch Processing

```typescript
// Process 10,000 documents at minimal cost
p402: {
  mode: 'cost',
  cache: true,       // Many documents may be similar
  failover: true     // Don't lose work to transient errors
}
```

### Real-Time Chat Application

```typescript
// User-facing chat where latency matters
p402: {
  mode: 'speed',
  session_id: userSessionId,  // Track per-user spending
  cache: false                // Conversations are unique
}
```

### Code Generation Pipeline

```typescript
// Quality matters, budget matters too
p402: {
  mode: { cost: 0.3, quality: 0.5, speed: 0.2 },
  require_capabilities: ['code'],
  prefer_providers: ['anthropic']  // Claude excels at code
}
```

### Classification / Extraction

```typescript
// High volume, low complexity
p402: {
  mode: 'cost',
  cache: true,        // Many inputs will be similar
  max_cost: 0.01      // These should be cheap
}
```

### Multi-Tier Architecture

Use different modes for different stages of a pipeline:

```typescript
// Stage 1: Classify intent (cheap)
const intent = await p402Chat({
  messages: [{ role: 'user', content: userInput }],
  p402: { mode: 'cost' }
});

// Stage 2: Generate response (quality for complex, cost for simple)
const mode = intent.complexity === 'high' ? 'quality' : 'cost';
const response = await p402Chat({
  messages: conversationHistory,
  p402: { mode, session_id: sessionId }
});
```

This pattern reduces overall costs by 40-60% compared to routing everything through a premium model.

---

**Try it now:** The fastest way to see routing in action is the [P402 Mini App](https://mini.p402.io). Fund with USDC on Base, pick a routing mode, and watch real-time cost tracking as you chat. For API access, get your key at [p402.io](https://p402.io).
