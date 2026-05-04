/**
 * @p402/mpp-method — `base` method
 *
 * EIP-3009 USDC/EURC payment on Base mainnet (chain 8453) and Base Sepolia (chain 84532).
 *
 * ## Credential scheme
 * The client signs an EIP-712 TransferWithAuthorization over (from, to, value, validAfter,
 * validBefore, nonce) and submits the raw signature. The server verifies offline (no RPC
 * required) then executes on-chain via the P402 facilitator hot wallet.
 *
 * ## v0.1 scope
 * - EIP-3009 TransferWithAuthorization only (gasless for client)
 * - USDC and EURC on Base mainnet + Sepolia
 * - Offline signature verification (viem verifyTypedData)
 * - On-chain execution wired in Phase 3.2
 *
 * ## v0.2 scope (Phase 4)
 * - Permit2 batch authorizations
 */

import { Method, Receipt, z } from 'mppx';
import { verifyTypedData, type Address, type Hex } from 'viem';
import { resolveAmount } from '../amount.js';

// ---------------------------------------------------------------------------
// Chain config (inline — avoids viem/chains import weight in the package)
// ---------------------------------------------------------------------------

export const BASE_CHAIN_ID = 8453 as const;
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

// ---------------------------------------------------------------------------
// Input format guards
// ---------------------------------------------------------------------------

/** 0x-prefixed EVM address — 42 chars total */
const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
/** 0x-prefixed 32-byte nonce — 66 chars total */
const NONCE_RE = /^0x[0-9a-fA-F]{64}$/;
/** 0x-prefixed 65-byte ECDSA signature — 132 chars total */
const SIG_RE = /^0x[0-9a-fA-F]{130}$/;
/** Non-negative integer string (uint256 as decimal) */
const UINT_STR_RE = /^(0|[1-9]\d*)$/;

/** Phase 2.3 version marker */
export const BASE_METHOD_PHASE = '2.3' as const;

// ---------------------------------------------------------------------------
// Token config
// ---------------------------------------------------------------------------

export const BASE_TOKEN_CONFIG = {
    USDC: {
        mainnet: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address,
        sepolia: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
        decimals: 6,
        eip712Name: 'USD Coin',
        eip712Version: '2',
    },
    EURC: {
        mainnet: '0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42' as Address,
        sepolia: '0x08210F9170F89Ab7658F0B5E3fF39b0E03C2230b' as Address,
        decimals: 6,
        eip712Name: 'Euro Coin',
        eip712Version: '2',
    },
} as const;

export type BaseCurrency = keyof typeof BASE_TOKEN_CONFIG;
export type BaseNetwork = 'base' | 'base-sepolia';

function chainId(network: BaseNetwork): number {
    return network === 'base' ? BASE_CHAIN_ID : BASE_SEPOLIA_CHAIN_ID;
}

function tokenAddress(currency: BaseCurrency, network: BaseNetwork): Address {
    return network === 'base'
        ? BASE_TOKEN_CONFIG[currency].mainnet
        : BASE_TOKEN_CONFIG[currency].sepolia;
}

// ---------------------------------------------------------------------------
// EIP-712 types (TransferWithAuthorization)
// ---------------------------------------------------------------------------

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
    TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
    ],
} as const;

// ---------------------------------------------------------------------------
// Request schema
// ---------------------------------------------------------------------------

const requestSchema = z.object({
    /** Human-readable decimal amount (e.g. "0.001" = $0.001). Ignored when amountRaw is set. */
    amount: z.optional(z.string()),
    /** Raw atomic amount string (e.g. "1000"). Takes precedence over amount. */
    amountRaw: z.optional(z.string()),
    /** Token symbol. Defaults to USDC. */
    currency: z.optional(z.enum(['USDC', 'EURC'])),
    /** Network. Defaults to base (mainnet). */
    network: z.optional(z.enum(['base', 'base-sepolia'])),
    /** Recipient address (0x-prefixed). Required. */
    recipient: z.string(),
});

// ---------------------------------------------------------------------------
// Credential schema — EIP-3009 authorization + signature
// ---------------------------------------------------------------------------

