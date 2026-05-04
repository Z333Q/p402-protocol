/**
 * Utilities for decoding mppx Payment credentials from HTTP headers.
 *
 * Every server that accepts Authorization: Payment <...> headers needs to
 * decode the base64url JSON to dispatch to the correct verifier. This module
 * exports that helper so callers do not have to re-implement it.
 */

/**
 * The result type returned by mppx.compose() when two or more methods are
 * registered with the same intent. Import this to avoid defining it locally.
 *
 * Usage:
 * ```ts
 * import type { ComposeResult } from '@p402/mpp-method';
 * const result = await (mppx as any).compose(...)(req) as ComposeResult;
 * ```
 */
export type ComposeResult =
    | { status: 402; challenge: Response }
    | { status: 200; withReceipt: (res: Response) => Response };

/**
 * Decoded credential from an Authorization: Payment <base64url JSON> header.
 *
 * `method` is null when the header is missing or the JSON lacks a method field.
 * Callers should reject requests with a null method before calling a verifier.
 */
export interface DecodedPayment {
    /** Method name from the credential JSON, e.g. 'p402' or 'base'. Null on parse failure. */
    method: string | null;
    /** Raw credential payload object. Cast to the appropriate *Credential type before use. */
    payload: Record<string, unknown>;
    /** mppx challenge ID. Null when absent. */
    challengeId: string | null;
}

/**
 * Decode an `Authorization: Payment <base64url JSON>` header.
 *
 * Returns safe null/empty defaults on any parse failure — never throws.
 *
 * @example
 * const auth = req.headers.get('authorization') ?? '';
 * const { method, payload, challengeId } = decodePaymentHeader(auth);
 * if (!method) return new Response('Missing payment credential', { status: 400 });
 *
 * if (method === 'base') {
 *   await verifyBaseCharge({ ..., credential: { payload: payload as BaseChargeCredential } });
 * } else {
 *   await verifyP402Charge({ ..., credential: { payload: payload as P402ChargeCredential } });
 * }
 */
export function decodePaymentHeader(header: string): DecodedPayment {
    try {
        const encoded = header.startsWith('Payment ') ? header.slice(8) : '';
        if (!encoded) return { method: null, payload: {}, challengeId: null };
        const json = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
            method?: string;
            payload?: Record<string, unknown>;
            challengeId?: string;
        };
        return {
            method: json.method ?? null,
            payload: json.payload ?? {},
            challengeId: json.challengeId ?? null,
        };
    } catch {
        return { method: null, payload: {}, challengeId: null };
    }
}
