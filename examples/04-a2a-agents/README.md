# Example 04 — A2A Agents with x402 Payment Gate

Two agents communicating via the [Google A2A protocol](https://github.com/google-a2a) over JSON-RPC 2.0. The service agent requires payment via x402 before responding.

## What It Shows

- Agent discovery via `/.well-known/agent.json`
- Submitting a task to an A2A agent (`tasks/send`)
- Handling `payment-required` messages in the A2A task flow
- Using AP2 mandates for pre-authorized spending

## Setup

```bash
cd examples/04-a2a-agents
npm install
export P402_API_KEY=p402_live_...
```

## Run

```bash
npx tsx index.ts
```

## A2A Task Lifecycle

```
Client Agent
    │
    ├─→ GET /.well-known/agent.json          # Discover capabilities
    │
    ├─→ POST /api/a2a                        # tasks/send
    │       { jsonrpc: '2.0', method: 'tasks/send', params: { message } }
    │
    │   ← 402 payment-required              # Agent needs payment
    │       { x402Version, paymentRequirements }
    │
    ├─→ POST /api/v1/facilitator/verify      # Verify payment authorization
    ├─→ POST /api/v1/facilitator/settle      # Settle USDC on Base
    │
    ├─→ POST /api/a2a                        # Retry task with payment proof
    │       { ..., payment: { proof, receipt } }
    │
    │   ← Task completed
    │       { status: 'completed', artifacts: [...] }
```

## Links

- [A2A Protocol guide](../../docs/a2a-protocol.md)
- [x402 Payments guide](../../docs/x402-payments.md)
