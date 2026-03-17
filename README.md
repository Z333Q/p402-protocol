# P402 Protocol

[![npm @p402/sdk](https://img.shields.io/npm/v/@p402/sdk?label=%40p402%2Fsdk&color=B6FF2E)](https://www.npmjs.com/package/@p402/sdk)
[![npm @p402/cli](https://img.shields.io/npm/v/@p402/cli?label=%40p402%2Fcli&color=B6FF2E)](https://www.npmjs.com/package/@p402/cli)
[![npm @p402/mcp-server](https://img.shields.io/npm/v/@p402/mcp-server?label=%40p402%2Fmcp-server&color=B6FF2E)](https://www.npmjs.com/package/@p402/mcp-server)
[![VS Code Marketplace](https://img.shields.io/visual-studio-marketplace/v/p402-protocol.p402?label=VS%20Code&color=B6FF2E)](https://marketplace.visualstudio.com/items?itemName=p402-protocol.p402)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Docs](https://img.shields.io/badge/docs-p402.io-black)](https://p402.io/docs)

**AI payment router.** Route across 300+ models, pay per request in USDC on Base.

P402 sits between your AI application and every LLM provider. It handles intelligent multi-provider routing (cost / quality / speed / balanced), on-chain micropayment settlement via the [x402 protocol](https://x402.org) (gasless USDC on Base), and spending guardrails for autonomous agents.

---

## Why P402

| Problem | P402 Solution |
|---|---|
| Hardcoded to one AI provider | Route across 300+ models automatically |
| $0.30 payment fees kill micropayments | USDC on Base: fractions of a cent per settlement |
| No spending limits for AI agents | Session budgets + AP2 mandate governance |
| Fragmented provider APIs | One OpenAI-compatible endpoint |
| No visibility into AI costs | Real-time analytics + optimization suggestions |

---

## Quick Start (VS Code / Cursor / Windsurf)

Install the extension — the MCP server is embedded, tools appear in Copilot agent mode immediately, no config files required:

```
ext install p402-protocol.p402
```

Then run `P402: Configure API Key` from the command palette.

→ [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=p402-protocol.p402) · [Open VSX](https://open-vsx.org/extension/p402-protocol/p402)

---

## Quick Start (Claude Desktop / any MCP client)

```json
{
  "mcpServers": {
    "p402": {
      "command": "npx",
      "args": ["-y", "@p402/mcp-server"],
      "env": { "P402_API_KEY": "p402_live_..." }
    }
  }
}
```

→ [MCP docs](https://p402.io/docs/mcp) · [MCP Registry](https://registry.modelcontextprotocol.io)

---

## Quick Start (SDK)

```bash
npm install @p402/sdk
```

```typescript
import P402Client from '@p402/sdk';

const p402 = new P402Client({ apiKey: process.env.P402_API_KEY });

// Drop-in OpenAI replacement — P402 picks the best provider
const response = await p402.chat({
  messages: [{ role: 'user', content: 'Explain x402 payments in one sentence.' }],
  p402: { mode: 'cost' }   // cost | quality | speed | balanced
});

console.log(response.choices[0].message.content);
// p402_metadata: { provider: 'deepseek', cost_usd: 0.00031, latency_ms: 412 }
```

---

## Quick Start (CLI)

```bash
# Authenticate once
npx p402 login

# Chat using the cheapest provider
npx p402 chat "What is x402?" --mode cost

# Check facilitator health
npx p402 health
```

---

## Routing Modes

| Mode | Optimizes For | Typical Provider |
|---|---|---|
| `cost` | Lowest price | DeepSeek V3, Haiku 4.5, GPT-4o-mini |
| `quality` | Best output | Claude Opus 4.6, GPT-5, Gemini 3 Pro |
| `speed` | Lowest latency | Groq LPU, Flash models |
| `balanced` | Equal weight (default) | Sonnet 4.6, GPT-4o, Gemini Flash |

---

## Session Budgets

Enforce hard spending caps for autonomous agents:

```typescript
// Create a $10 session — agent cannot spend a cent more
const session = await p402.createSession({ budget_usd: 10 });

// All chat requests are deducted from the session
const response = await p402.chat({
  messages,
  p402: { session_id: session.id, mode: 'cost' }
});

// Check remaining budget
const { budget } = await p402.getSession(session.id);
console.log(`$${budget.remaining_usd} remaining`);
```

---

## x402 Payments

x402 is a machine-native payment protocol using HTTP 402. AI agents pay for resources using gasless EIP-3009 USDC transfers on Base L2.

```
Client → signs EIP-3009 authorization
       → POST /api/v1/facilitator/verify
       → POST /api/v1/facilitator/settle
Facilitator → executes transferWithAuthorization
            → pays gas (user pays zero gas)
            → returns { success, txHash, receipt }
```

Network: **Base Mainnet** (Chain ID: 8453) · Asset: **USDC** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

→ [x402 payments guide](docs/x402-payments.md)

---

## A2A Protocol

P402 implements the [Google A2A spec](https://github.com/google-a2a) over JSON-RPC 2.0. Agents communicate through structured tasks, discover capabilities via `/.well-known/agent.json`, and settle payments via the x402 extension.

```typescript
// Discover P402's capabilities
GET https://p402.io/.well-known/agent.json

// Submit a task
POST https://p402.io/api/a2a
{ "jsonrpc": "2.0", "method": "tasks/send", "params": { ... } }
```

→ [A2A protocol guide](docs/a2a-protocol.md)

---

## Packages

| Package | Description | Version |
|---|---|---|
| [`@p402/sdk`](packages/sdk/) | TypeScript SDK — P402Client, types, EIP-712 mandate helpers | [![npm](https://img.shields.io/npm/v/@p402/sdk)](https://www.npmjs.com/package/@p402/sdk) |
| [`@p402/cli`](packages/cli/) | CLI tool — login, chat, sessions, mandates, analytics | [![npm](https://img.shields.io/npm/v/@p402/cli)](https://www.npmjs.com/package/@p402/cli) |
| [`@p402/mcp-server`](packages/mcp-server/) | stdio MCP server — 6 tools over Model Context Protocol | [![npm](https://img.shields.io/npm/v/@p402/mcp-server)](https://www.npmjs.com/package/@p402/mcp-server) |
| [`p402` VS Code extension](packages/vscode/) | Embedded MCP server for VS Code, Cursor, and Windsurf — zero config | [![Marketplace](https://img.shields.io/visual-studio-marketplace/v/p402-protocol.p402)](https://marketplace.visualstudio.com/items?itemName=p402-protocol.p402) |

---

## Examples

| Example | What It Shows |
|---|---|
| [01-quickstart](examples/01-quickstart/) | Login → chat → view spend in ~20 lines |
| [02-openai-migration](examples/02-openai-migration/) | Drop-in OpenAI SDK replacement |
| [03-nextjs-session-budget](examples/03-nextjs-session-budget/) | Budget-capped AI in a Next.js App Router project |
| [04-a2a-agents](examples/04-a2a-agents/) | Two agents communicating with x402 payment gate |

---

## Docs

| Guide | |
|---|---|
| [Getting Started](docs/getting-started.md) | Account, API key, first request |
| [Authentication](docs/authentication.md) | API keys, env vars, security |
| [Routing Guide](docs/routing-guide.md) | Modes, scoring, providers, models |
| [x402 Payments](docs/x402-payments.md) | EIP-3009, wire format, settlement |
| [Sessions](docs/sessions.md) | Session lifecycle + budget enforcement |
| [A2A Protocol](docs/a2a-protocol.md) | JSON-RPC, mandates, Bazaar |
| [CLI Reference](docs/cli-reference.md) | Full CLI command reference |
| [OpenAPI Spec](docs/openapi.yaml) | Machine-readable API schema |

---

## Community

- **Dashboard:** [p402.io/dashboard](https://p402.io/dashboard)
- **Docs:** [p402.io/docs](https://p402.io/docs)
- **Issues:** [GitHub Issues](https://github.com/Z333Q/p402-protocol/issues)
- **Security:** See [SECURITY.md](SECURITY.md) for responsible disclosure
- **Contributing:** See [CONTRIBUTING.md](CONTRIBUTING.md)

---

## License

MIT © [P402 Protocol](https://p402.io)
