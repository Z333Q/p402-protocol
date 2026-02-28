import { createPublicClient, http, encodeFunctionData, parseUnits, Hash, Address, Hex } from 'viem';
import { base } from 'viem/chains';

// Re-export all types
export * from './types';
export * from './mandate';
export type { Address, Hash, Hex } from 'viem';

import type {
    P402Config,
    P402ErrorCode,
    Network,
    TokenConfig,
    PaymentRequest,
    PaymentResult,
    PlanRequest,
    PlanResponse,
    SettleRequest,
    SettleResponse,
    ChatCompletionRequest,
    ChatCompletionResponse,
    Session,
    Policy,
    Mandate,
    EIP3009Authorization,
    EIP712Mandate,
    SignedMandate
} from './types';

// =============================================================================
// ERROR CLASS
// =============================================================================

export class P402Error extends Error {
    constructor(
        public code: P402ErrorCode,
        message: string,
        public details?: unknown
    ) {
        super(message);
        this.name = 'P402Error';
    }
}

// =============================================================================
// PRESET TOKENS
// =============================================================================

export const PRESET_TOKENS: Record<string, Record<Network, TokenConfig>> = {
    USDC: {
        'eip155:8453': {
            address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            decimals: 6,
            symbol: 'USDC',
            eip712: { name: 'USD Coin', version: '2' }
        },
        'eip155:84532': {
            address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
            decimals: 6,
            symbol: 'USDC',
            eip712: { name: 'USD Coin', version: '2' }
        },
        'eip155:1': {
            address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            decimals: 6,
            symbol: 'USDC',
            eip712: { name: 'USD Coin', version: '2' }
        }
    }
};

const ERC20_ABI = [
    {
        name: 'transfer',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }],
        outputs: [{ type: 'bool' }]
    }
] as const;

// =============================================================================
// P402 CLIENT
// =============================================================================

export class P402Client {
    private routerUrl: string;
    private debug: boolean;
    private apiKey?: string;
    private defaultNetwork: Network;

    constructor(config: P402Config = {}) {
        this.routerUrl = (config.routerUrl || 'https://p402.io').replace(/\/$/, '');
        this.debug = config.debug || false;
        this.apiKey = config.apiKey;
        this.defaultNetwork = config.network || 'eip155:8453';
    }

    private log(msg: string, data?: unknown) {
        if (this.debug) {
            console.log(`[P402 SDK] ${msg}`, data || '');
        }
    }

