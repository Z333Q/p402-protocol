# @p402/cli

[![npm](https://img.shields.io/npm/v/@p402/cli?color=B6FF2E)](https://www.npmjs.com/package/@p402/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](../../LICENSE)

Official CLI for the [P402 AI Payment Router](https://p402.io).

## Installation

```bash
# Use without installing (recommended for quick start)
npx p402 --help

# Or install globally
npm install -g @p402/cli
```

## Quick Start

```bash
# 1. Authenticate (saves key to ~/.p402/config.json)
npx p402 login

# 2. Chat via the cheapest provider
npx p402 chat "Explain EIP-3009 in one sentence" --mode cost

# 3. Check facilitator status
npx p402 health
```

## Commands

### `p402 login`
```
p402 login [--key <apiKey>] [--url <routerUrl>]
```
Stores your API key in `~/.p402/config.json`. Get your key at [p402.io/dashboard/settings](https://p402.io/dashboard/settings).

### `p402 config`
```
p402 config [--json]
```
Show current CLI configuration (API key masked).

### `p402 chat <message>`
```
p402 chat <message> [--mode cost|quality|speed|balanced] [--model <id>]
                    [--session <id>] [--stream] [--json]
```
Send a chat message through the P402 router.

| Flag | Default | Description |
|---|---|---|
| `--mode` | `balanced` | Routing mode |
| `--model` | (auto) | Override model (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
| `--session` | — | Attach to an existing session ID |
| `--stream` | false | Stream tokens as they arrive |
| `--json` | false | Print full API response as JSON |

### `p402 health`
```
p402 health [--json]
```
Check P402 facilitator health (status, network, gas price, block number).

### `p402 plan`
```
p402 plan [--json] [--current]
```
Print the P402 plan ladder — Sandbox / Build / Growth / Scale / Enterprise —
matching the router's rate card v2 (effective 2026-06-21). `--json` emits the
rate card as machine-readable JSON. `--current` will show the authenticated
tenant's plan and month-to-date event usage once the router exposes a
Bearer-authed endpoint; until then it points to the dashboard.

### `p402 models list`
```
p402 models list [--json]
```
List all available models across providers.

### `p402 providers list`
```
p402 providers list [--json]
```
List all AI providers with status and latency.

### `p402 providers compare`
```
p402 providers compare [--prompt <text>] [--json]
```
Compare providers for a given prompt.

### `p402 session list`
```
p402 session list [--json]
```
List active sessions and their budgets.

### `p402 session get <id>`
```
p402 session get <id> [--json]
```
Get session details including budget breakdown.

### `p402 session create`
```
p402 session create --budget <usd> [--agent <id>] [--wallet <address>]
                    [--expires <hours>] [--json]
```
Create a new budget-capped session.

| Flag | Default | Description |
|---|---|---|
| `--budget` | required | Budget in USD (e.g. `5.00`) |
| `--agent` | — | Agent ID to associate |
| `--wallet` | — | Wallet address |
| `--expires` | `24` | Expire after N hours |

### `p402 session fund <id> <amount>`
```
p402 session fund <id> <amount> [--tx <hash>] [--json]
```
Add budget to an existing session. Provide `--tx` if topping up via on-chain transfer.

### `p402 mandate list`
```
p402 mandate list [--status active|exhausted|expired|revoked] [--json]
```
List AP2 spending mandates.

### `p402 mandate create`
```
p402 mandate create --user <did> --agent <did> --max <usd>
                    [--categories <list>] [--until <iso>] [--type <type>] [--json]
```
Create a new AP2 spending mandate.

| Flag | Default | Description |
|---|---|---|
| `--user` | required | User DID (e.g. `did:pkh:eip155:8453:0x...`) |
| `--agent` | required | Agent DID |
| `--max` | required | Maximum spend in USD |
| `--categories` | — | Comma-separated allowed categories |
| `--until` | never | Expiry in ISO 8601 (e.g. `2026-12-31T00:00:00Z`) |
| `--type` | `payment` | `intent` \| `cart` \| `payment` |

### `p402 analytics spend`
```
p402 analytics spend [--period 1d|7d|30d] [--json]
```
View spend analytics (total, per-request average, top providers).

### `p402 agent register <address>`
```
p402 agent register <walletAddress> [--json]
```
Check if a wallet address is registered in the World AgentKit AgentBook contract on Base mainnet. Returns registration status, `human_verified` flag, and free-trial usage remaining.

### `p402 agent status`
```
p402 agent status [--address <addr>] [--json]
```
Show World AgentKit status for the agent at `--address` (or the wallet in `P402_AGENT_ADDRESS`). Returns registration state, human ID, AgentKit enablement flag, and network.

## Configuration

The CLI reads config from (in priority order):
1. Environment variables: `P402_API_KEY`, `P402_ROUTER_URL`
2. Config file: `~/.p402/config.json`

```json
{
  "apiKey": "p402_live_...",
  "routerUrl": "https://p402.io"
}
```

## Links

- [Getting started guide](../../docs/getting-started.md)
- [Full CLI reference](../../docs/cli-reference.md)
- [Dashboard](https://p402.io/dashboard)
