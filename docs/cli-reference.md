# CLI Reference

Full reference for `@p402/cli` (`npx p402`).

## Installation

```bash
# No install needed
npx p402 --help

# Global install
npm install -g @p402/cli
p402 --help
```

## Global Options

| Flag | Description |
|---|---|
| `-v, --version` | Print CLI version |
| `--help` | Show help for any command |

## Configuration

Config file: `~/.p402/config.json`
```json
{ "apiKey": "p402_live_...", "routerUrl": "https://p402.io" }
```

Environment variables (override config file):
- `P402_API_KEY` — API key
- `P402_ROUTER_URL` — Router base URL

---

## Commands

### `p402 login`

Authenticate and save credentials.

```bash
p402 login
p402 login --key p402_live_...
p402 login --key p402_live_... --url https://p402.io
```

| Option | Description |
|---|---|
| `--key <apiKey>` | API key (skip interactive prompt) |
| `--url <routerUrl>` | Router URL (default: `https://p402.io`) |

---

### `p402 config`

Show current configuration.

```bash
p402 config
p402 config --json
```

---

### `p402 chat <message>`

Send a single-turn chat message.

```bash
p402 chat "What is Base blockchain?"
p402 chat "Write a haiku" --mode quality
p402 chat "Translate to French: Hello" --model gpt-4o
p402 chat "Summarize this" --session sess_abc123
p402 chat "Tell me a story" --stream
p402 chat "List providers" --json
```

| Option | Default | Description |
|---|---|---|
| `--mode <mode>` | `balanced` | `cost` \| `quality` \| `speed` \| `balanced` |
| `--model <id>` | (auto) | Override model (e.g. `gpt-4o`, `claude-3-5-sonnet`) |
| `--session <id>` | — | Attach to an existing session |
| `--stream` | false | Stream tokens as they arrive (SSE) |
| `--json` | false | Output full API response as JSON |

---

### `p402 health`

Check facilitator health.

```bash
p402 health
p402 health --json
```

Output:
```
P402 Facilitator Health
─────────────────────────
  status        healthy
  network       eip155:8453
  treasury      0xFa772...
  gas (gwei)    0.12
  block         23847291
```

---

### `p402 models list`

List all available models.

```bash
p402 models list
p402 models list --json
```

---

### `p402 providers list`

List all AI providers with status and latency.

```bash
p402 providers list
p402 providers list --json
```

---

### `p402 providers compare`

Compare provider pricing for a prompt.

```bash
p402 providers compare --prompt "Summarize in 100 words"
p402 providers compare --json
```

---

### `p402 session list`

List active sessions.

```bash
p402 session list
p402 session list --json
```

---

### `p402 session get <id>`

Get session details.

```bash
p402 session get sess_abc123
p402 session get sess_abc123 --json
```

---

### `p402 session create`

Create a new session with a budget.

```bash
p402 session create --budget 5.00
p402 session create --budget 10 --agent my-agent --expires 48
p402 session create --budget 1 --wallet 0x... --json
```

| Option | Default | Description |
|---|---|---|
| `--budget <usd>` | required | Budget in USD |
| `--agent <id>` | — | Agent ID for analytics |
| `--wallet <address>` | — | Wallet address |
| `--expires <hours>` | `24` | Auto-expire after N hours |
| `--json` | false | Output as JSON |

---

### `p402 session fund <id> <amount>`

Add budget to a session.

```bash
p402 session fund sess_abc123 5.00
p402 session fund sess_abc123 5.00 --tx 0x... --json
```

| Option | Description |
|---|---|
| `--tx <hash>` | On-chain tx hash for the top-up |
| `--json` | Output as JSON |

---

### `p402 mandate list`

List AP2 spending mandates.

```bash
p402 mandate list
p402 mandate list --status active
p402 mandate list --json
```

| Option | Description |
|---|---|
| `--status <status>` | Filter: `active` \| `exhausted` \| `expired` \| `revoked` |
| `--json` | Output as JSON |

---

### `p402 mandate create`

Create a new AP2 spending mandate.

```bash
p402 mandate create \
  --user "did:pkh:eip155:8453:0xUser..." \
  --agent "did:pkh:eip155:8453:0xAgent..." \
  --max 50.00 \
  --categories "ai.completion,ai.embedding" \
  --until "2026-12-31T00:00:00Z"
```

| Option | Default | Description |
|---|---|---|
| `--user <did>` | required | User DID |
| `--agent <did>` | required | Agent DID |
| `--max <usd>` | required | Maximum spend in USD |
| `--categories <list>` | — | Comma-separated allowed categories |
| `--until <iso>` | never | Expiry date (ISO 8601) |
| `--type <type>` | `payment` | `intent` \| `cart` \| `payment` |
| `--json` | false | Output as JSON |

---

### `p402 analytics spend`

View spend analytics.

```bash
p402 analytics spend
p402 analytics spend --period 30d
p402 analytics spend --json
```

| Option | Default | Description |
|---|---|---|
| `--period <period>` | `7d` | `1d` \| `7d` \| `30d` |
| `--json` | false | Output as JSON |