    private headers(): Record<string, string> {
        const h: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.apiKey) h['Authorization'] = `Bearer ${this.apiKey}`;
        return h;
    }

    // =========================================================================
    // V1 API - PLAN & SETTLE
    // =========================================================================

    /**
     * Request a payment plan from the router.
     * This negotiates with the policy engine and returns available facilitators.
     */
    async plan(request: PlanRequest): Promise<PlanResponse> {
        this.log('Requesting plan', request);

        const res = await fetch(`${this.routerUrl}/api/v1/router/plan`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(request)
        });

        if (!res.ok) {
            throw new P402Error('NETWORK_ERROR', `Plan request failed: ${res.statusText}`);
        }

        return res.json() as Promise<PlanResponse>;
    }

    /**
     * Settle a payment after the transaction has been executed.
     * Supports both txHash (on-chain) and EIP-3009 authorization (gasless).
     */
    async settle(request: SettleRequest): Promise<SettleResponse> {
        this.log('Settling payment', request);

        const res = await fetch(`${this.routerUrl}/api/v1/facilitator/settle`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(request)
        });

        const data = await res.json() as SettleResponse;

        if (!data.success) {
            throw new P402Error('SETTLEMENT_FAILED', data.errorReason || 'Settlement failed', data.error);
        }

        return data;
    }

    /**
     * Complete checkout flow: Plan → Pay (Externally) → Settle
     */
    async checkout(
        request: PaymentRequest,
        signerCallback: (to: string, data: string, value: bigint) => Promise<string>
    ): Promise<PaymentResult> {
        try {
            this.log('Starting checkout', request);

            const network = request.network || this.defaultNetwork;
            if (Number(request.amount) <= 0) {
                throw new P402Error('INVALID_INPUT', 'Amount must be greater than 0');
            }

            const usdc = PRESET_TOKENS.USDC;
            const token = request.token || (usdc ? usdc[network] : undefined);

            if (!token || !token.eip712) {
                throw new P402Error('INVALID_INPUT', 'Token configuration missing or invalid');
            }

            // 1. PLAN
            const plan = await this.plan({
                payment: {
                    amount: request.amount,
                    asset: token.symbol,
                    network: network
                }
            });

            if (!plan.allow) {
                throw new P402Error('POLICY_DENIED', 'Router policy denied the transaction', plan.policy?.reasons);
            }

            const candidate = plan.candidates?.[0];
            const treasury = candidate?.payment?.treasuryAddress;
            if (!treasury) {
                throw new P402Error('NETWORK_ERROR', 'No valid facilitator or treasury address found');
            }

            // 2. CONSTRUCT & SIGN
            const weiAmount = parseUnits(request.amount, token.decimals);
            const encodedData = encodeFunctionData({
                abi: ERC20_ABI,
                functionName: 'transfer',
                args: [treasury as `0x${string}`, weiAmount]
            });

            // 3. EXECUTE
            this.log('Requesting signature...');
            const txHash = await signerCallback(token.address, encodedData, BigInt(0));
            this.log('Transaction sent', txHash);

            // 4. SETTLE
            const settleData = await this.settle({
                txHash: txHash as Hash,
                amount: request.amount,
                asset: token.symbol
            });

            this.log('Checkout complete!');
            return { success: true, txHash: txHash as Hash, receipt: settleData.receipt };

        } catch (e: unknown) {
            this.log('Checkout failed', e);
            const error = e instanceof P402Error ? e : new P402Error('TRANSACTION_FAILED', (e as Error).message);
            return { success: false, error };
        }
    }

    // =========================================================================
    // V2 API - CHAT COMPLETIONS
    // =========================================================================

    /**
     * Send a chat completion request through P402's multi-provider router.
     * Automatically selects the best provider based on mode.
     */
    async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
        this.log('Chat completion request', request);

        const res = await fetch(`${this.routerUrl}/api/v2/chat/completions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(request)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { message?: string };
            throw new P402Error('NETWORK_ERROR', `Chat request failed: ${res.statusText}`, error);
        }

        return res.json() as Promise<ChatCompletionResponse>;
    }

    // =========================================================================
    // V2 API - SESSIONS
    // =========================================================================

    /**
     * Create a new agent session with a pre-funded budget.
     */
    async createSession(params: {
        agent_id?: string;
        wallet_address?: string;
        budget_usd: number;
        expires_in_hours?: number;
        policy?: Record<string, unknown>;
    }): Promise<Session> {
        const res = await fetch(`${this.routerUrl}/api/v2/sessions`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(params)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { message?: string };
            throw new P402Error('NETWORK_ERROR', 'Failed to create session', error);
        }

        return res.json() as Promise<Session>;
    }

    /**
     * Get session details by ID.
     */
    async getSession(sessionId: string): Promise<Session> {
        const res = await fetch(`${this.routerUrl}/api/v2/sessions/${sessionId}`, {
            headers: this.headers()
        });

        if (!res.ok) {
            throw new P402Error('NETWORK_ERROR', `Session ${sessionId} not found`);
        }

        return res.json() as Promise<Session>;
    }

    /**
     * Fund an existing session with additional budget.
     */
    async fundSession(sessionId: string, amount: number, txHash?: string): Promise<Session> {
        const res = await fetch(`${this.routerUrl}/api/v2/sessions/fund`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({
                session_id: sessionId,
                amount,
                tx_hash: txHash
            })
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { message?: string };
            throw new P402Error('NETWORK_ERROR', 'Failed to fund session', error);
        }

        const data = await res.json() as { session: Session };
        return data.session;
    }

    // =========================================================================
    // V2 API - GOVERNANCE
    // =========================================================================

    /**
     * List all policies for the current tenant.
     */
    async listPolicies(): Promise<{ data: Policy[] }> {
        const res = await fetch(`${this.routerUrl}/api/v2/governance/policies`, {
            headers: this.headers()
        });

        if (!res.ok) {
            throw new P402Error('NETWORK_ERROR', 'Failed to list policies');
        }

        return res.json() as Promise<{ data: Policy[] }>;
    }

    /**
     * Create a new governance policy.
     */
    async createPolicy(params: {
        name: string;
        rules: Record<string, unknown>;
        version?: string;
    }): Promise<Policy> {
        const res = await fetch(`${this.routerUrl}/api/v2/governance/policies`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(params)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { message?: string };
            throw new P402Error('NETWORK_ERROR', 'Failed to create policy', error);
        }

        return res.json() as Promise<Policy>;
    }

    /**
     * List all AP2 mandates for the current tenant.
     */
    async listMandates(status?: 'active' | 'exhausted' | 'revoked'): Promise<{ data: Mandate[] }> {
        const url = status
            ? `${this.routerUrl}/api/v2/governance/mandates?status=${status}`
            : `${this.routerUrl}/api/v2/governance/mandates`;

        const res = await fetch(url, { headers: this.headers() });

        if (!res.ok) {
            throw new P402Error('NETWORK_ERROR', 'Failed to list mandates');
        }

        return res.json() as Promise<{ data: Mandate[] }>;
    }

    /**
     * Create a new AP2 mandate (requires EIP-712 signature from user).
     */
    async createMandate(params: {
        user_did: string;
        agent_did: string;
        constraints: {
            max_amount_usd?: number;
            allowed_actions?: string[];
            expires_at?: string;
        };
        signature?: string;
        public_key?: string;
    }): Promise<Mandate> {
        const res = await fetch(`${this.routerUrl}/api/v2/governance/mandates`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(params)
        });

        if (!res.ok) {
            const error = await res.json().catch(() => ({})) as { message?: string };
            throw new P402Error('NETWORK_ERROR', 'Failed to create mandate', error);
        }

        return res.json() as Promise<Mandate>;
    }

    // =========================================================================
    // UTILITY METHODS
    // =========================================================================

    /**
     * Check if the router is healthy.
     */
    async health(): Promise<boolean> {
        try {
            const res = await fetch(`${this.routerUrl}/api/health`);
            return res.ok;
        } catch {
            return false;
        }
    }

    /**
     * Get supported facilitator capabilities.
     */
    async getSupported(): Promise<{
        kinds: Array<{ x402Version: number; scheme: string; network: string }>;
        extensions: string[];
        networks: string[];
        assets: string[];
    }> {
        const res = await fetch(`${this.routerUrl}/api/v1/facilitator/supported`);
        if (!res.ok) {
            throw new P402Error('NETWORK_ERROR', 'Failed to get supported capabilities');
        }
        return res.json() as Promise<{
            kinds: Array<{ x402Version: number; scheme: string; network: string }>;
            extensions: string[];
            networks: string[];
            assets: string[];
        }>;
    }
}

// Default export
export default P402Client;
