/**
 * P402 SDK - Types
 * =================
 * Shared TypeScript definitions for the P402 SDK.
 */

import type { Address, Hash, Hex } from 'viem';

// =============================================================================
// NETWORK TYPES
// =============================================================================

export type Network = 'eip155:8453' | 'eip155:84532' | 'eip155:1' | 'eip155:4217';

export type PaymentScheme = 'exact' | 'onchain' | 'receipt';

// =============================================================================
// EIP-712 & EIP-3009 TYPES
// =============================================================================

/**
 * EIP-712 Domain Separator
 * Used for typed data signing in gasless transactions
 */
export interface EIP712Domain {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: Address;
}

/**
 * EIP-3009 Authorization
 * Gasless USDC transfer authorization structure
 */
export interface EIP3009Authorization {
    from: Address;
    to: Address;
    value: bigint | string;
    validAfter: number | string;
    validBefore: number | string;
    nonce: Hex;
    v: number;
    r: Hex;
    s: Hex;
}

/**
 * EIP-712 Mandate (for AP2 governance)
 * Signed spending authorization from user to agent
 */
export interface EIP712Mandate {
    /** User's DID or wallet address */
    grantor: string;
    /** Agent's DID */
    grantee: string;
    /** Maximum spend amount in USD */
    maxAmountUSD: string;
    /** Allowed actions (e.g., ['ai.completion', 'ai.embedding']) */
    allowedActions: string[];
    /** Unix timestamp after which mandate is valid */
    validAfter: number;
    /** Unix timestamp before which mandate is valid */
    validBefore: number;
    /** Unique nonce to prevent replay */
    nonce: Hex;
}

/**
 * Signed EIP-712 Mandate with signature components
 */
export interface SignedMandate extends EIP712Mandate {
    signature: Hex;
    v: number;
    r: Hex;
    s: Hex;
}

// =============================================================================
// API TYPES
// =============================================================================

/**
 * V1 Router Plan Request
 */
export interface PlanRequest {
    routeId?: string;
    payment: {
        amount: string;
        asset: string;
        network: Network;
        scheme?: PaymentScheme;
    };
    policyId?: string;
}

/**
 * V1 Router Plan Response
 */
export interface PlanResponse {
    decision_id: string;
    allow: boolean;
    candidates: Array<{
        id: string;
        name: string;
        tier: number;
        payment: {
            treasuryAddress: Address;
            network: Network;
        };
    }>;
    policy?: {
        applied: boolean;
        reasons?: string[];
    };
}

/**
 * V1 Settle Request
 */
export interface SettleRequest {
    txHash?: Hash;
    authorization?: EIP3009Authorization;
    amount: string;
    asset: string;
    tenantId?: string;
    decisionId?: string;
}

/**
 * V1 Settle Response (x402 compliant)
 */
export interface SettleResponse {
    success: boolean;
    payer?: Address;
    transaction?: Hash;
    network?: Network;
    receipt?: {
        txHash: Hash;
        verifiedAmount: string;
        asset: string;
        timestamp: string;
    };
    errorReason?: string;
    error?: {
        code: string;
        message: string;
    };
}

// =============================================================================
// V2 API TYPES
// =============================================================================

/**
 * V2 Chat Completion Request
 */
export interface ChatCompletionRequest {
    model?: string;
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
    p402?: {
        mode?: 'cost' | 'quality' | 'speed' | 'balanced';
        cache?: boolean;
        maxCost?: number;
        /** Bind this request to an existing session for budget tracking. */
        session_id?: string;
        /**
         * Preferred settlement rail. 'auto' (default) picks the cheaper healthy rail.
         * 'tempo' forces Tempo mainnet TIP-20 settlement (USDC.e, chain 4217).
         * 'base' forces Base mainnet EIP-3009 settlement (USDC/EURC, chain 8453).
         */
        preferred_rail?: 'auto' | 'tempo' | 'base';
        /** Free-form attribution tag surfaced in p402_metadata and traffic analytics. */
        analytics_tag?: string;
    };
}

/**
 * V2 Chat Completion Response
 */
