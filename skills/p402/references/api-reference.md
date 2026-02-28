# P402 API Reference

Complete endpoint documentation for P402.io V2 API. All endpoints use JSON request/response bodies and require authentication via Bearer token.

## Table of Contents
1. [Authentication](#authentication)
2. [Chat Completions](#chat-completions)
3. [Sessions](#sessions)
4. [Providers](#providers)
5. [Analytics](#analytics)
6. [Cache](#cache)
7. [TypeScript Interfaces](#typescript-interfaces)
8. [Error Handling](#error-handling)
9. [Response Headers](#response-headers)

---

## Authentication

All requests require a Bearer token in the Authorization header:

```
Authorization: Bearer <P402_API_KEY>
```

Multi-tenant requests can specify a tenant via header:

```
X-P402-Tenant: <tenant_id>
```

If no tenant header is provided, the `default` tenant is used.

---

## Chat Completions

### `POST /api/v2/chat/completions`

OpenAI-compatible chat completion with P402 orchestration. Supports streaming, multi-provider routing, semantic caching, and real-time cost tracking.

**Request Body:**

```typescript
{
  // OpenAI-compatible fields
  model?: string,              // Optional: specific model. Omit to let P402 route.
  messages: ChatMessage[],     // Required: conversation messages
  temperature?: number,        // Default: 0.7
  max_tokens?: number,
  top_p?: number,
  frequency_penalty?: number,
  presence_penalty?: number,
  stop?: string | string[],
  stream?: boolean,            // Enable SSE streaming
  tools?: any[],               // Function calling tools
  tool_choice?: any,
  response_format?: { type: 'text' | 'json_object' },
  user?: string,

  // P402 Extensions
  p402?: {
    mode?: 'cost' | 'quality' | 'speed' | 'balanced',  // Routing mode
    prefer_providers?: string[],    // Preferred providers (ordered)
    exclude_providers?: string[],   // Providers to exclude
    require_capabilities?: string[], // e.g., ['vision', 'code']
    max_cost?: number,              // Max cost per request in USD
    session_id?: string,            // Session for budget tracking
    cache?: boolean,                // Enable semantic caching
    cache_ttl?: number,             // Cache TTL in seconds
    failover?: boolean,             // Enable automatic failover
    tenant_id?: string              // Multi-tenant isolation
  }
}
```

**Response (non-streaming):**

```typescript
{
  id: string,
  object: 'chat.completion',
  created: number,
  model: string,                     // Actual model used (may differ from requested)
  choices: [{
    index: number,
    message: {
      role: 'assistant',
      content: string,
      tool_calls?: any[]
    },
    finish_reason: string
  }],
  usage: {
    prompt_tokens: number,
    completion_tokens: number,
    total_tokens: number
  },
  p402_metadata: {
    request_id: string,
    tenant_id: string,
    provider: string,                // e.g., 'openai', 'anthropic', 'groq'
    model: string,                   // e.g., 'gpt-4o-mini', 'claude-sonnet-4-6'
    cost_usd: number,               // Actual cost of this request
    latency_ms: number,             // Total latency including routing overhead
    provider_latency_ms: number,    // Provider-only latency
    cached: boolean,                // Whether response came from semantic cache
    routing_mode: string            // Mode that was applied
  }
}
```

**Response Headers:**

```
X-P402-Request-ID: req_abc123
X-P402-Provider: anthropic
X-P402-Cost-USD: 0.0034
X-P402-Latency-MS: 847
```

**Streaming:** When `stream: true`, the response is Server-Sent Events (SSE) in OpenAI-compatible format. Each chunk is `data: {json}\n\n` with the final chunk being `data: [DONE]\n\n`.

**Example (TypeScript):**

```typescript
const response = await fetch('https://p402.io/api/v2/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.P402_API_KEY}`
  },
  body: JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a helpful assistant.' },
      { role: 'user', content: 'Explain quantum computing briefly.' }
    ],
    p402: {
      mode: 'cost',
      session_id: 'sess_abc123',
      cache: true
    }
  })
});

const data = await response.json();
console.log(`Provider: ${data.p402_metadata.provider}`);
console.log(`Cost: $${data.p402_metadata.cost_usd}`);
console.log(`Cached: ${data.p402_metadata.cached}`);
```

**Example (Python):**

```python
import requests

response = requests.post(
    "https://p402.io/api/v2/chat/completions",
    headers={"Authorization": f"Bearer {API_KEY}"},
    json={
        "messages": [{"role": "user", "content": "Explain quantum computing briefly."}],
        "p402": {"mode": "cost", "session_id": "sess_abc123", "cache": True}
    }
)

data = response.json()
print(f"Provider: {data['p402_metadata']['provider']}")
print(f"Cost: ${data['p402_metadata']['cost_usd']}")
```

**Example (curl):**

```bash
curl https://p402.io/api/v2/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $P402_API_KEY" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "p402": {"mode": "balanced", "cache": true}
  }'
```

---

## Sessions

### `POST /api/v2/sessions`

Create a new session with budget and optional policies.

**Request Body:**

```typescript
{
  agent_identifier?: string,     // Label for the agent using this session
  budget_usd?: number,           // Total budget in USD (default varies)
  expires_in_hours?: number,     // Session duration (default: 24)
  policy?: {
    type: 'spending' | 'provider' | 'model' | 'task',
    // ... policy-specific config (see V2 spec)
  }
}
```

**Response:**

```typescript
{
  object: 'session',
  id: string,                    // e.g., 'sess_abc123'
  tenant_id: string,
  agent_identifier: string | null,
  budget: {
    total_usd: number,
    used_usd: number,
    remaining_usd: number,
    utilization_percent: number
  },
  status: 'active' | 'exhausted' | 'expired' | 'ended' | 'revoked',
  created_at: string,            // ISO 8601
  expires_at: string
}
```

**Example:**

```typescript
const session = await fetch('https://p402.io/api/v2/sessions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${P402_API_KEY}`,
    'X-P402-Tenant': 'my_tenant'
  },
  body: JSON.stringify({
    agent_identifier: 'research-agent-v1',
    budget_usd: 5.00,
    expires_in_hours: 4
  })
});
```

### `GET /api/v2/sessions`

List sessions for the authenticated tenant. Accepts `?status=active` query parameter (default: `active`). Returns up to 100 sessions ordered by creation date descending.

### `GET /api/v2/sessions/:id`

Get detailed session info including budget utilization, time remaining, and active/expired status. The endpoint auto-expires sessions that have passed their `expires_at` timestamp.

**Response includes:**

```typescript
{
  // ... standard session fields ...
  meta: {
    is_active: boolean,
    is_expired: boolean,
    time_remaining_seconds: number | null
  }
}
```

### `DELETE /api/v2/sessions/:id`

End a session immediately. Sets status to `ended` and records `ended_at` timestamp. Remaining budget is released.

---

## Providers

### `GET /api/v2/providers`

List all available providers and their models with pricing, capabilities, and health status.

### `POST /api/v2/providers/compare`

Compare model pricing for a specific workload.

**Request Body:**

```typescript
{
  input_tokens: number,          // Estimated input tokens
  output_tokens: number,         // Estimated output tokens
  capabilities?: string[],      // Filter by capability: 'chat', 'code', 'vision', 'reasoning'
  tier?: 'budget' | 'mid' | 'premium',
  exclude_providers?: string[]
}
```

**Response:**

```typescript
{
  object: 'provider_comparison',
  models: [{
    rank: number,
    model: string,               // e.g., 'deepseek/deepseek-r1'
    provider: string,
    tier: string,
    cost: number,                // Total cost for the given token counts
    cost_breakdown: { input: number, output: number },
    quality_score: number,
    context_window: number,
    input_cost_per_1k: number,
    output_cost_per_1k: number
  }],
  picks: {
    cheapest: { model: string, cost: number },
    best_value: { model: string, cost: number, quality_score: number },
    fastest: { model: string, tier: string }
  }
}
```

---

## Analytics

### `GET /api/v2/analytics/spend`

Returns spending analytics for the authenticated tenant over a configurable time period.

### `GET /api/v2/analytics/recommendations`

Returns personalized cost optimization recommendations based on actual usage patterns. Recommendations include: switching to cheaper models, enabling caching, using cost-optimized routing, and identifying underutilized capabilities.

**Response:**

```typescript
{
  recommendations: [{
    id: string,
    type: 'model_switch' | 'rate_optimization' | 'caching' | 'provider_change',
    priority: 'high' | 'medium' | 'low',
    title: string,
    description: string,
    potential_savings_percent: number,
    implementation: string        // Code-level guidance
  }]
}
```

---

## Cache

### `GET /api/v2/cache/stats`

Cache hit rate, total savings, and entry count.

### `POST /api/v2/cache/invalidate`

Invalidate cache entries by namespace or pattern.

### `PUT /api/v2/cache/config`

Update cache settings (similarity threshold, TTL, max age).

### `GET /api/v2/cache/entries`

Browse cached entries for debugging.

---

## TypeScript Interfaces

These are the core types from P402's codebase that developers should use:

```typescript
// === Session Types ===

