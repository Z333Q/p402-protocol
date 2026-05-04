# @p402/mpp-method

Production payment methods for [mppx](https://mpp.dev), built and operated by [P402](https://p402.io).

Settle stablecoin micropayments for AI agent traffic on [Base](https://base.org) or [Tempo](https://tempo.xyz) with a single SDK call. Choose the rail explicitly or let the router select based on facilitator health, currency availability, and cost. The same package that runs in production at p402.io.

```ts
import { Mppx } from 'mppx/nextjs';
import { baseCharge, verifyBaseCharge, decodePaymentHeader } from '@p402/mpp-method';

const mppx = Mppx.create({
  methods: [baseCharge],
  secretKey: process.env.MPP_SECRET_KEY!,
});

export const POST = mppx.charge({ amount: '0.001', recipient: TREASURY })(
  async (req) => {
    const { payload, challengeId } = decodePaymentHeader(req.headers.get('authorization') ?? '');
    await verifyBaseCharge({
      request:    { recipient: TREASURY, amount: '0.001' },
      credential: { payload },
      challengeId: challengeId ?? '',
      onSettle:   executeBaseSettle,
    });
    return Response.json({ ok: true });
  }
);
```

Sub-cent settlement overhead per million tokens of AI inference. Verified offline in under 200 ms. Settled on-chain in one block.

*Last updated: May 2026 (v0.1)*

---

## Why this exists

mppx ships one built-in method: `tempo`. It does not include a Base method, multi-rail routing, or spending policy enforcement.

| Capability | mppx core | `@p402/mpp-method` |
|---|---|---|
| Tempo (TIP-20 stablecoins, chain 4217) | yes | use mppx `tempo()` directly |
| Base mainnet + Sepolia (USDC, EURC) | no | yes |
| Multi-rail with auto-selection | no | yes |
| Spending policy enforcement | no | yes (via P402 Billing Guard) |
| Per-charge analytics with custom tags | no | yes |
| Pre-funded session budgets | no | yes |
| x402 backwards compatibility | no | yes (through May 2027) |
| Format-strict input validation before all BigInt/crypto calls | no | yes |

If you only need Tempo and no policy logic, mppx alone is enough. If you need Base, multi-rail, analytics, or policies, this is the production path.

---

## Install

```bash
npm install @p402/mpp-method mppx viem
```

Peer requirements: Node.js 20+, `mppx` >= 0.6.14, `viem` >= 2.48.0.

---

## Quickstart

### Single rail: Base only

When only `baseCharge` is registered, the `mppx.charge()` shorthand is available (one method, one `intent: 'charge'`).

```ts
// app/api/charge/route.ts
import { Mppx } from 'mppx/nextjs';
import {
  baseCharge,
  verifyBaseCharge,
  decodePaymentHeader,
} from '@p402/mpp-method';
import type { BaseChargeCredential } from '@p402/mpp-method';

const TREASURY = process.env.TREASURY_ADDRESS as `0x${string}`;

const mppx = Mppx.create({
  methods: [baseCharge],
  secretKey: process.env.MPP_SECRET_KEY!,
});

export const POST = mppx.charge({ amount: '0.001', recipient: TREASURY })(
  async (req) => {
    // mppx has already validated the credential schema.
    // verifyBaseCharge checks the EIP-712 signature, expiry, and amount,
    // then dispatches on-chain settlement via onSettle.
    const { payload, challengeId } = decodePaymentHeader(req.headers.get('authorization') ?? '');

    await verifyBaseCharge({
      request:    { recipient: TREASURY, amount: '0.001' },
      credential: { payload: payload as BaseChargeCredential },
      challengeId: challengeId ?? '',
      onSettle:   executeBaseSettle,    // your on-chain executor (see The onSettle callback section)
    });

    return Response.json({ ok: true });
  }
);
```

### Single rail: Tempo only

For Tempo-only deployments, use the upstream `tempo()` method from mppx directly. This package does not re-export it.

```ts
import { Mppx, tempo } from 'mppx/nextjs';
import { privateKeyToAccount } from 'viem/accounts';

const account = privateKeyToAccount(process.env.FACILITATOR_TEMPO_KEY as `0x${string}`);

const mppx = Mppx.create({
  methods: tempo({ currency: USDC_E_ADDRESS, recipient: TREASURY, account, store }),
  secretKey: process.env.MPP_SECRET_KEY!,
});

export const POST = mppx.charge({ amount: '0.001' })(
  async (req) => Response.json({ ok: true })
);
```

See the [mppx documentation](https://mpp.dev) for the full Tempo reference.

### Multi-rail: p402 + Base

When both methods are registered, two methods share `intent: 'charge'` so the `.charge()` shorthand is unavailable. Use `mppx.compose()` instead: it presents both challenges on 402 and validates whichever credential the client submits.

```ts
// app/api/charge/route.ts
import { Mppx } from 'mppx/nextjs';
import {
  p402Charge, baseCharge,
  verifyP402Charge, verifyBaseCharge,
  decodePaymentHeader,
} from '@p402/mpp-method';
import type {
  P402ChargeCredential, BaseChargeCredential,
  ComposeResult,
} from '@p402/mpp-method';

const TREASURY = process.env.TREASURY_ADDRESS as `0x${string}`;

const mppx = Mppx.create({
  methods: [p402Charge, baseCharge],
  secretKey: process.env.MPP_SECRET_KEY!,
});

export async function POST(req: Request) {
  // mppx infers the instance type from the first method's intent chain.
  // When two methods share intent: 'charge', cast to ComposeResult.
  const result = await (mppx as any).compose(
    ['p402/charge', { amount: '0.001', recipient: TREASURY }],
    ['base/charge',  { amount: '0.001', recipient: TREASURY }],
  )(req) as ComposeResult;

  // status 402: client needs to pay; return the challenge directly
  if (result.status === 402) return result.challenge;

  // Dispatch to the correct verifier based on which method the client used
  const { method, payload, challengeId } = decodePaymentHeader(req.headers.get('authorization') ?? '');

  if (!method) return new Response('Missing payment credential', { status: 400 });

  if (method === 'base') {
    await verifyBaseCharge({
      request:    { recipient: TREASURY, amount: '0.001' },
      credential: { payload: payload as BaseChargeCredential },
      challengeId: challengeId ?? '',
      onSettle:   executeBaseSettle,
    });
  } else {
    await verifyP402Charge({
      request:    { recipient: TREASURY, amount: '0.001' },
      credential: { payload: payload as P402ChargeCredential },
      challengeId: challengeId ?? '',
    });
  }

  const response = await businessLogic(req);
  return result.withReceipt(response);    // adds Payment-Receipt header; streaming bodies are unchanged
}
```

---

## How a payment flows

```
Client                          Server                          Chain
  |                                |                              |
  |-- POST /api/charge ----------->|                              |
  |                         mppx: no credential                  |
  |<-- 402 WWW-Authenticate -------|                              |
  |                                |                              |
  |  (client signs EIP-3009 auth)  |                              |
  |                                |                              |
  |-- POST /api/charge (Payment) ->|                              |
  |                         mppx: validate schema                 |
  |                         verifyBaseCharge: sig + expiry + amt  |
  |                         onSettle: transferWithAuthorization ->|
  |                                |<-- txHash -------------------|
  |<-- 200 + Payment-Receipt ------|                              |
```

`result.withReceipt(response)` wraps your response with the `Payment-Receipt` header. For streaming responses, the `ReadableStream` body is passed through unchanged.

---

## Methods

### `p402Charge`

Multi-rail method using a P402 session credential. The credential is an opaque P402 session token plus an ECDSA signature. The server resolves the settlement rail at verification time.

```ts
import { p402Charge, verifyP402Charge } from '@p402/mpp-method';
```

`p402Charge` is a static `Method` object. Register it as-is; no factory arguments.

**`verifyP402Charge(params)`**

| Param | Type | Description |
|---|---|---|
| `params.request` | `P402ChargeRequest` | `recipient` (required), `amount`/`amountRaw`, `currency`, `decimals`, `preferredRail`, `policyId`, `p402SessionId`, `analyticsTag` |
| `params.credential` | `{ payload: P402ChargeCredential }` | Decoded from the `Authorization: Payment` header via `decodePaymentHeader` |
| `params.challengeId` | `string` | Challenge ID from the mppx flow |
| `params.onSettle` | `P402ChargeSettleCallback?` | Executes settlement; receives `P402ChargeSettleData`, returns a tx hash or reference string |

When `onSettle` is omitted, `verifyP402Charge` returns a receipt using `sessionToken` as the reference. Useful for staging or dry-run verification.

**`P402ChargeSettleData`** passed to your `onSettle`:

```ts
type P402ChargeSettleData = {
  rail:      'tempo' | 'base' | 'auto';  // resolved from request.preferredRail
  amount:    bigint;                      // raw atomic units from resolveAmount()
  recipient: string;
  currency:  string;                      // default: 'USDC'
};
```

---

### `baseCharge`

EIP-3009 method for Base mainnet (chain 8453) and Sepolia (chain 84532). The credential is a raw `TransferWithAuthorization` struct plus its EIP-712 signature.

```ts
import { baseCharge, verifyBaseCharge } from '@p402/mpp-method';
```

`baseCharge` is a static `Method` object.

**`verifyBaseCharge(params)`**

| Param | Type | Description |
|---|---|---|
| `params.request` | `BaseChargeRequest` | `recipient` (required), `amount`/`amountRaw`, `currency` (`'USDC' \| 'EURC'`), `network` (`'base' \| 'base-sepolia'`) |
| `params.credential` | `{ payload: BaseChargeCredential }` | Full `TransferWithAuthorization` struct + EIP-712 signature |
| `params.challengeId` | `string` | Challenge ID |
| `params.onSettle` | `BaseChargeSettleCallback?` | Receives `BaseChargeSettleData`; returns tx hash |

Offline checks before calling `onSettle`:
- EIP-712 signature verification via `viem.verifyTypedData` against the canonical USDC/EURC domain
- `validBefore` is in the future; `validAfter` has passed
- `authorization.value` >= resolved request amount
- `authorization.to` matches `request.recipient` (case-insensitive)
- All addresses, uint256 strings, nonces, and signatures pass format guards before any BigInt or crypto call

**`BaseChargeSettleData`** passed to your `onSettle`:

```ts
type BaseChargeSettleData = {
  authorization: BaseChargeAuthorization;  // the signed struct
  signature:     string;                   // 0x-prefixed 65-byte hex
  currency:      'USDC' | 'EURC';
  network:       'base' | 'base-sepolia';
  requiredRaw:   bigint;                   // resolved minimum from request
};
```

---

## The `onSettle` callback

Both verifiers accept an `onSettle` function. This keeps the package free of any dependency on your wallet key management, RPC configuration, or Redis setup.

A production Base settler with two-layer replay protection:

```ts
import { BASE_TOKEN_CONFIG } from '@p402/mpp-method';
import type { BaseChargeSettleData } from '@p402/mpp-method';
import type { Hex } from 'viem';
import redis from './redis';
import { getFacilitatorWallet } from './wallet';

const NONCE_TTL_S = 86_400; // 24 hours, covers the EIP-3009 validBefore window

export async function executeBaseSettle(data: BaseChargeSettleData): Promise<string> {
  const { authorization, signature, currency, network } = data;

  // Layer 1: Redis SET NX prevents concurrent duplicate submissions.
  // Fail-open on Redis errors: layer 2 (on-chain authorizationState) catches replays.
  const key = `nonce:${authorization.nonce}`;
  const locked = await redis.set(key, '1', 'EX', NONCE_TTL_S, 'NX').catch(() => 'ok');
  if (locked === null) throw new Error('nonce already used');

  const tokenAddress = BASE_TOKEN_CONFIG[currency][network === 'base' ? 'mainnet' : 'sepolia'];

  // Unpack r, s, v from the packed 65-byte signature (0x + r[32B] + s[32B] + v[1B])
  const r = signature.slice(0, 66) as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = parseInt(signature.slice(130, 132), 16);

  // Layer 2: simulateContract inside executeSettlement catches on-chain used nonces.
  const wallet = await getFacilitatorWallet();
  return wallet.executeSettlement(tokenAddress, {
    from:        authorization.from as Hex,
    to:          authorization.to as Hex,
    value:       BigInt(authorization.value),
    validAfter:  Number(authorization.validAfter),
    validBefore: Number(authorization.validBefore),
    nonce:       authorization.nonce as Hex,
    v, r, s,
  }, crypto.randomUUID());    // Node.js 20+ globalThis.crypto
}
```

---

## `decodePaymentHeader`

Decodes an `Authorization: Payment <base64url JSON>` header into its parts. Returns safe null/empty defaults on parse failure; never throws.

```ts
import { decodePaymentHeader } from '@p402/mpp-method';
import type { DecodedPayment } from '@p402/mpp-method';

const { method, payload, challengeId }: DecodedPayment =
  decodePaymentHeader(req.headers.get('authorization') ?? '');

// method is null when the header is missing or malformed.
// Always check before dispatching to a verifier.
if (!method) return new Response('Missing payment credential', { status: 400 });
```

`method` is `string | null`, not `string`. The null case must be handled before calling `verifyBaseCharge` or `verifyP402Charge`.

---

## Amount helpers

```ts
import { resolveAmount, formatAmount } from '@p402/mpp-method';

resolveAmount({ amount: '0.001' })              // 1000n   (6 decimals, default)
resolveAmount({ amountRaw: '1000' })            // 1000n
resolveAmount({ amount: '1', decimals: 18 })    // 1_000_000_000_000_000_000n
resolveAmount({ amount: '0.001', amountRaw: '500' })  // 500n  (amountRaw wins)

// Format validation: safe to call on untrusted input
resolveAmount({ amount: '-1' })                 // throws: negative value
resolveAmount({ amount: '1e3' })                // throws: scientific notation
resolveAmount({ amountRaw: '0xff' })            // throws: hex string
resolveAmount({})                               // throws: neither field present

formatAmount(1000n)                             // '0.001'  (6 decimals)
formatAmount(1000n, 18)                         // '0.000000000000001'
formatAmount(0n)                                // '0'
```

No raw `BigInt(userInput)` calls anywhere in this package.

---

## Constants and types

```ts
import {
  BASE_CHAIN_ID,          // 8453
  BASE_SEPOLIA_CHAIN_ID,  // 84532
  BASE_TOKEN_CONFIG,      // contract addresses + EIP-712 metadata for USDC and EURC
} from '@p402/mpp-method';

import type {
  // Compose
  ComposeResult,
  DecodedPayment,

  // p402Charge
  P402ChargeRequest,
  P402ChargeCredential,
  P402ChargeSettleData,
  P402ChargeSettleCallback,

  // baseCharge
  BaseChargeRequest,
  BaseChargeCredential,
  BaseChargeAuthorization,
  BaseChargeSettleData,
  BaseChargeSettleCallback,
  BaseCurrency,      // 'USDC' | 'EURC'
  BaseNetwork,       // 'base' | 'base-sepolia'

  // amount helpers
  AmountInput,
} from '@p402/mpp-method';
```

**`BASE_TOKEN_CONFIG` shape:**

```ts
{
  USDC: {
    mainnet:       '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    sepolia:       '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    decimals:      6,
    eip712Name:    'USD Coin',
    eip712Version: '2',
  },
  EURC: {
    mainnet:       '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42',
    sepolia:       '0x08210F9170F89Ab7658F0B5E3fF39b0E03C2230b',
    decimals:      6,
    eip712Name:    'Euro Coin',
    eip712Version: '2',
  },
}
```

---

## Supported tokens

### Base

| Symbol | Mainnet | Sepolia | Decimals |
|---|---|---|---|
| USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | 6 |
| EURC | `0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42` | `0x08210F9170F89Ab7658F0B5E3fF39b0E03C2230b` | 6 |

### Tempo (via upstream mppx `tempo()`)

The `p402Charge` method routes to Tempo when `preferredRail: 'tempo'` or auto-selection chooses it. For Tempo-only deployments, use the mppx-native `tempo()` method directly. This package does not re-export it.

Ten TIP-20 stablecoins are supported on Tempo; three verified end-to-end by P402:

| Symbol | Status | Issuer |
|---|---|---|
| USDC.e | Verified | Stargate |
| USDT0 | Verified | Tether OFT |
| cUSD | Verified | Coinbase OFT |
| EURC.e, frxUSD, stcUSD, GUSD, rUSD, wsrUSD, pathUSD | Declared | Various |

All Tempo TIP-20 tokens use 6 decimals. Tempo precompile contracts return `0xef` from `eth_getCode`. This is the EIP-7702 delegation designator Tempo uses for system contracts; it is not a missing contract.

Full address list: [tokenlist.tempo.xyz/list/4217](https://tokenlist.tempo.xyz/list/4217).

---

## Security model

### What this package verifies

| Check | Performed in | Detail |
|---|---|---|
| EIP-712 signature | `verifyBaseCharge` | `viem.verifyTypedData` against the canonical domain (chain ID, contract address, name, version) per token |
| Authorization expiry | `verifyBaseCharge` | `validBefore` > `Date.now() / 1000`; `validAfter` <= now |
| Amount sufficiency | `verifyBaseCharge` | `authorization.value` >= `resolveAmount(request)` |
| Recipient match | `verifyBaseCharge` | `authorization.to` === `request.recipient` (case-insensitive) |
| Format validation | Both verifiers | Addresses, uint256 strings, 32-byte nonces, 65-byte signatures validated by regex before any BigInt or crypto call |

### Replay protection

The package does not include Redis or RPC. Replay protection is the caller's responsibility via the `onSettle` callback. The reference implementation uses two layers:

1. **Redis `SET key 1 EX <ttl> NX`:** Pre-execution lock keyed on `authorization.nonce`. Prevents concurrent duplicate submissions. TTL should cover the `validBefore` window (typically 24 hours).
2. **`simulateContract` before `writeContract`:** The ERC-20 contract's `authorizationState(from, nonce)` reverts on used nonces. Catches replays that bypass the Redis lock.

Both layers must pass. Neither alone is sufficient.

### Caller responsibilities

- **Hot wallet custody:** The account submitting `transferWithAuthorization` must be funded (ETH for gas on Base, stablecoin for gas on Tempo) and the private key protected as a secret. Rotate quarterly.
- **HTTPS:** Credentials travel as base64-encoded JSON in the `Authorization` header.
- **Redis durability:** The mppx `Store` for challenge state must be backed by persistent Redis in production. The in-memory fallback is not multi-instance safe.
- **`MPP_SECRET_KEY` rotation:** This is the HMAC key for challenge signing. Rotate quarterly.

### Out of scope

- Smart contract exploits in USDC or EURC. These tokens have upgrade keys.
- Client wallet compromise.
- Transaction censorship at the sequencer layer (Base and Tempo are sequencer-operated chains).

### Audit history

- **Internal security review (May 2026):** Six high/medium findings resolved before v0.1 release. All format validation gaps patched. Regex guards added before every BigInt and crypto call.
- **External audit:** Planned for v0.3. No provider engaged yet.

---

## Production deployment

The reference deployment at p402.io uses:

- **Hosting:** Vercel serverless (Next.js App Router, `output: 'standalone'`)
- **mppx Store:** Upstash Redis, key prefix `mppx:v1:`, 900-second TTL
- **Nonce lock:** Upstash Redis, key prefix `nonce:`, 86 400-second TTL
- **Facilitator wallets:** Separate hot wallets per rail, funded weekly from cold storage

### Required environment variables

| Variable | Required | Description |
|---|---|---|
| `MPP_SECRET_KEY` | Yes | HMAC secret for challenge signing. Minimum 32 bytes. Generate with `openssl rand -base64 32`. |
| `P402_FACILITATOR_BASE_KEY` | Yes (Base) | Hot wallet private key. Submits `transferWithAuthorization` on Base. Needs ETH for gas. |
| `P402_FACILITATOR_TEMPO_KEY` | Yes (Tempo via p402Charge) | Separate hot wallet for Tempo settlements. Needs stablecoin for gas via FeeAMM. |
| `P402_TREASURY_ADDRESS` | Yes | Default payment recipient address. |
| `REDIS_URL` | Production | mppx Store backend. Falls back to in-memory if absent (not multi-instance safe). |
| `BASE_RPC_URL` | Optional | Override default Base mainnet RPC. |
| `TEMPO_RPC_URL` | Optional | Override default Tempo RPC. Default: `https://rpc.tempo.xyz`. |
| `NEXT_PUBLIC_CHAIN_ENV` | Optional | Set to `testnet` to route Base settlements to Sepolia. |

### Operational expectations

- **Facilitator wallet balance:** Keep at least 30 days of expected gas spend on each rail.
- **Redis p99:** Less than 10 ms round-trip from your serving region. Cross-region Redis pushes verify p99 above 200 ms.
- **Settlement confirmation:** 1 block on Base (approximately 2 seconds). 1 block on Tempo (approximately 1 second). Increase if your threat model requires stronger finality.

---

## x402 backwards compatibility

This package coexists with the [x402 protocol](https://x402.org). Endpoints accepting `Authorization: Payment` (mppx) also accept `X-PAYMENT` (x402) headers. 402 challenges include both `WWW-Authenticate: Payment` and `X-PAYMENT-REQUIRED`.

P402 guarantees x402 backwards compatibility through **May 2027**. After that date, x402 clients must migrate to MPP. The migration: install mppx, replace `X-PAYMENT` with `Authorization: Payment`, no further changes required.

x402 schemes accepted today: `exact` (EIP-3009 gasless), `onchain` (direct tx verification), `receipt` (reuse of a prior settled payment).

---

## Roadmap

| Version | Adds | Status |
|---|---|---|
| **v0.1** | `baseCharge` (EIP-3009, Base + Sepolia, USDC/EURC), `p402Charge` (multi-rail session credential), `decodePaymentHeader`, `resolveAmount`/`formatAmount`, `ComposeResult` type, format-strict input validation, `onSettle` callback API, Phase 3.3 analytics hooks | Current |
| v0.2 | Permit2 batch authorizations on Base. Session intent for off-chain voucher streaming (sub-microcent per-token metering for cheapest LLM models). | Q3 2026 |
| v0.3 | External security audit. | Q4 2026 |

Per-token metering (amounts below the chain's smallest representable unit) requires the MPP session intent, which ships in v0.2. Until then, settlement granularity is per-charge, the right primitive for per-request and per-session pricing.

---

## License

MIT.

Published by **Nature of Commerce LLC** (Alberta, Canada) on behalf of the P402 Protocol. Source at [github.com/Z333Q/p402-protocol](https://github.com/Z333Q/p402-protocol). Issues and security disclosures go through that repository.

Commercial support, enterprise treasury setup, or partnership inquiries: [hello@p402.io](mailto:hello@p402.io).