export interface ChatCompletionResponse {
    id: string;
    object: 'chat.completion';
    choices: Array<{
        message: {
            role: 'assistant';
            content: string;
        };
        finish_reason: string;
    }>;
    usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
    p402_metadata: {
        request_id: string;
        tenant_id: string;
        provider?: string;
        model?: string;
        cost_usd?: number;
        /** List-price cost at the selected provider (before routing/caching savings) */
        direct_cost?: number;
        /** Amount saved vs direct API access */
        savings?: number;
        latency_ms: number;
        provider_latency_ms?: number;
        /** Time to first byte (streaming only) */
        ttfb_ms?: number;
        input_tokens?: number;
        output_tokens?: number;
        /** Alias for output_tokens in streaming responses */
        tokens_generated?: number;
        cached: boolean;
        routing_mode?: string;
        /** True if this request was served to a World ID–verified unique human */
        human_verified?: boolean;
        /**
         * Remaining free-trial uses for this human+endpoint combination.
         * Null when human_verified is false or the trial limit is not applicable.
         */
        human_usage_remaining?: number | null;
        /**
         * ERC-8004 on-chain reputation score (0–100). Null until Phase 2.
         */
        reputation_score?: number | null;
        /** Settlement rail used for this request: 'tempo', 'base', or null when uncollected. */
        payment_rail?: string | null;
        /** Raw charge amount in atomic stablecoin units (string-encoded bigint). */
        charge_amount_raw?: string | null;
        /** analytics_tag echoed from the request p402 block, if provided. */
        analytics_tag?: string | null;
    };
}

/**
 * V2 Session
 */
export interface Session {
    object: 'session';
    id: string;
    tenant_id: string;
    agent_id?: string;
    wallet_address?: string;
    wallet_source?: 'cdp' | 'eoa';
    budget: {
        total_usd: number;
        used_usd: number;
        remaining_usd: number;
    };
    policy?: Record<string, any>;
    status: 'active' | 'exhausted' | 'expired' | 'ended' | 'revoked';
    created_at: string;
    expires_at: string;
    ended_at?: string;
}

/**
 * V2 Governance Policy
 */
export interface Policy {
    id: string;
    name: string;
    rules: Record<string, any>;
    status: 'active' | 'revoked';
    version: string;
    created_at: string;
    updated_at: string;
}

/**
 * V2 AP2 Mandate
 */
export interface Mandate {
    id: string;
    type: 'payment' | 'delegation';
    user_did: string;
    agent_did: string;
    constraints: {
        max_amount_usd?: number;
        allowed_actions?: string[];
        expires_at?: string;
    };
    amount_spent_usd: number;
    status: 'active' | 'exhausted' | 'revoked';
    created_at: string;
}

// =============================================================================
// CLIENT TYPES
// =============================================================================

/**
 * World AgentKit signer — provided by the agent's wallet integration.
 * Compatible with viem's `signMessage`, wagmi's `signMessage`, and
 * ethers `Wallet.signMessage` (async wrapper required).
 */
export interface WorldIdSigner {
    /** The agent's wallet address (checksummed or lowercase — both accepted) */
    address: string;
    /** CAIP-2 chain identifier (default: "eip155:8453" Base mainnet) */
    chainId?: string;
    /**
     * Sign a UTF-8 message string with EIP-191 personal_sign.
     * Returns the hex signature (0x-prefixed).
     *
     * @example viem: `(msg) => walletClient.signMessage({ message: msg })`
     * @example ethers: `(msg) => wallet.signMessage(msg)`
     */
    signMessage: (message: string) => Promise<string>;
}

export interface P402Config {
    /** Base URL for P402 router (default: https://p402.io) */
    routerUrl?: string;
    /** Enable debug logging */
    debug?: boolean;
    /** API key for authenticated requests */
    apiKey?: string;
    /** Default network */
    network?: Network;
    /**
     * World AgentKit configuration.
     * When `signer` is provided and the server signals that free-trial access
     * is available (via `agentkit_challenge` in a 429 response), the SDK
     * transparently signs the SIWE challenge and retries the request.
     */
    worldId?: {
        /** Enable World AgentKit transparent retry (default: true when signer is set) */
        enabled?: boolean;
        /** Wallet signer for signing SIWE challenges */
        signer?: WorldIdSigner;
    };
}

export interface PaymentRequest {
    amount: string;
    token?: TokenConfig;
    network?: Network;
}

export interface PaymentResult {
    success: boolean;
    txHash?: Hash;
    receipt?: SettleResponse['receipt'];
    error?: import('./errors.js').P402Error;
}

export interface TokenConfig {
    address: Address;
    decimals: number;
    symbol: string;
    eip712?: {
        name: string;
        version: string;
    };
}

// =============================================================================
// ERROR TYPES
// =============================================================================