interface P402Session {
  session_id: string;
  tenant_id: string;
  agent_identifier?: string;
  balance_usdc: number;
  budget_total: number;
  budget_spent: number;
  budget: {
    total_usd: number;
    used_usd: number;
    remaining_usd: number;
  };
  policy?: Record<string, unknown>;
  status: 'active' | 'exhausted' | 'expired' | 'ended' | 'revoked';
  created_at: string;
  expires_at: string;
  ended_at?: string;
}

interface CreateSessionRequest {
  agent_identifier?: string;
  budget_usd?: number;
  expires_in_hours?: number;
  policy?: Record<string, unknown>;
}

interface FundSessionRequest {
  session_id: string;
  amount: string | number;
  tx_hash?: string;
  source?: 'base_pay' | 'direct' | 'test';
  network?: 'base' | 'base_sepolia';
}

// === Chat Types ===

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; image_url?: any }>;
  name?: string;
  tool_calls?: any[];
  tool_call_id?: string;
}

interface P402Options {
  mode?: 'cost' | 'quality' | 'speed' | 'balanced';
  prefer_providers?: string[];
  exclude_providers?: string[];
  require_capabilities?: string[];
  max_cost?: number;
  session_id?: string;
  cache?: boolean;
  cache_ttl?: number;
  failover?: boolean;
  tenant_id?: string;
}

