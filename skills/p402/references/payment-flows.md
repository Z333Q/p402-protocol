# P402 Payment Flows

Implementation guide for x402 protocol payment settlement through P402. Covers the 3-step payment lifecycle, all three payment schemes, USDC contract addresses, session funding, and integration with the Billing Guard.

## Table of Contents
1. [The x402 Protocol](#the-x402-protocol)
2. [Payment Schemes](#payment-schemes)
3. [Session-Based Payments](#session-based-payments)
4. [The X-402-Payment Header](#the-x-402-payment-header)
5. [USDC Contract Addresses](#usdc-contract-addresses)
6. [Settlement Verification](#settlement-verification)
7. [Integration Examples](#integration-examples)

---

## The x402 Protocol

x402 is an HTTP-native payment protocol co-founded by Coinbase and Cloudflare. It repurposes the HTTP 402 "Payment Required" status code for machine-to-machine payments. P402 acts as a **facilitator** in the x402 ecosystem, verifying payments and releasing AI services.

The core flow has three steps:

### Step 1: Payment Required (402 Response)

When a service requires payment, it responds with HTTP 402 and payment details:

```http
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "payment_id": "pay_abc123",
  "schemes": [
    {
      "scheme": "exact",
      "recipient": "0xb23f146251e3816a011e800bcbae704baa5619ec",
      "amount": "50000",
      "asset": "USDC",
      "network": "base",
      "domain": "p402.io",
      "verifyingContract": "0x..."
    },
    {
      "scheme": "onchain",
      "recipient": "0xb23f146251e3816a011e800bcbae704baa5619ec",
      "amount": "50000",
      "asset": "USDC",
      "network": "base"
    }
  ],
  "service_description": "AI inference: claude-sonnet-4-6, ~500 tokens",
  "expires_at": "2026-02-24T12:00:00Z"
}
```

The `amount` is in the token's smallest unit (USDC has 6 decimals, so 50000 = $0.05).

### Step 2: Payment Submitted

The client submits payment proof. For the A2A protocol, this is a JSON-RPC call:

```json
{
  "jsonrpc": "2.0",
  "method": "x402/payment-submitted",
  "params": {
    "payment_id": "pay_abc123",
    "scheme": "onchain",
    "tx_hash": "0xabc..."
  },
  "id": 1
}
```

For direct HTTP, the client includes the `X-402-Payment` header on a retry of the original request.

### Step 3: Payment Completed

P402 verifies the payment on-chain and releases the resource:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "payment_id": "pay_abc123",
    "status": "completed",
    "settlement": {
      "tx_hash": "0xabc...",
      "block_number": 12345678,
      "amount_settled": "50000",
      "fee_usd": 0.001
    },
    "receipt": {
      "receipt_id": "rec_xyz",
      "signature": "0x...",
      "valid_until": "2026-02-25T12:00:00Z"
    }
  },
  "id": 1
}
```

The receipt can be reused for subsequent requests within its validity window.

---

## Payment Schemes

### `exact` (EIP-3009 Gasless)

The primary x402 scheme and the one Coinbase's hosted facilitator uses. The client signs a `transferWithAuthorization` message (EIP-3009) without broadcasting a transaction. The facilitator (P402) submits the transaction on behalf of the client, making it gasless for the payer.

```typescript
// Client-side: sign the EIP-3009 authorization
const domain = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,               // Base mainnet
  verifyingContract: USDC_ADDRESS
};

const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' }
  ]
};

const signature = await wallet.signTypedData(domain, types, {
  from: walletAddress,
  to: P402_TREASURY,
  value: parseUnits('0.05', 6),   // $0.05 USDC
  validAfter: 0,
  validBefore: Math.floor(Date.now() / 1000) + 3600,
  nonce: randomBytes(32)
});

// Submit to P402
await fetch('https://p402.io/api/a2a', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'x402/payment-submitted',
    params: {
      payment_id: 'pay_abc123',
      scheme: 'exact',
      signature: signature
    },
    id: 1
  })
});
```

### `onchain` (Direct Transaction)

The client broadcasts a USDC transfer to the P402 treasury address, then submits the transaction hash for verification.

```typescript
// Client-side: send USDC on Base
const tx = await usdcContract.transfer(
  P402_TREASURY,
  parseUnits('0.05', 6)
);
await tx.wait();

// Submit tx hash for verification
const header = `x402-v1;network=8453;token=${USDC_ADDRESS};tx=${tx.hash}`;

// Option A: via X-402-Payment header
const response = await fetch('https://p402.io/api/v2/chat/completions', {
  headers: {
    'X-402-Payment': header,
    'Authorization': `Bearer ${P402_KEY}`
  },
  body: JSON.stringify({ messages, p402: { mode: 'cost' } })
});

// Option B: via A2A JSON-RPC
await fetch('https://p402.io/api/a2a', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'x402/payment-submitted',
    params: { payment_id: 'pay_abc', scheme: 'onchain', tx_hash: tx.hash },
    id: 1
  })
});
```

P402 verifies the transaction by:
1. Fetching the transaction receipt from Base RPC
2. Confirming receipt status is `success`
3. Finding a USDC Transfer event log to the expected treasury address
4. Checking the transfer amount meets the minimum
5. Extracting the sender address from the event log

### `receipt` (Reuse Prior Payments)

After a successful payment, the `payment-completed` response includes a receipt with a `receipt_id` and `signature`. This receipt can be reused for subsequent requests within its validity window, avoiding repeated on-chain transactions for high-frequency micropayments.

```typescript
// After initial payment, save the receipt
const receipt = paymentResponse.result.receipt;