export type P402ErrorCode =
    | 'INVALID_INPUT'
    | 'POLICY_DENIED'
    | 'TRANSACTION_FAILED'
    | 'SETTLEMENT_FAILED'
    | 'NETWORK_ERROR'
    | 'UNAUTHORIZED'
    | 'RATE_LIMITED'
    | 'BUDGET_EXCEEDED'
    // Raised client-side BEFORE any HTTP request when the caller passes a
    // content-bearing key to meter.recordEvent. P402 meters economics, not
    // content — the SDK is the first gate, the router is the second.
    | 'METER_CONTENT_REJECTED'
    | 'OUTCOME_INVALID_STATUS';

// =============================================================================
// METER / OUTCOMES TYPES
// =============================================================================

/**
 * Privacy posture for an economic event. See V5 §27.x and the router's
 * tenant_privacy_settings + privacy_scope_overrides resolution rules.
 *
 *  - metadata_only     (default) economics + attribution + governance only
 *  - fingerprint_only  HMAC fingerprint of content; no raw content persisted
 *  - redacted_trace    caller-applied redaction; flagged as redacted
 *  - private_gateway   no content ever leaves caller's perimeter
 *  - full_trace        opt-in only; content persisted under retention
 */
export type PrivacyMode =
    | 'metadata_only'
    | 'fingerprint_only'
    | 'redacted_trace'
    | 'private_gateway'
    | 'full_trace';

export type AttributionScope =
    | 'tenant' | 'department' | 'employee' | 'workflow' | 'project'
    | 'agent'  | 'customer'   | 'feature'  | 'api_key';

export type OutcomeStatus =
    | 'accepted'
    | 'rejected'
    | 'retried'
    | 'escalated'
    | 'human_reviewed'
    | 'failed';

/**
 * Keys the SDK refuses to send to POST /api/v2/meter/events. The router
 * enforces the same set; we duplicate it here so the request fails BEFORE
 * the network hop (cheaper to debug, no risk of accidental network capture).
 *
 * Kept as a const tuple so callers can also reference it via
 *   import { METER_FORBIDDEN_CONTENT_KEYS } from '@p402/sdk'
 */
export const METER_FORBIDDEN_CONTENT_KEYS = [
    'prompt', 'prompts',
    'response', 'responses', 'completion',
    'messages', 'message', 'content', 'text',
    'file', 'files', 'document', 'documents',
    'chat', 'chat_history', 'transcript',
    'pii', 'phi', 'secret', 'secrets', 'source_code',
] as const;

export interface MeterEventAttribution {
    owner_type?: AttributionScope;
    owner_id?: string;
    department_id?: string;
    employee_id?: string;
    customer_id?: string;
    project_id?: string;
    feature_id?: string;
    workflow_id?: string;
    api_key_id?: string;
    task_type?: string;
    action_type?: string;
}

export interface MeterEventModel {
    provider?: string;
    model_used?: string;
    model_requested?: string;
}

export interface MeterEventUsage {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    cost_usd?: number;
    direct_cost_usd?: number;
    route_savings_usd?: number;
    cache_savings_usd?: number;
    retry_cost_usd?: number;
    context_waste_usd?: number;
    latency_ms?: number;
    cache_hit?: boolean;
}

export interface MeterEventEconomics {
    revenue_usd?: number;
    gross_margin_pct?: number;
}

export interface MeterEventGovernance {
    budget_id?: string;
    policy_id?: string;
    mandate_id?: string;
    decision?: 'approved' | 'denied' | 'warned' | 'requires_review' |
               'settlement_required' | 'settled' | 'receipt_reused' |
               'cached' | 'optimized';
    deny_code?: string;
}

export interface MeterEventEvidence {
    receipt_id?: string;
    evidence_bundle_id?: string;
}

export interface MeterEventOutcome {
    status?: OutcomeStatus | 'revised' | 'pending_review' | 'unknown';
    quality_score?: number;
    human_review_status?: 'not_required' | 'required' | 'pending' |
                          'approved' | 'rejected' | 'escalated' | 'expired';
}

/**
 * Input to p402.meter.recordEvent(). Maps directly onto the router's
 * POST /api/v2/meter/events body shape.
 */
export interface MeterEventInput {
    request_id: string;
    source?: string;
    privacy_mode?: PrivacyMode;
    attribution?: MeterEventAttribution;
    model?: MeterEventModel;
    usage?: MeterEventUsage;
    economics?: MeterEventEconomics;
    governance?: MeterEventGovernance;
    evidence?: MeterEventEvidence;
    outcome?: MeterEventOutcome;
    metadata?: Record<string, unknown>;
}

/** Privacy block echoed back in every meter response. */
export interface MeterEventPrivacy {
    mode: PrivacyMode | null;
    source: 'system_default' | 'tenant_default' | 'scope_override' | null;
    prompt_stored: boolean;
    response_stored: boolean;
    redaction_applied: boolean;
    retention_expires_at: string | null;
}