const authorizationSchema = z.object({
    /** Payer address. */
    from: z.string(),
    /** Recipient address. Must match request.recipient. */
    to: z.string(),
    /** Raw token amount in atomic units (uint256 as decimal string). */
    value: z.string(),
    /** Unix timestamp — authorization not valid before this. */
    validAfter: z.string(),
    /** Unix timestamp — authorization expires at this. */
    validBefore: z.string(),
    /**
     * 32-byte random nonce (0x-prefixed hex, length 66).
     * Used once — replay protection enforced on-chain.
     */
    nonce: z.string(),
});

const credentialPayloadSchema = z.object({
    /**
     * EIP-3009 TransferWithAuthorization authorization fields.
     * Signed by the client via eth_signTypedData_v4.
     */
    authorization: authorizationSchema,
    /**
     * EIP-712 signature (65-byte hex, 0x-prefixed).
     * Produced by signTypedData over (domain, TransferWithAuthorization, authorization).
     */
    signature: z.string(),
});

// ---------------------------------------------------------------------------
// Method definition
// ---------------------------------------------------------------------------

/**
 * The `base` charge method.
 *
 * Register with mppx via:
 * ```ts
 * import { Mppx } from 'mppx/server';
 * import { baseCharge } from '@p402/mpp-method';
 *
 * const mppx = Mppx.create({ methods: [baseCharge], secretKey });
 * ```
 */
export const baseCharge = Method.from({
    name: 'base',
    intent: 'charge',
    schema: {
        request: requestSchema,
        credential: {
            payload: credentialPayloadSchema,
        },
    },
});

export type BaseChargeRequest = z.output<typeof requestSchema>;
export type BaseChargeAuthorization = z.output<typeof authorizationSchema>;
export type BaseChargeCredential = z.output<typeof credentialPayloadSchema>;

/** Data passed to the onSettle callback for on-chain execution (Phase 3.2). */
export type BaseChargeSettleData = {
    authorization: BaseChargeAuthorization;
    /** Raw EIP-712 packed 65-byte signature (0x-prefixed). */
    signature: string;
    currency: BaseCurrency;
    network: BaseNetwork;
    requiredRaw: bigint;
};

/** Callback executed by the route handler to perform the actual on-chain transfer. */
export type BaseChargeSettleCallback = (data: BaseChargeSettleData) => Promise<string>;

// ---------------------------------------------------------------------------
// Offline verification helpers (pure — no RPC required)
// ---------------------------------------------------------------------------

/**
 * Verify the EIP-712 signature offline using viem verifyTypedData.
 * Returns the signer address on success or throws with a descriptive message.
 */
async function verifyEip712Signature(params: {
    authorization: BaseChargeAuthorization;
    signature: Hex;
    currency: BaseCurrency;
    network: BaseNetwork;
}): Promise<Address> {
    const { authorization, signature, currency, network } = params;
    const token = BASE_TOKEN_CONFIG[currency];
    const contract = tokenAddress(currency, network);

    const domain = {
        name: token.eip712Name,
        version: token.eip712Version,
        chainId: chainId(network),
        verifyingContract: contract,
    };

    const message = {
        from: authorization.from as Address,
        to: authorization.to as Address,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as Hex,
    };

    const valid = await verifyTypedData({
        address: authorization.from as Address,
        domain,
        types: TRANSFER_WITH_AUTHORIZATION_TYPES,
        primaryType: 'TransferWithAuthorization',
        message,
        signature,
    });

    if (!valid) {
        throw new Error('base: EIP-712 signature verification failed — recovered address mismatch');
    }

    return authorization.from as Address;
}

/**
 * Validate authorization fields against the request constraints.
 * Pure — no network calls.
 */