// Reuse for next request
await fetch('https://p402.io/api/a2a', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'x402/payment-submitted',
    params: {
      payment_id: 'pay_new_456',
      scheme: 'receipt',
      receipt_id: receipt.receipt_id
    },
    id: 2
  })
});
```

This amortizes gas costs across many requests, which is essential for true micropayment economics.

---

## Session-Based Payments

For most developers, session-based payments are simpler than the raw x402 flow. The pattern:

1. **Fund a session** with USDC (one transaction)
2. **Use the session** for many API calls (P402 deducts from the session balance per request)
3. **Session exhausts** when budget runs out

```typescript
// 1. Create session
const session = await createSession({ budget_usd: 10.00 });

// 2. Fund via Base Pay or direct USDC transfer
await fundSession({
  session_id: session.id,
  amount: '10.00',
  tx_hash: '0xabc...',
  source: 'direct',
  network: 'base'
});

// 3. Use session for requests (budget tracked automatically)
const response = await fetch('https://p402.io/api/v2/chat/completions', {
  headers: { 'Authorization': `Bearer ${P402_KEY}` },
  body: JSON.stringify({
    messages: [{ role: 'user', content: 'Hello' }],
    p402: { session_id: session.id, mode: 'cost' }
  })
});

// 4. Check remaining budget
const status = await fetch(`https://p402.io/api/v2/sessions/${session.id}`);
// status.budget.remaining_usd shows what's left
```

Session funding accepts:
- **`base_pay`**: USDC via Coinbase Base Pay (used in the P402 mini app)
- **`direct`**: Direct USDC transfer to P402 treasury, with tx_hash for verification
- **`test`**: Test credits for development (no real funds required)

---

## The X-402-Payment Header

The canonical header format for inline payment submission:

```
X-402-Payment: x402-v1;network=8453;token=0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;tx=0xabc...
```

Fields are semicolon-delimited key=value pairs:

| Field | Required | Description |
|-------|----------|-------------|
| `x402-v1` | Yes | Protocol version (always first) |
| `network` | Yes | Chain ID (8453 for Base mainnet, 84532 for Sepolia) |
| `token` | Yes | Token contract address (USDC) |
| `tx` | Conditional | Transaction hash (for `onchain` scheme) |
| `sig` | Conditional | EIP-3009 signature (for `exact` scheme) |
| `receipt` | Conditional | Receipt ID (for `receipt` scheme) |
| `amount` | Optional | Payment amount in token units |

---

## USDC Contract Addresses

| Network | Chain ID | USDC Address |
|---------|----------|-------------|
| Base Mainnet | 8453 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | 84532 | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |

P402 Treasury Address: `0xb23f146251e3816a011e800bcbae704baa5619ec`

---

## Settlement Verification

P402 handles all on-chain verification server-side. When you submit a payment (transaction hash, EIP-3009 signature, or receipt ID), P402 verifies it automatically before releasing the resource. The verification process checks:

1. Transaction receipt confirms success
2. USDC Transfer event to the correct treasury address
3. Transfer amount meets the minimum requirement
4. Sender address is extracted and recorded

Developers using the session-based flow do not need to implement any verification logic. P402 handles it automatically when funding a session with a transaction hash.

For the raw x402 flow, P402 verifies payment proof server-side and returns the result in the `payment-completed` response. See the [P402 dashboard](https://p402.io/dashboard) for settlement logs and transaction history.

---

## Integration Examples

### Minimal: Session-Based (Recommended for Most Developers)

```typescript
// setup.ts
const P402_BASE = 'https://p402.io';
const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.P402_API_KEY}`
};

// Create and fund a session once
async function setupAgent(budgetUsd: number) {
  const session = await fetch(`${P402_BASE}/api/v2/sessions`, {
    method: 'POST', headers,
    body: JSON.stringify({ budget_usd: budgetUsd, agent_identifier: 'my-agent' })
  }).then(r => r.json());

  return session.id;
}

// Use for every AI call
async function chat(sessionId: string, messages: any[], mode = 'balanced') {
  const response = await fetch(`${P402_BASE}/api/v2/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({
      messages,
      p402: { session_id: sessionId, mode, cache: true }
    })
  }).then(r => r.json());

  return {
    content: response.choices[0].message.content,
    cost: response.p402_metadata.cost_usd,
    provider: response.p402_metadata.provider
  };
}
```

### Advanced: x402 Pay-Per-Request

```typescript
// For agents that pay per request via x402 headers
async function payAndChat(messages: any[], walletClient: any) {
  // First request gets 402
  const initial = await fetch(`${P402_BASE}/api/v2/chat/completions`, {
    method: 'POST', headers,
    body: JSON.stringify({ messages, p402: { mode: 'cost' } })
  });

  if (initial.status === 402) {
    const invoice = await initial.json();
    const scheme = invoice.schemes[0]; // Pick preferred scheme

    // Pay on-chain
    const tx = await walletClient.sendTransaction({
      to: scheme.recipient,
      data: encodeUsdcTransfer(scheme.recipient, scheme.amount)
    });
    await tx.wait();

    // Retry with payment proof
    const paymentHeader = `x402-v1;network=${scheme.network};token=${USDC_ADDRESS};tx=${tx.hash}`;
    const paid = await fetch(`${P402_BASE}/api/v2/chat/completions`, {
      method: 'POST',
      headers: { ...headers, 'X-402-Payment': paymentHeader },
      body: JSON.stringify({ messages, p402: { mode: 'cost' } })
    });

    return paid.json();
  }

  return initial.json();
}
```

---

**Start with sessions:** For most developers, session-based payments are the fastest path to production. Create a session, fund it with USDC, and start making API calls. Try it instantly via the [P402 Mini App](https://mini.p402.io) -- connect a Base Account, fund via Base Pay, and chat with real-time cost tracking. For the full x402 payment flow, get your API key at [p402.io](https://p402.io).
