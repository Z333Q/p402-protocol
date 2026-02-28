# A2A Protocol

P402 implements the [Google A2A specification](https://github.com/google-a2a) — Agent-to-Agent communication over JSON-RPC 2.0.

## Concepts

| Term | Description |
|---|---|
| **AgentCard** | Metadata manifest at `/.well-known/agent.json` — capabilities, skills, endpoints |
| **Task** | Unit of work with state machine: `pending → processing → completed \| failed \| cancelled` |
| **Artifact** | Output produced by a task (structured data parts) |
| **Part** | Content unit — `{ type: 'text', text: '...' }` or `{ type: 'data', data: any }` |
| **Skill** | Declared agent capability — `{ id, name, description, tags[] }` |
| **Streaming** | SSE-based real-time task updates via `/api/a2a/stream` |

## Agent Discovery

```
GET https://p402.io/.well-known/agent.json
```

```json
{
  "protocolVersion": "0.2.0",
  "name": "P402 AI Payment Router",
  "description": "Multi-provider AI routing with x402 payment settlement",
  "url": "https://p402.io",
  "capabilities": { "streaming": true, "pushNotifications": false },
  "skills": [
    {
      "id": "ai.route",
      "name": "AI Routing",
      "description": "Route completion requests to optimal providers",
      "tags": ["ai", "routing", "llm"]
    }
  ],
  "extensions": [
    { "uri": "tag:x402.org,2025:x402-payment" }
  ],
  "endpoints": {
    "a2a": {
      "jsonrpc": "https://p402.io/api/a2a",
      "stream": "https://p402.io/api/a2a/stream"
    }
  }
}
```

## JSON-RPC Methods

All requests go to `POST /api/a2a`:

```json
{
  "jsonrpc": "2.0",
  "method": "<method>",
  "id": "<request-id>",
  "params": { ... }
}
```

### `tasks/send`

Submit a task:

```json
{
  "jsonrpc": "2.0",
  "method": "tasks/send",
  "id": "req-1",
  "params": {
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Summarize this document..." }]
    },
    "contextId": "conversation-abc"
  }
}
```

### `tasks/get`

```json
{
  "method": "tasks/get",
  "params": { "id": "task-xyz" }
}
```

### `tasks/cancel`

```json
{
  "method": "tasks/cancel",
  "params": { "id": "task-xyz" }
}
```

### `tasks/sendSubscribe`

Submit + subscribe to SSE updates in one call.

## Task Response

```json
{
  "result": {
    "id": "task-xyz",
    "contextId": "conversation-abc",
    "status": {
      "state": "completed",
      "timestamp": "2025-01-01T00:00:00Z"
    },
    "artifacts": [{
      "parts": [{ "type": "text", "text": "Here is the summary..." }]
    }],
    "metadata": {
      "cost_usd": 0.000089,
      "latency_ms": 412
    }
  }
}
```

## Streaming (SSE)

```
GET /api/a2a/stream?taskId=task-xyz
Authorization: Bearer p402_live_...
```

Events:
```
event: task.status
data: { "state": "processing" }

event: task.artifact
data: { "parts": [{ "type": "text", "text": "..." }] }

event: task.completed
data: { "state": "completed" }
```

## x402 Payment Extension

When a task requires payment, P402 sends a `payment-required` message part:

```json
{
  "status": {
    "state": "processing",
    "message": {
      "parts": [{
        "type": "data",
        "data": {
          "type": "payment-required",
          "x402Version": 2,
          "paymentRequirements": {
            "scheme": "exact",
            "network": "eip155:8453",
            "maxAmountRequired": "1000000",
            "payTo": "0xFa772434DCe6ED78831EbC9eeAcbDF42E2A031a6",
            "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
          }
        }
      }]
    }
  }
}
```

Client verifies + settles, then retries the task with the payment proof.

## AP2 Mandates

AP2 mandates let users pre-authorize agents to spend on their behalf:

### Create a Mandate

```
POST /api/v2/governance/mandates
```

```json
{
  "user_did": "did:pkh:eip155:8453:0xUser...",
  "agent_did": "did:pkh:eip155:8453:0xAgent...",
  "type": "payment",
  "constraints": {
    "max_amount_usd": 50.00,
    "allowed_categories": ["ai.completion", "ai.embedding"],
    "valid_until": "2026-12-31T00:00:00Z"
  }
}
```

### Mandate Status

| Status | Meaning |
|---|---|
| `active` | Mandate valid, budget available |
| `exhausted` | Spending limit reached |
| `expired` | `valid_until` passed |
| `revoked` | Manually cancelled |

### Error Codes

| Code | Meaning |
|---|---|
| `MANDATE_NOT_FOUND` | No mandate with that ID |
| `MANDATE_INACTIVE` | Status is not `active` |
| `MANDATE_EXPIRED` | `valid_until` in the past |
| `MANDATE_BUDGET_EXCEEDED` | `amount_spent_usd + requested > max_amount_usd` |
| `MANDATE_CATEGORY_DENIED` | Action not in `allowed_categories` |

## Agent Listing

```
GET /api/a2a/agents
GET /api/a2a/agents/:agentId
```

Returns all registered agents and their AgentCards.

## Error Handling

A2A errors use JSON-RPC error codes — never HTTP 402 for billing failures:

```json
{
  "error": {
    "code": -32000,
    "message": "Billing cap reached",
    "data": { "code": "DAILY_LIMIT_EXCEEDED" }
  }
}
```

Standard codes: `-32700` (parse), `-32600` (invalid request), `-32601` (method not found), `-32602` (invalid params), `-32603` (internal), `-32000` (block errors — billing/auth).
