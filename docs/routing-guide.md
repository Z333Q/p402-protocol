# Routing Guide

P402 automatically selects the optimal AI provider for every request based on your routing mode and configured constraints.

## Routing Modes

Set via `p402.mode` in the request body:

| Mode | Optimizes For | Best For | Typical Provider |
|---|---|---|---|
| `cost` | Lowest price | Batch jobs, background tasks, high-volume | DeepSeek V3, Haiku 4.5, GPT-4o-mini |
| `quality` | Best output | User-facing content, complex reasoning | Claude Opus 4.6, GPT-5, Gemini 3 Pro |
| `speed` | Lowest latency (TTFB) | Real-time chat, autocomplete, interactive UX | Groq LPU, Flash models |
| `balanced` | Equal weight | General purpose, default | Sonnet 4.6, GPT-4o, Gemini Flash |

```typescript
// SDK
await p402.chat({
  messages,
  p402: { mode: 'cost' }
});

// fetch
fetch('https://p402.io/api/v2/chat/completions', {
  body: JSON.stringify({ messages, p402: { mode: 'speed' } })
});
```

## How Routing Works

For every request, P402:

1. **Filters** providers by capability (model family, context window, tool use support)
2. **Scores** each candidate with a weighted algorithm:
   - Success rate (historical reliability)
   - P95 settle latency
   - Reputation score (ERC-8004 on-chain)
   - Health status (live probe result)
   - Cost per token
3. **Applies** governance policies (allowed providers, max cost per request)
4. **Selects** the top-scoring provider
5. **Fails over** to the next best if the selected provider errors

## Providers

300+ models across 13+ providers, accessed primarily through OpenRouter plus direct integrations:

| Provider | Models | Notes |
|---|---|---|
| OpenAI | GPT-4o, GPT-4o-mini, o3, o4-mini | Direct integration |
| Anthropic | Claude 4.6 Opus/Sonnet/Haiku | Direct integration |
| Google | Gemini 3 Pro/Flash | Direct integration |
| Groq | Llama, Mixtral | LPU inference — lowest latency |
| DeepSeek | V3, R2 | Lowest cost |
| Mistral | Large, Nemo | European models |
| Cohere | Command R+ | RAG-optimized |
| Perplexity | Sonar | Web-connected |
| Together.ai | Open source models | |
| Fireworks | Optimized inference | |
| AI21 | Jamba | |

List all models:
```bash
npx p402 models list
# or
GET /api/v2/models
```

## Specifying a Model

If you specify a model, P402 routes to that model's provider directly (bypassing routing logic):
```typescript
await p402.chat({
  model: 'claude-3-5-sonnet-20241022',
  messages,
});
```

Omit `model` to let P402 choose based on mode.

## Semantic Cache

When `p402.cache: true`, P402 checks if a semantically similar request was recently answered:

1. Generates an embedding of your request
2. Searches cache entries for cosine similarity above threshold
3. Returns cached response instantly if match found (cost: $0.00)
4. Falls through to provider if no match

```typescript
await p402.chat({
  messages,
  p402: { mode: 'cost', cache: true }
});
// Response includes: p402_metadata.cached = true/false
```

Cache is tenant-scoped (no cross-tenant leakage). Default TTL: 1 hour.

## Response Metadata

Every response includes routing telemetry:

```typescript
response.p402_metadata = {
  provider: 'deepseek',       // Actual provider used
  model: 'deepseek-chat',     // Actual model used
  cost_usd: 0.000089,         // Real cost for this request
  latency_ms: 312,            // End-to-end latency
  cached: false               // Whether response was from cache
}
```

HTTP response headers also expose this:
```
X-P402-Provider: deepseek
X-P402-Cost-USD: 0.000089
X-P402-Latency-MS: 312
X-P402-Request-ID: req_abc123
```

## Governance Policies

You can restrict routing with policies:

```typescript
// Create a policy that only allows cost-optimized providers
await p402.createPolicy({
  name: 'budget-only',
  rules: {
    allowed_modes: ['cost'],
    max_cost_per_request_usd: 0.01,
    blocked_providers: ['openai'],
  }
});
```

Policies are applied on top of routing mode logic and can block requests before they reach providers.