interface P402Metadata {
  request_id: string;
  tenant_id: string;
  provider: string;
  model: string;
  cost_usd: number;
  latency_ms: number;
  provider_latency_ms: number;
  cached: boolean;
  routing_mode: string;
}

// === Routing Types ===

type RoutingMode = 'cost' | 'quality' | 'speed' | 'balanced';

interface RoutingWeights {
  cost: number;
  quality: number;
  speed: number;
}

interface RoutingOptions {
  mode: RoutingMode | RoutingWeights;
  task?: string;
  requiredCapabilities?: string[];
  minContextWindow?: number;
  maxCostPerRequest?: number;
  preferProviders?: string[];
  excludeProviders?: string[];
  preferTier?: 'budget' | 'mid' | 'premium';
  maxTier?: 'budget' | 'mid' | 'premium';
  failover?: {
    enabled: boolean;
    maxRetries: number;
    fallbackProviders?: string[];
  };
  rateLimitStrategy?: 'switch' | 'queue' | 'fail';
}

// === Billing Guard Types ===

interface BillingContext {
  userId: string;
  sessionId?: string;
  tenantId?: string;
}

interface CostEstimate {
  estimatedCost: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

// BillingGuardError codes:
// 'RATE_LIMIT_EXCEEDED' -- hourly request cap exceeded, retryAfterMs provided
// 'DAILY_LIMIT_EXCEEDED' -- daily spend cap reached
// 'TOO_MANY_CONCURRENT' -- concurrent request limit hit
// 'REQUEST_TOO_EXPENSIVE' -- single request exceeds per-request cost cap
// Default limits are configurable per tenant at https://p402.io/dashboard
```

---

## Error Handling

P402 returns standard HTTP status codes with structured error bodies:

```typescript
{
  error: {
    type: string,       // e.g., 'not_found', 'rate_limit', 'billing_error'
    message: string,    // Human-readable description
    code?: string,      // Machine-readable code (e.g., 'RATE_LIMIT_EXCEEDED')
    retryAfterMs?: number  // When to retry (for rate limits)
  }
}
```

| Status | Meaning |
|--------|---------|
| 200 | Success |
| 400 | Bad request (malformed body, missing required fields) |
| 401 | Invalid or missing API key |
| 402 | Payment required (x402 flow) |
| 404 | Resource not found (session, mandate) |
| 429 | Rate limited (check `retryAfterMs`) |
| 500 | Internal server error |
| 502 | Upstream provider error (failover may retry) |
| 503 | Service temporarily unavailable |

---

## Response Headers

Every chat completion response includes P402-specific headers:

| Header | Value | Example |
|--------|-------|---------|
| `X-P402-Request-ID` | Unique request identifier | `req_abc123` |
| `X-P402-Provider` | Provider that served the request | `anthropic` |
| `X-P402-Cost-USD` | Cost of this request in USD | `0.0034` |
| `X-P402-Latency-MS` | Total latency in milliseconds | `847` |

---

**Ready to integrate?** Get your API key at [p402.io](https://p402.io). Try the [P402 Mini App](https://mini.p402.io) for an instant demo with USDC on Base. Full API explorer and test playground available in the [P402 dashboard](https://p402.io/dashboard).