function validateAuthorizationConstraints(params: {
    authorization: BaseChargeAuthorization;
    signature: string;
    recipient: string;
    requiredRaw: bigint;
}): void {
    const { authorization, signature, recipient, requiredRaw } = params;

    // Address format checks (before any BigInt or crypto work)
    if (!ADDR_RE.test(authorization.from)) {
        throw new Error('base: authorization.from is not a valid EVM address');
    }
    if (!ADDR_RE.test(authorization.to)) {
        throw new Error('base: authorization.to is not a valid EVM address');
    }
    if (!ADDR_RE.test(recipient)) {
        throw new Error('base: recipient is not a valid EVM address');
    }

    // uint256 string safety — reject hex, scientific notation, negatives
    if (!UINT_STR_RE.test(authorization.value)) {
        throw new Error('base: authorization.value must be a non-negative decimal integer string');
    }
    if (!UINT_STR_RE.test(authorization.validAfter)) {
        throw new Error('base: authorization.validAfter must be a non-negative decimal integer string');
    }
    if (!UINT_STR_RE.test(authorization.validBefore)) {
        throw new Error('base: authorization.validBefore must be a non-negative decimal integer string');
    }

    // Nonce format
    if (!NONCE_RE.test(authorization.nonce)) {
        throw new Error('base: authorization.nonce must be a 0x-prefixed 32-byte hex string');
    }

    // Signature format (65 bytes = 130 hex chars + "0x" = 132 total)
    if (!SIG_RE.test(signature)) {
        throw new Error('base: signature must be a 0x-prefixed 65-byte hex string');
    }

    // Business logic checks (safe to BigInt() now — strings are validated)
    const nowSec = BigInt(Math.floor(Date.now() / 1000));

    if (authorization.to.toLowerCase() !== recipient.toLowerCase()) {
        throw new Error('base: authorization.to does not match the expected recipient');
    }

    if (nowSec < BigInt(authorization.validAfter)) {
        throw new Error('base: authorization not yet valid (validAfter in the future)');
    }

    if (nowSec >= BigInt(authorization.validBefore)) {
        throw new Error('base: authorization expired (validBefore in the past)');
    }

    if (BigInt(authorization.value) < requiredRaw) {
        throw new Error('base: authorization.value is less than the required amount');
    }
}

// ---------------------------------------------------------------------------
// Server implementation
// ---------------------------------------------------------------------------

/**
 * Verification function for the `base` charge method.
 *
 * Performs offline EIP-712 signature verification and constraint checks.
 * When `onSettle` is provided (Phase 3.2+), executes on-chain via the callback.
 * On-chain nonce replay protection is provided by both:
 *   - Redis nonce lock in the onSettle executor (pre-execution)
 *   - FacilitatorWallet.executeSettlement simulation (on-chain revert if already used)
 */
export async function verifyBaseCharge(params: {
    request: BaseChargeRequest;
    credential: { payload: BaseChargeCredential };
    challengeId: string;
    /** On-chain settlement executor supplied by the route handler (Phase 3.2). */
    onSettle?: BaseChargeSettleCallback;
}): Promise<Receipt.Receipt> {
    const { request, credential } = params;

    const currency = (request.currency ?? 'USDC') as BaseCurrency;
    const network = (request.network ?? 'base') as BaseNetwork;
    const decimals = BASE_TOKEN_CONFIG[currency].decimals;

    const requiredRaw = resolveAmount({
        amount: request.amount,
        amountRaw: request.amountRaw,
        decimals,
    });

    const { authorization, signature } = credential.payload;

    // 1. Validate structural constraints (pure — format guards before any crypto)
    validateAuthorizationConstraints({
        authorization,
        signature,
        recipient: request.recipient,
        requiredRaw,
    });

    // 2. Verify EIP-712 signature offline (pure — no RPC)
    await verifyEip712Signature({
        authorization,
        signature: signature as Hex,
        currency,
        network,
    });

    // 3. On-chain settlement via executor callback (Phase 3.2).
    // When onSettle is absent the receipt reference is the nonce (offline-verify only mode).
    // When onSettle is present, txHash becomes the reference after successful execution.
    // On-chain replay is caught by simulateContract: "authorization is used" → throws.
    let reference = authorization.nonce;
    if (params.onSettle) {
        reference = await params.onSettle({
            authorization,
            signature,
            currency,
            network,
            requiredRaw,
        });
    }

    return Receipt.from({
        method: 'base',
        status: 'success',
        reference,
        timestamp: new Date().toISOString(),
    });
}