/** 200 OK: canonical ai_economic_events row landed. */
export interface MeterEventWriteResult {
    ok: true;
    deferred?: false;
    event_id: string;
    request_id: string;
    privacy: MeterEventPrivacy;
}

/**
 * 202 Accepted: primary INSERT failed but the durability outbox captured
 * the row. The retry worker (cron) will replay. No event_id is returned —
 * the canonical id only exists after a successful replay.
 */
export interface MeterEventDeferredResult {
    ok: true;
    deferred: true;
    request_id: string;
    message: string;
    privacy: MeterEventPrivacy;
}

export type MeterEventResult = MeterEventWriteResult | MeterEventDeferredResult;

/**
 * Per-event result in a batch response. Mirrors the two single-event
 * shapes plus an `error` shape for the events the router rejected
 * individually (e.g. missing request_id, content-key present). The
 * batch as a whole is only 4xx when the request envelope itself is
 * malformed; per-event failures ride inside `results`.
 */
export interface MeterBatchItemOk {
    ok: true;
    deferred: false;
    request_id: string;
    event_id: string;
}
export interface MeterBatchItemDeferred {
    ok: true;
    deferred: true;
    request_id: string;
    message: string;
}
export interface MeterBatchItemError {
    ok: false;
    request_id: string | null;
    error: { code: string; message: string };
}
export type MeterBatchItem = MeterBatchItemOk | MeterBatchItemDeferred | MeterBatchItemError;

export interface MeterBatchResult {
    ok: true;
    accepted: number;
    deferred: number;
    rejected: number;
    results: MeterBatchItem[];
}

/**
 * Batch-flush configuration for MeterClient. Both bounds are soft: a
 * flush fires when either is reached. Set neither and MeterClient
 * behaves as before (no buffering).
 */
export interface MeterBatchConfig {
    /** Flush when the buffer reaches this many events. Default 100. */
    maxEvents?: number;
    /** Flush this many ms after the first buffered event. Default 1000. */
    maxLatencyMs?: number;
}

/**
 * Retry configuration for MeterClient. Applies to both single-event
 * and batch calls. Retries fire on network errors and 5xx; 4xx is not
 * retried (it is a caller-side or content-guard failure).
 */
export interface MeterRetryConfig {
    /** Total additional attempts after the first failure. Default 3. */
    maxRetries?: number;
    /** First backoff delay in ms. Default 200. */
    baseDelayMs?: number;
    /** Upper bound on any single backoff delay. Default 5000. */
    maxDelayMs?: number;
}

/** Row returned by listEvents / getEvent. */
export interface MeterEvent {
    id: string;
    request_id: string;
    event_time: string;
    source: string;
    owner_type: AttributionScope | null;
    owner_id: string | null;
    department_id: string | null;
    employee_id: string | null;
    customer_id: string | null;
    project_id: string | null;
    feature_id: string | null;
    workflow_id: string | null;
    task_type: string | null;
    action_type: string | null;
    provider: string | null;
    model_used: string | null;
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cost_usd: string;
    latency_ms: number | null;
    cache_hit: boolean;
    status_code: number | null;
    success: boolean | null;
    governance_decision: string | null;
    output_status: string | null;
    privacy_mode: PrivacyMode;
    prompt_stored: boolean;
    response_stored: boolean;
    redaction_applied: boolean;
    retention_expires_at: string | null;
    evidence_bundle_id: string | null;
    receipt_id: string | null;
    metadata: Record<string, unknown>;
}

export interface ListMeterEventsParams {
    privacy_mode?: PrivacyMode;
    department_id?: string;
    employee_id?: string;
    customer_id?: string;
    feature_id?: string;
    workflow_id?: string;
    provider?: string;
    model_used?: string;
    action_type?: string;
    evidence_status?: 'present' | 'missing';
    since?: string | Date;
    until?: string | Date;
    limit?: number;
}

export interface ListMeterEventsResponse {
    ok: true;
    count: number;
    events: MeterEvent[];
}

export interface OutcomeInput {
    request_id: string;
    status: OutcomeStatus;
    quality_score?: number;
    source?: string;
    metadata?: Record<string, unknown>;
}

export interface OutcomeResult {
    ok: true;
    outcome_id: string;
    request_id: string;
    status: OutcomeStatus;
    quality_score: number | null;
    recorded_at: string;
}

// P402Error is owned by ./errors.ts. Keep this file types-only so there is
// exactly one runtime class downstream code can `instanceof` against.
