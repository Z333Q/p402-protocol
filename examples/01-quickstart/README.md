# Example 01 — Quickstart

Authenticate, send a chat message, and view spend data in ~20 lines of TypeScript.

## Setup

```bash
cd examples/01-quickstart
npm install
export P402_API_KEY=p402_live_...
```

## Run

```bash
npx tsx index.ts
```

## What It Does

1. Creates a `P402Client` with your API key
2. Checks router health
3. Sends a chat request in `cost` mode (cheapest provider)
4. Prints the response and `p402_metadata` (provider, cost_usd, latency_ms)
