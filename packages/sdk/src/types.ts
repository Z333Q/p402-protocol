/**
 * P402 SDK - Types
 * =================
 * Shared TypeScript definitions for the P402 SDK.
 */

import type { Address, Hash, Hex } from 'viem';

// =============================================================================
// NETWORK TYPES
// =============================================================================

export type Network = 'eip155:8453' | 'eip155:84532' | 'eip155:1';

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
    p402_metadata: {
        provider: string;
        model: string;
        cost_usd: number;
        cached: boolean;
        latency_ms: number;
    };
}

/**
 * V2 Session
 */
export interface Session {
    id: string;
    tenant_id: string;
    agent_id?: string;
    wallet_address?: string;
    budget: {
        total_usd: number;
        used_usd: number;
        remaining_usd: number;
    };
    policy?: Record<string, any>;
    status: 'active' | 'ended' | 'expired';
    created_at: string;
    expires_at: string;
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

export interface P402Config {
    /** Base URL for P402 router (default: https://p402.io) */
    routerUrl?: string;
    /** Enable debug logging */
    debug?: boolean;
    /** API key for authenticated requests */
    apiKey?: string;
    /** Default network */
    network?: Network;
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
