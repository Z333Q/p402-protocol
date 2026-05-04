import { parseUnits } from 'viem';

/**
 * Input to a P402 charge request. Both `amount` and `amountRaw` are optional
 * individually, but at least one must be present (enforced by the method schema).
 */
export interface AmountInput {
    /** Human-readable decimal amount (e.g. "0.001" = $0.001 USDC). */
    amount?: string;
    /**
     * Raw atomic amount string (e.g. "1000" = 1000 raw units).
     * Takes precedence over `amount` when both are provided.
     */
    amountRaw?: string;
    /** Token decimals. Defaults to 6 (USDC). */
    decimals?: number;
}

/**
 * Resolve the charge amount to a bigint of raw atomic units.
 *
 * Precedence: `amountRaw` > `amount`.
 * Precision: uses viem `parseUnits` for `amount` — no floating-point error.
 *
 * @example
 * resolveAmount({ amountRaw: '1000' })      // 1000n
 * resolveAmount({ amount: '0.001' })        // 1000n  (6 decimals)
 * resolveAmount({ amount: '0.001', amountRaw: '500' }) // 500n (amountRaw wins)
 */
// Matches a non-negative integer string with no leading zeros (or exactly "0").
const NON_NEG_INT_RE = /^(0|[1-9]\d*)$/;

// Matches a non-negative decimal string: digits, optionally followed by "." + digits.
const NON_NEG_DEC_RE = /^\d+(\.\d+)?$/;

export function resolveAmount(input: AmountInput): bigint {
    if (input.amountRaw !== undefined) {
        if (!NON_NEG_INT_RE.test(input.amountRaw)) {
            throw new Error(
                `resolveAmount: amountRaw must be a non-negative integer string, got "${input.amountRaw}"`
            );
        }
        return BigInt(input.amountRaw);
    }
    if (input.amount !== undefined) {
        if (!NON_NEG_DEC_RE.test(input.amount)) {
            throw new Error(
                `resolveAmount: amount must be a non-negative decimal string, got "${input.amount}"`
            );
        }
        const decimals = input.decimals ?? 6;
        return parseUnits(input.amount, decimals);
    }
    throw new Error('resolveAmount: either amount or amountRaw is required');
}

/**
 * Format a raw bigint amount back to a human-readable decimal string.
 * Inverse of resolveAmount({ amount }).
 */
export function formatAmount(raw: bigint, decimals = 6): string {
    const divisor = 10n ** BigInt(decimals);
    const whole = raw / divisor;
    const remainder = raw % divisor;
    if (remainder === 0n) return whole.toString();
    const fracStr = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
    return `${whole}.${fracStr}`;
}
