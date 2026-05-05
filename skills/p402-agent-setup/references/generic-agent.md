# Generic Agent Framework Integration Reference

This reference covers integrating P402 with agent frameworks other than OpenClaw: CrewAI, AutoGPT, LangChain or LangGraph, Semantic Kernel, custom Python or TypeScript agents, and any framework that accepts an OpenAI-compatible endpoint.

## Universal Principle

P402 exposes an OpenAI-compatible API at `https://p402.io/api/v2`. Any tool, framework, or library that can call the OpenAI chat completions endpoint can use P402 by changing two values:

1. **Base URL:** `https://p402.io/api/v2`
2. **API Key:** Your P402 API key (created at the dashboard)

The `p402` options block (routing mode, caching, session ID, preferred rail, analytics tag) is passed as an additional field in the request body. Frameworks that allow custom request body fields can use it directly. Frameworks that do not still work with P402 defaults (`balanced` mode, caching enabled, auto rail selection).

The recommended model identifier is `"auto"`. P402 picks the best model for the routing mode. If a specific model is needed, use the OpenRouter-style identifier (e.g., `anthropic/claude-opus-4.7`, `openai/gpt-4o`, `groq/llama-3.3-70b`) as returned by `GET /api/v2/models`.

## Framework-Specific Configurations

### Python (OpenAI SDK)

```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="https://p402.io/api/v2",
    api_key=os.environ["P402_API_KEY"],
)

response = client.chat.completions.create(
    model="auto",
    messages=[{"role": "user", "content": "..."}],
    extra_body={
        "p402": {
            "mode": "cost",
            "cache": True,
            "session_id": "sess_xxx",
            "preferred_rail": "auto",
            "analytics_tag": "research-agent",
        }
    },
)

# Access P402 metadata
meta = response.model_extra.get("p402_metadata", {})
print(f"Cost: ${meta.get('cost_usd')}, Rail: {meta.get('payment_rail')}")
```

The `extra_body` parameter passes additional fields to the request body. This is how routing mode, session binding, rail preference, and analytics tag are controlled.

### TypeScript / JavaScript (OpenAI SDK)

```typescript
import OpenAI from 'openai';

interface P402Options {
  mode?: 'cost' | 'quality' | 'speed' | 'balanced';
  cache?: boolean;
  session_id?: string;
  preferred_rail?: 'auto' | 'base' | 'tempo';
  analytics_tag?: string;
}

interface P402ChatRequest extends OpenAI.ChatCompletionCreateParams {
  p402?: P402Options;
}

const client = new OpenAI({
  baseURL: 'https://p402.io/api/v2',
  apiKey: process.env.P402_API_KEY!,
});

const response = await client.chat.completions.create({
  model: 'auto',
  messages: [{ role: 'user', content: '...' }],
  p402: {
    mode: 'cost',
    cache: true,
    session_id: 'sess_xxx',
    preferred_rail: 'auto',
    analytics_tag: 'research-agent',
  },
} satisfies P402ChatRequest);
```

The local `P402ChatRequest` type extends OpenAI's request type with the `p402` field, avoiding `@ts-ignore` and providing autocomplete on the options block.

### LangChain (Python)

```python
import os
from langchain_openai import ChatOpenAI

llm = ChatOpenAI(
    base_url="https://p402.io/api/v2",
    api_key=os.environ["P402_API_KEY"],
    model="auto",
    extra_body={
        "p402": {
            "mode": "balanced",
            "cache": True,
            "session_id": "sess_xxx",
            "preferred_rail": "auto",
            "analytics_tag": "langchain-agent",
        }
    },
)
```

LangChain's `ChatOpenAI` (in `langchain-openai` ≥ 0.2) supports `extra_body` for passing additional fields. For older LangChain versions, use `model_kwargs` instead. Verify against the version in your project; LangChain has shifted the field name multiple times.

### CrewAI

CrewAI uses LangChain under the hood. Configure the LLM as in the LangChain section, then pass it to your crew:

```python
from crewai import Agent, Crew

researcher = Agent(
    role="Researcher",
    llm=llm,
    goal="...",
    backstory="...",
)
```

Tag each agent with a different `analytics_tag` so the dashboard breaks down spend by role.

### AutoGPT / Auto-GPT Forge

AutoGPT uses provider configurations in its settings. Set the OpenAI-compatible provider:

```yaml
llm:
  provider: openai
  base_url: https://p402.io/api/v2
  api_key: ${P402_API_KEY}
  model: auto
```

AutoGPT does not natively support custom request body fields. P402 will use defaults: `balanced` mode, caching enabled, auto rail selection. To control routing mode or pass an analytics tag, modify AutoGPT's request construction to include the `p402` field. This is typically a 5-line patch in the OpenAI provider adapter.

### cURL (direct API)

For custom agents making raw HTTP calls:

```bash
curl -X POST https://p402.io/api/v2/chat/completions \
  -H "Authorization: Bearer $P402_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "..."}],
    "p402": {
      "mode": "cost",
      "cache": true,
      "session_id": "sess_xxx",
      "preferred_rail": "auto",
      "analytics_tag": "curl-agent"
    }
  }'
```

