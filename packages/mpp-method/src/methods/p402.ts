/**
 * @p402/mpp-method — `p402` charge method
 *
 * A custom mppx payment method that routes charges through P402's multi-rail
 * settlement infrastructure (Tempo mainnet + Base mainnet + future rails).
 *
 * ## Schema decisions (v4 final)
 * - Both `amount` (human decimal) and `amountRaw` (raw atomic string) accepted.
 * - `amountRaw` takes precedence when both are present.
 * - `resolveAmount()` exported for external consumers.
 * - `p402SessionId` is a P402 router session identifier — NOT an MPP session intent.
 *   (MPP session intent is deferred to v0.2 / Phase 4.)
 * - `preferredRail` auto-selects based on facilitator health when set to 'auto'.
 *
 * ## Credential format (option C — opaque session token + ECDSA signature)
 * The client obtains a P402 session token from the router at challenge time and
 * submits it with an ECDSA signature over (challengeId ‖ sessionToken).
 * The server verifies the signature against the challenge and session balance.
 *
 * ## Server logic stub
 * `verifyP402Charge()` is intentionally stubbed in v0.1.
 * - Phase 3.1 wires Billing Guard (6 layers).
 * - Phase 3.2 wires multi-rail dispatch and on-chain settlement.
 * Replace the TODO blocks with real implementations.
 */

import { Method, Receipt, z } from 'mppx';
import { resolveAmount } from '../amount.js';

// ---------------------------------------------------------------------------
// Request schema  (zod/mini — use z.optional(schema), NOT schema.optional())
// ---------------------------------------------------------------------------

const requestSchema = z.object({
    /**
     * Human-readable decimal amount (e.g. "0.001" = $0.001 USDC).
     * Ignored when `amountRaw` is also set.
     */
    amount: z.optional(z.string()),
    /**
     * Raw atomic amount string (e.g. "1000" = 1000 smallest units).
     * Takes precedence over `amount`.
     */
    amountRaw: z.optional(z.string()),
    /** Token symbol or contract address. Defaults to USDC. */
    currency: z.optional(z.string()),
    /** Token decimals. Defaults to 6. */
    decimals: z.optional(z.number()),
    /** Recipient address (0x-prefixed). Required. */
    recipient: z.string(),
    /** P402 Billing Guard policy ID. Enforced in Phase 3.1. */
    policyId: z.optional(z.string()),
    /**
     * P402 router session identifier for budget tracking.
     *
     * ⚠ This is NOT an MPP session intent (which is a v0.2 / Phase 4 concept).
     * It identifies a pre-funded P402 session that covers this charge.
     * If set, the charge is debited against the session budget rather than
     * requiring a per-request payment credential.
     */
    p402SessionId: z.optional(z.string()),
    /** Arbitrary tag forwarded to P402 analytics (Phase 3.3). */
    analyticsTag: z.optional(z.string()),
    /**
     * Payment rail preference.
     * - 'tempo'  — Tempo mainnet (TIP-20 stablecoins, chain 4217)
     * - 'base'   — Base mainnet (EIP-3009 USDC, chain 8453) — Phase 2.3+
     * - 'auto'   — router selects based on facilitator health + cost (default)
     */
    preferredRail: z.optional(z.enum(['tempo', 'base', 'auto'])),
});

// ---------------------------------------------------------------------------
// Credential schema (option C — opaque session token + ECDSA signature)
// ---------------------------------------------------------------------------

const credentialPayloadSchema = z.object({
    /**
     * Opaque P402 session token issued by the router at challenge time.
     * Encodes settlement authorization without revealing the private key.
     */
    sessionToken: z.string(),
    /**
     * ECDSA signature of keccak256(challengeId ‖ sessionToken) by the payer.
     * Verifies the credential was created by the legitimate payer.
     */
    clientSignature: z.string(),
});

// ---------------------------------------------------------------------------
// Method definition
// ---------------------------------------------------------------------------

/**
 * The `p402` charge method.
 *
 * Register with mppx via:
 * ```ts
 * import { Mppx } from 'mppx/server';
 * import { p402Charge } from '@p402/mpp-method';
 *
 * const mppx = Mppx.create({ methods: [p402Charge], secretKey });
 * ```
 */
export const p402Charge = Method.from({
    name: 'p402',
    intent: 'charge',
    schema: {
        request: requestSchema,
        credential: {
            payload: credentialPayloadSchema,
        },
    },
});

export type P402ChargeRequest = z.output<typeof requestSchema>;
export type P402ChargeCredential = z.output<typeof credentialPayloadSchema>;

/** Data passed to the onSettle callback for multi-rail dispatch (Phase 3.2). */
export type P402ChargeSettleData = {
    rail: 'tempo' | 'base' | 'auto';
    amount: bigint;
    recipient: string;
    currency: string;
};

/** Callback executed by the route handler to dispatch settlement to the chosen rail. */
export type P402ChargeSettleCallback = (data: P402ChargeSettleData) => Promise<string>;

// ---------------------------------------------------------------------------
// Server implementation (stub — Phase 3.1/3.2 wires real logic)
// ---------------------------------------------------------------------------

/**
 * Verification function for the `p402` charge method.
 *
 * Resolves the requested amount and dispatches to the settlement rail via
 * the optional `onSettle` callback. When `onSettle` is absent, the function
 * returns a receipt with the sessionToken as reference (offline-verify mode,
 * suitable for staging / canary environments).
 *
 * Phase 3.1: Billing Guard (6-layer) wired in the route handler — not here.
 * Phase 3.2: Multi-rail dispatch via `onSettle` callback.
 * Phase 3.2: clientSignature verification requires the payer address from the
 *   opaque sessionToken — a router concern deferred to Phase 3.2.5.
 */
export async function verifyP402Charge(params: {
    request: P402ChargeRequest;
    credential: { payload: P402ChargeCredential };
    challengeId: string;
    /** Multi-rail settlement executor supplied by the route handler (Phase 3.2). */
    onSettle?: P402ChargeSettleCallback;
}): Promise<Receipt.Receipt> {
    const { request, credential } = params;

    const rawAmount = resolveAmount({
        amount: request.amount,
        amountRaw: request.amountRaw,
        decimals: request.decimals ?? 6,
    });

    let reference = credential.payload.sessionToken;
    if (params.onSettle) {
        reference = await params.onSettle({
            rail: request.preferredRail ?? 'auto',
            amount: rawAmount,
            recipient: request.recipient,
            currency: request.currency ?? 'USDC',
        });
    }

    return Receipt.from({
        method: 'p402',
        status: 'success',
        reference,
        timestamp: new Date().toISOString(),
    });
}
