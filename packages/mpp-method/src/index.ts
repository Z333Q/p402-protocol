/**
 * @p402/mpp-method
 *
 * Custom mppx payment methods for the P402 AI Payment Router.
 *
 * ## Quick start
 *
 * ```ts
 * import { Mppx } from 'mppx/server';
 * import { p402Charge, resolveAmount } from '@p402/mpp-method';
 *
 * const mppx = Mppx.create({
 *   methods: [p402Charge],
 *   secretKey: process.env.MPP_SECRET_KEY!,
 * });
 *
 * // In your route handler:
 * const result = await mppx.charge({ amount: '0.001', recipient: '0x...' })(req);
 * if (result.status === 402) return result.challenge;
 * return result.withReceipt(new Response('OK'));
 * ```
 *
 * ## Amount helpers
 *
 * ```ts
 * resolveAmount({ amount: '0.001' })           // → 1000n  (USDC, 6 decimals)
 * resolveAmount({ amountRaw: '1000' })         // → 1000n
 * resolveAmount({ amount: '1', decimals: 18 }) // → 1000000000000000000n
 * ```
 *
 * ## Methods
 * - `p402Charge` — multi-rail P402 payment (Tempo + Base, Phase 2.2+)
 * - `baseCharge` — EIP-3009 USDC/EURC on Base mainnet + Sepolia (Phase 2.3)
 */

// Amount utilities
export { resolveAmount, formatAmount } from './amount.js';
export type { AmountInput } from './amount.js';

// Header decoding + compose result type
export { decodePaymentHeader } from './decode.js';
export type { DecodedPayment, ComposeResult } from './decode.js';

// p402 method
export { p402Charge, verifyP402Charge } from './methods/p402.js';
export type {
    P402ChargeRequest,
    P402ChargeCredential,
    P402ChargeSettleData,
    P402ChargeSettleCallback,
} from './methods/p402.js';

// base method (EIP-3009, Base mainnet + Sepolia)
export {
    baseCharge,
    verifyBaseCharge,
    BASE_CHAIN_ID,
    BASE_SEPOLIA_CHAIN_ID,
    BASE_TOKEN_CONFIG,
} from './methods/base.js';
export type {
    BaseChargeRequest,
    BaseChargeCredential,
    BaseChargeAuthorization,
    BaseChargeSettleData,
    BaseChargeSettleCallback,
    BaseCurrency,
    BaseNetwork,
} from './methods/base.js';