### Semantic Kernel (.NET)

```csharp
var kernel = Kernel.CreateBuilder()
    .AddOpenAIChatCompletion(
        modelId: "auto",
        endpoint: new Uri("https://p402.io/api/v2"),
        apiKey: Environment.GetEnvironmentVariable("P402_API_KEY"))
    .Build();
```

Semantic Kernel's OpenAI connector does not natively support custom body fields. P402 defaults apply.

### `@p402/mpp-method` (advanced)

For developers building their own server infrastructure (not just calling P402's HTTP API), the `@p402/mpp-method` package on npm provides direct mppx-protocol integration:

```bash
npm install @p402/mpp-method mppx viem
```

```typescript
import { Mppx } from 'mppx/server';
import { p402Charge } from '@p402/mpp-method';
import { privateKeyToAccount } from 'viem/accounts';

const facilitator = privateKeyToAccount(process.env.FACILITATOR_KEY as `0x${string}`);
const treasury = process.env.TREASURY_ADDRESS as `0x${string}`;

const mppx = Mppx.create({
  methods: [p402Charge({ account: facilitator, treasury })],
  secretKey: process.env.MPP_SECRET_KEY!,
});

export const POST = mppx.charge({ amount: '0.001', recipient: treasury })(
  async (req) => Response.json({ ok: true })
);
```

Use this when building a custom agent framework that needs to issue or verify payment credentials directly, or when running your own facilitator. Most agent users should stick with the HTTP API.

## Session Management for Agents

Autonomous agents should create a session with a budget cap before starting work. This prevents runaway costs from agent loops, retries, and hallucination-driven tool call spirals.

### Recommended session workflow

1. At agent startup, create a session:

   ```bash
   curl -X POST https://p402.io/api/v2/sessions \
     -H "Authorization: Bearer $P402_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"budget_usd": 10}'
   ```

2. Store the returned `session_id` in the agent's state.

3. Include `session_id` and an `analytics_tag` in every chat request's `p402` block.

4. Periodically check remaining budget:

   ```bash
   curl https://p402.io/api/v2/sessions/{session_id}/stats \
     -H "Authorization: Bearer $P402_API_KEY"
   ```

5. When budget approaches exhaustion (status `exhausted`), the agent should stop and notify the user, or fund the session with additional stablecoin and resume.

### Funding a session

For now, funding is handled by the user sending stablecoin from a wallet:

- **Base mainnet:** USDC (chain ID 8453)
- **Tempo mainnet:** USDC.e (chain ID 4217)

After the on-chain transfer confirms, call `POST /api/v2/sessions/fund` with `{ session_id, amount, tx_hash }` to credit the session.

The dashboard at `https://p402.io/dashboard` provides a UI for session creation, funding, and balance tracking.

### Budget sizing guidelines

| Agent type | Suggested starting budget | Routing mode |
|---|---|---|
| Heartbeat / monitoring agent | $1 to $5 | cost |
| Research / browsing agent | $5 to $20 | balanced |
| Coding agent | $10 to $50 | balanced or quality |
| Multi-agent orchestrator | $20 to $100 | balanced |

These are starting points. Actual burn rate depends on context window size, tool call frequency, and task complexity. The dashboard provides real-time cost tracking for calibration.

## Cost Attribution with Analytics Tags

Set a different `analytics_tag` per agent, feature, or customer to see spend broken down in the dashboard. Examples:

- `analytics_tag: "morning-briefing"` for a daily summary agent
- `analytics_tag: "support-tier-1"` for a customer-facing agent
- `analytics_tag: "code-review"` for a code-review subagent
- `analytics_tag: "user-{user_id}"` for per-user attribution in a multi-tenant app

The tag is echoed in `p402_metadata.analytics_tag` on every response, and aggregated in the dashboard's analytics views.

## Common Pitfalls

**Agent loops burning budget faster than expected.** Set a per-request cap via `max_cost` in the `p402` block, or use `mode: "cost"` to floor the model selection. Monitor the daily circuit breaker; the agent will hit the $1,000/day cap if it loops uncontrolled.

**Cache misses on creative tasks.** The semantic cache helps with repetitive queries (heartbeats, status checks). It will not help with creative or one-shot generation. This is by design.

**`extra_body` not making it to the request.** Some OpenAI SDK wrappers strip non-standard fields. Verify by checking `p402_metadata.cached` or `payment_rail` in the response. If they are absent, the `p402` block is being dropped before the request leaves your code.

**Streaming clients not seeing metadata.** SSE streaming includes `p402_metadata` in the final chunk. Make sure your client reads the full stream rather than terminating after the first content delta.

**Funding a session on the wrong rail.** If you fund with USDC on Base but configure `preferred_rail: "tempo"`, the session balance is on Base and Tempo settlement requires bridging. Either fund the rail you'll settle on, or use `preferred_rail: "auto"` to let the router pick.
