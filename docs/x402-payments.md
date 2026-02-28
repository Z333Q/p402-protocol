# x402 Payments

x402 is a machine-native payment protocol built on HTTP 402 ("Payment Required"). AI agents pay for resources using gasless EIP-3009 USDC transfers on Base L2.

## Overview

```
Client → signs EIP-3009 authorization (no gas, no wallet popup for the user)
       → POST /api/v1/facilitator/verify   (P402 checks amount, sig, nonce)
       → POST /api/v1/facilitator/settle   (P402 executes on-chain transfer)
Facilitator → calls transferWithAuthorization on USDC contract
            → pays gas (user pays $0 gas)
            → returns { success, transaction, receipt }
```

## Network and Addresses

| | Value |
|---|---|
| Network | Base Mainnet |
| Chain ID | 8453 |
| CAIP-2 | `eip155:8453` |
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| P402 Treasury | `0xFa772434DCe6ED78831EbC9eeAcbDF42E2A031a6` |

## Payment Schemes

| Scheme | Description | Gas Payer |
|---|---|---|
| `exact` | Gasless EIP-3009 authorization — P402 executes | P402 Facilitator |
| `onchain` | Client submits tx; P402 verifies | Client |
| `receipt` | Reuse a prior payment receipt | — |

## EIP-712 Domain (for USDC)

```typescript
const domain = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
};

const types = {
  TransferWithAuthorization: [
    { name: 'from',        type: 'address' },
    { name: 'to',          type: 'address' },
    { name: 'value',       type: 'uint256' },
    { name: 'validAfter',  type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce',       type: 'bytes32' }
  ]
};
```

## Wire Format

```typescript
// POST /api/v1/facilitator/verify
// POST /api/v1/facilitator/settle
{
  paymentPayload: {
    x402Version: 2,
    scheme: "exact",
    network: "eip155:8453",
    payload: {
      signature: "0x...",        // EIP-712 signature (65 bytes)
      authorization: {
        from: "0x...",           // Payer address
        to: "0x...",             // Treasury (payee)
        value: "1000000",        // Amount in atomic units (USDC = 6 decimals, so 1 USDC = 1000000)
        validAfter: "1700000000",
        validBefore: "1700003600",
        nonce: "0x..."           // bytes32 — used once, replay-protected
      }
    }
  },
  paymentRequirements: {
    scheme: "exact",
    network: "eip155:8453",
    maxAmountRequired: "1000000",
    resource: "https://p402.io/api/v2/chat/completions",
    description: "AI completion payment",
    payTo: "0xFa772434DCe6ED78831EbC9eeAcbDF42E2A031a6",
    asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }
}
```

## Verify Endpoint

```
POST /api/v1/facilitator/verify
```

Checks:
- Signature validity
- Amount matches `maxAmountRequired`
- `validBefore` is in the future
- Nonce has not been used (replay protection)
- Gas price is below configured limit

Response:
```json
{ "isValid": true, "invalidReason": null }
```

## Settle Endpoint

```
POST /api/v1/facilitator/settle
```

Executes the on-chain `transferWithAuthorization` call, pays gas, and returns:

```json
{
  "success": true,
  "payer": "0x...",
  "transaction": "0x...",
  "network": "eip155:8453",
  "receipt": {
    "txHash": "0x...",
    "verifiedAmount": "1000000",
    "asset": "USDC",
    "timestamp": "2025-01-01T00:00:00Z"
  }
}
```

## Security Rules

| Rule | Detail |
|---|---|
| Gas limit | Rejects settlements if Base gas > 50 gwei (configurable) |
| Expiry | `validBefore` must be in the future |
| Minimum | $0.01 USDC |
| Replay protection | Each `nonce` is stored after use; reuse returns `REPLAY_DETECTED` |
| Amount match | `value` must match `maxAmountRequired` exactly |

## Facilitator Capabilities

```
GET /api/v1/facilitator/supported
```

```json
{
  "kinds": [
    { "x402Version": 2, "scheme": "exact", "network": "eip155:8453" }
  ],
  "networks": ["eip155:8453"],
  "assets": ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"]
}
```

## Signing with Viem/Wagmi

```typescript
import { useSignTypedData } from 'wagmi';

const { signTypedData } = useSignTypedData();

const nonce = crypto.getRandomValues(new Uint8Array(32));
const nonceHex = '0x' + Array.from(nonce).map(b => b.toString(16).padStart(2, '0')).join('');

signTypedData({
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  types: {
    TransferWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'TransferWithAuthorization',
  message: {
    from: userAddress,
    to: '0xFa772434DCe6ED78831EbC9eeAcbDF42E2A031a6',
    value: BigInt(1_000_000), // 1 USDC
    validAfter: BigInt(Math.floor(Date.now() / 1000) - 60),
    validBefore: BigInt(Math.floor(Date.now() / 1000) + 3600),
    nonce: nonceHex,
  },
});
```
