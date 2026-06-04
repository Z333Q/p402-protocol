<!-- mcp-name: io.github.Z333Q/p402 -->

# @p402/mcp-server

> MCP server for the P402 AI Payment Router — route 300+ AI models with per-request USDC micropayments on Base L2.

P402 sits between your AI agent and every major LLM provider. It intelligently selects the best model for each request based on cost, quality, or latency, and settles payment on-chain via the [x402 protocol](https://x402.org) — 1% flat fee, no per-transaction minimums.

## Installation

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "p402": {
      "command": "npx",
      "args": ["-y", "@p402/mcp-server"],
      "env": {
        "P402_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### VS Code / Cursor / JetBrains AI

Search for **p402** in the MCP server browser, or add the same configuration above to your editor's MCP settings.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `P402_API_KEY` | Yes | Your P402 API key — get one at [p402.io/dashboard/settings](https://p402.io/dashboard/settings) |
| `P402_ROUTER_URL` | No | Override the router URL (default: `https://p402.io`) |

## Tools

### `p402_chat`

Route a chat completion through P402's multi-provider router.

```
message        string   The user message
mode           string   cost | quality | speed | balanced (default: balanced)
model          string   Pin a specific model (optional)
session_id     string   Attach to a session budget (optional)
system         string   System prompt (optional)
```

**Returns:** The model's response plus `p402_metadata` (provider, model used, cost in USD, latency).

### `p402_create_session`

Create a budget-capped session for cost-controlled agent runs.

```
budget_usd          number   Budget in USD (e.g. 1.00)
agent_id            string   Agent identifier for attribution (optional)
expires_in_hours    number   Session TTL (default: 24)
```

**Returns:** Session object with `id` — pass this as `session_id` to `p402_chat`.

### `p402_get_session`

Check remaining budget and status for a session.

```
session_id    string   The session ID to query
```

### `p402_list_models`

List all available models with pricing and provider details.

### `p402_compare_providers`

Compare providers side-by-side for a given task type.

```
task_type    string   chat | embedding | code | reasoning (optional)
```

### `p402_agent_status`

Check World AgentKit registration status and credit balance for a wallet address.

```
wallet_address    string   The Base wallet address to check (optional — uses P402_AGENT_ADDRESS env if omitted)
```

**Returns:** `{ registered, human_verified, human_usage_remaining, reputation_score, credits_remaining }`

Enable World AgentKit awareness by setting `P402_WORLD_ID_ENABLED=true` in the MCP server environment.

### `p402_health`

Check router and on-chain facilitator health.

## Example workflow

```
1. Call p402_create_session with budget_usd: 0.50
2. Use the returned session id in all p402_chat calls
3. Call p402_get_session to monitor remaining budget
4. The session auto-deactivates when budget is exhausted
```

## Links

- [Documentation](https://p402.io/docs)
- [API Reference](https://p402.io/docs/api)
- [GitHub](https://github.com/Z333Q/p402-protocol)
- [npm: @p402/sdk](https://www.npmjs.com/package/@p402/sdk)

## License

MIT
