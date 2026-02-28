# P402 A2A Protocol Guide

Integration guide for Google's Agent-to-Agent (A2A) protocol as implemented by P402, including JSON-RPC messaging, task lifecycle, agent discovery, AP2 mandates, the x402 payment extension, and the Bazaar service marketplace.

## Table of Contents
1. [Overview](#overview)
2. [Agent Discovery](#agent-discovery)
3. [JSON-RPC Messaging](#json-rpc-messaging)
4. [Task Lifecycle](#task-lifecycle)
5. [AP2 Mandates](#ap2-mandates)
6. [x402 Payment Extension](#x402-payment-extension)
7. [The Bazaar](#the-bazaar)
8. [TypeScript Types](#typescript-types)
9. [Complete Integration Example](#complete-integration-example)

---

## Overview

Google's A2A protocol standardizes how AI agents discover and communicate with each other. P402 implements A2A with a payment extension, enabling agents to not just exchange tasks but also settle payments for services rendered.

The protocol uses JSON-RPC 2.0 over HTTPS. Agents discover each other via a well-known endpoint, exchange messages containing tasks and artifacts, and optionally settle payments using the x402 extension.

P402's A2A endpoint: `https://p402.io/api/a2a`

---

## Agent Discovery

Every A2A-compliant agent publishes a discovery document:

```bash
curl https://p402.io/.well-known/agent.json
```

**Response:**

```json
{
  "protocolVersion": "0.1",
  "name": "P402 Router Agent",
  "description": "Payment-aware AI orchestration agent. Routes requests to 300+ models with cost optimization and x402 settlement.",
  "url": "https://p402.io",
  "iconUrl": "https://p402.io/icon.png",
  "version": "2.1.0",
  "capabilities": {
    "streaming": true,
    "pushNotifications": true
  },
  "skills": [
    {
      "id": "ai-routing",
      "name": "AI Model Routing",
      "description": "Route AI requests to optimal provider by cost, speed, or quality",
      "tags": ["ai", "routing", "llm"]
    },
    {
      "id": "cost-intelligence",
      "name": "Cost Intelligence",
      "description": "Compare model pricing and optimize AI spending",
      "tags": ["cost", "analytics", "optimization"]
    }
  ],
  "defaultInputModes": ["text"],
  "defaultOutputModes": ["text"],
  "extensions": [
    {
      "uri": "tag:x402.org,2025:x402-payment",
      "config": {
        "schemes": ["exact", "onchain", "receipt"],
        "assets": ["USDC", "USDT"],
        "networks": ["base"]
      }
    }
  ],
  "endpoints": {
    "a2a": {
      "jsonrpc": "https://p402.io/api/a2a",
      "stream": "https://p402.io/api/a2a/stream"
    }
  }
}
```

To discover other agents, check their `/.well-known/agent.json`. The `skills` array tells you what the agent can do. The `extensions` array tells you what protocols it supports (including x402 for payments).

---

## JSON-RPC Messaging

All A2A communication uses JSON-RPC 2.0:

### `message/send`

Send a message to the P402 agent:

```json
{
  "jsonrpc": "2.0",
  "method": "message/send",
  "params": {
    "message": {
      "role": "user",
      "parts": [
        { "type": "text", "text": "Summarize this document in 3 bullet points." }
      ]
    },
    "configuration": {
      "mode": "cost",
      "maxCost": 0.10,
      "provider": "anthropic",
      "model": "claude-sonnet-4-6"
    }
  },
  "id": 1
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": {
    "task": {
      "id": "task_abc123",
      "contextId": "ctx_xyz",
      "status": {
        "state": "completed",
        "message": {
          "role": "agent",
          "parts": [
            { "type": "text", "text": "Here are the three key points..." }
          ]
        },
        "timestamp": "2026-02-24T10:30:00Z"
      },
      "metadata": {
        "cost_usd": 0.003,
        "latency_ms": 1200
      }
    }
  },
  "id": 1
}
```

The `configuration` object maps directly to P402 routing options. The `contextId` groups related messages into a conversation for multi-turn interactions.

### Message Structure

Messages contain `parts` that can be text or structured data:

```typescript
interface A2AMessage {
  role: 'user' | 'agent' | 'system';
  parts: Array<
    | { type: 'text'; text: string }
    | { type: 'data'; data: any }
  >;
}
```

---

## Task Lifecycle

Every A2A interaction creates a task. Tasks flow through defined states:

```
pending -> processing -> completed
                     \-> failed
                     \-> cancelled
```

| State | Meaning |
|-------|---------|
| `pending` | Task received, not yet started |
| `processing` | Task is being worked on (streaming may be active) |
| `completed` | Task finished successfully, artifacts available |
| `failed` | Task failed (error in metadata) |
| `cancelled` | Task was cancelled by the requester |

Tasks can produce **artifacts** -- discrete outputs attached to the task:

```typescript
interface A2ATask {
  id: string;
  contextId?: string;
  status: {
    state: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
    message?: A2AMessage;
    timestamp: string;
  };
  artifacts?: Array<{
    id: string;
    name: string;
    parts: A2APart[];
  }>;
  metadata?: {
    cost_usd?: number;
    latency_ms?: number;
  };
}
```

---

## AP2 Mandates

AP2 (Agent-to-Platform) mandates are the authorization primitive for agent spending. A mandate is a pre-signed permission granting an agent the right to spend up to a specified amount.

### Create a Mandate

```bash
curl -X POST https://p402.io/api/a2a/mandates \
  -H "Content-Type: application/json" \
  -d '{
    "mandate": {
      "type": "intent",
      "user_did": "did:key:user123",
      "agent_did": "did:key:agent456",
      "constraints": {
        "max_amount_usd": 10.00,
        "allowed_categories": ["ai-inference", "web-search"],
        "valid_until": "2026-03-01T00:00:00Z"
      }
    }
  }'
```

**Response:**

```json
{
  "mandate": {
    "id": "mandate_abc",
    "tenant_id": "tenant_default",
    "type": "intent",
    "user_did": "did:key:user123",
    "agent_did": "did:key:agent456",
    "constraints": {
      "max_amount_usd": 10.00,
      "allowed_categories": ["ai-inference", "web-search"],
      "valid_until": "2026-03-01T00:00:00Z"
    },
    "amount_spent_usd": 0,
    "status": "active"
  }
}
```

### Use a Mandate

When an agent makes a request, it references its mandate. P402 checks:
1. Mandate exists and is active
2. Agent DID matches
3. `amount_spent_usd + request_cost <= max_amount_usd`
4. Category is allowed
5. Current time is before `valid_until`

If all checks pass, the request proceeds and `amount_spent_usd` is atomically incremented.

```bash
curl -X POST https://p402.io/api/a2a/mandates/mandate_abc/use \
  -H "Content-Type: application/json" \
  -d '{
    "amount_usd": 0.05,
    "category": "ai-inference",
    "description": "Claude Sonnet 4.6 completion, 500 tokens"
  }'
```

### Mandate Types

| Type | Use Case |
|------|----------|
| `intent` | Pre-authorize a spending budget for a specific agent |
| `cart` | Authorize a batch of specific services at fixed prices |
| `payment` | One-time payment authorization |

### Mandate Statuses

| Status | Meaning |
|--------|---------|
| `active` | Mandate is valid and has remaining budget |
| `exhausted` | `amount_spent_usd >= max_amount_usd` |
| `expired` | Current time is past `valid_until` |
| `revoked` | Manually revoked by the user |

The fail-closed design means: an agent cannot spend a single cent without a valid, active mandate with available budget.

---

## x402 Payment Extension

P402 implements the A2A x402 extension for cryptographic payment negotiation within agent conversations. The extension URI is:

```
tag:x402.org,2025:x402-payment
```

### Three-Message Payment Flow

Within an A2A conversation, payments follow a 3-message flow using dedicated JSON-RPC methods:

**1. `x402/payment-required`** (Agent to Client)

```json
{
  "method": "x402/payment-required",
  "params": {
    "payment_id": "pay_123",
    "schemes": [
      {
        "scheme": "exact",
        "recipient": "0xb23f...",
        "amount": "50000",
        "asset": "USDC",
        "network": "base"
      }
    ],
    "service_description": "AI inference via Claude Sonnet 4.6",
    "expires_at": "2026-02-24T12:00:00Z"
  }
}
```

**2. `x402/payment-submitted`** (Client to Agent)

```json
{
  "method": "x402/payment-submitted",
  "params": {
    "payment_id": "pay_123",
    "scheme": "exact",
    "signature": "0x..."
  }
}
```

**3. `x402/payment-completed`** (Agent to Client)

```json
{
  "result": {
    "payment_id": "pay_123",
    "status": "completed",
    "settlement": {
      "tx_hash": "0xabc...",
      "block_number": 12345678,
      "amount_settled": "50000"
    },
    "receipt": {
      "receipt_id": "rec_456",
      "signature": "0x...",
      "valid_until": "2026-02-25T12:00:00Z"
    }
  }
}
```

For detailed implementation of each payment scheme (exact, onchain, receipt), see `references/payment-flows.md`.

---

## The Bazaar

The Bazaar is P402's service discovery marketplace where agents publish capabilities and their prices. Other agents discover available services, compare pricing, and invoke them with automatic payment settlement.

### Discover Services

```bash
curl https://p402.io/api/v2/bazaar/discover?capability=web-search
```

**Response:**

```json
{
  "resources": [
    {
      "id": "baz_search_001",
      "name": "Web Search Agent",
      "description": "Real-time web search with summarization",
      "endpoint": "https://search-agent.example.com/api/a2a",
      "price_per_call_usd": 0.01,
      "capabilities": ["web-search", "summarization"],
      "health": "healthy",
      "avg_latency_ms": 2500
    }
  ]
}
```

### List All Services

```bash
curl https://p402.io/api/v2/bazaar/listings
```

### Call a Service

```bash
curl -X POST https://p402.io/api/v2/bazaar/call \
  -H "Content-Type: application/json" \
  -d '{
    "resource_id": "baz_search_001",
    "message": {
      "role": "user",
      "parts": [{ "type": "text", "text": "Search for latest AI news" }]
    },
    "mandate_id": "mandate_abc"
  }'
```

P402 handles the payment settlement between the caller and the service provider.

---

## TypeScript Types

Core types for A2A integration:

```typescript
// Message types
type A2ARole = 'user' | 'agent' | 'system';

interface A2APart {
  type: 'text' | 'data';
  text?: string;
  data?: any;
}

interface A2AMessage {
  role: A2ARole;
  parts: A2APart[];
}

// Task types
type A2ATaskState = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

interface A2ATask {
  id: string;
  contextId?: string;
  status: {
    state: A2ATaskState;
    message?: A2AMessage;
    timestamp: string;
  };
  artifacts?: Array<{
    id: string;
    name: string;
    parts: A2APart[];
  }>;
  metadata?: {
    cost_usd?: number;
    latency_ms?: number;
  };
}

// Mandate types
type MandateType = 'intent' | 'cart' | 'payment';

interface AP2Mandate {
  id: string;
  tenant_id: string;
  type: MandateType;
  user_did: string;
  agent_did: string;
  constraints: {
    max_amount_usd: number;
    allowed_categories?: string[];
    valid_until?: string;
  };
  signature?: string;
  public_key?: string;
  amount_spent_usd: number;
  status: 'active' | 'exhausted' | 'expired' | 'revoked';
}

// x402 Extension types
const X402_EXTENSION_URI = 'tag:x402.org,2025:x402-payment';

type X402PaymentScheme = 'exact' | 'onchain' | 'receipt';

interface X402PaymentRequired {
  payment_id: string;
  schemes: Array<{
    scheme: X402PaymentScheme;
    recipient: string;
    amount: string;
    asset: string;
    network: string;
    domain?: string;
    verifyingContract?: string;
    nonce?: string;
    valid_until?: string;
  }>;
  service_description: string;
  expires_at: string;
}

interface X402PaymentSubmitted {
  payment_id: string;
  scheme: X402PaymentScheme;
  signature?: string;  // For exact (EIP-3009)
  tx_hash?: string;    // For onchain
  receipt_id?: string; // For receipt reuse
}

interface X402PaymentCompleted {
  payment_id: string;
  settlement?: {
    tx_hash: string;
    block_number?: number;
    amount_settled: string;
    fee_usd?: number;
  };
  receipt?: {
    receipt_id: string;
    signature: string;
    valid_until?: string;
  };
  status: 'completed' | 'failed';
}

// Agent Card (discovery)
interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  iconUrl?: string;
  version?: string;
  capabilities?: Record<string, any>;
  skills?: Array<{
    id: string;
    name: string;
    description: string;
    tags?: string[];
  }>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  extensions?: Array<{
    uri: string;
    config?: any;
  }>;
  endpoints?: Record<string, any>;
}
```

---

## Complete Integration Example

An agent that discovers P402, creates a mandate, and makes a paid AI request:

```typescript
// 1. Discover P402's capabilities
const agentCard = await fetch('https://p402.io/.well-known/agent.json')
  .then(r => r.json());

const supportsPayments = agentCard.extensions?.some(
  (e: any) => e.uri === 'tag:x402.org,2025:x402-payment'
);

// 2. Create a spending mandate
const mandate = await fetch('https://p402.io/api/a2a/mandates', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mandate: {
      type: 'intent',
      user_did: 'did:key:myuser',
      agent_did: 'did:key:myagent',
      constraints: {
        max_amount_usd: 5.00,
        allowed_categories: ['ai-inference'],
        valid_until: new Date(Date.now() + 86400000).toISOString()
      }
    }
  })
}).then(r => r.json());

// 3. Send a task via A2A
const task = await fetch('https://p402.io/api/a2a', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        role: 'user',
        parts: [{ type: 'text', text: 'What are the top 3 trends in AI this week?' }]
      },
      configuration: { mode: 'balanced' }
    },
    id: 1
  })
}).then(r => r.json());

console.log('Task:', task.result.task.id);
console.log('Response:', task.result.task.status.message.parts[0].text);
console.log('Cost:', task.result.task.metadata.cost_usd);
```

---

**Build your first agent integration:** Start by discovering P402's capabilities at [p402.io/.well-known/agent.json](https://p402.io/.well-known/agent.json), then create a mandate and send your first A2A message. The [P402 Mini App](https://mini.p402.io) demonstrates the full session and payment flow in a consumer-friendly interface. Get your API key at [p402.io](https://p402.io).
