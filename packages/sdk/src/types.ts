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
    error?: P402Error;
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
    | 'BUDGET_EXCEEDED';

export class P402Error extends Error {
    constructor(
        public code: P402ErrorCode,
        message: string,
        public details?: any
    ) {
        super(message);
        this.name = 'P402Error';
    }
}
