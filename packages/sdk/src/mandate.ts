/**
 * EIP-712 Mandate Helpers
 * ========================
 * Helper functions for creating and verifying EIP-712 typed data mandates.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import type { EIP712Mandate, SignedMandate } from './types';

// =============================================================================
// EIP-712 DOMAIN & TYPES
// =============================================================================

/**
 * P402 Mandate EIP-712 Domain
 */
export const MANDATE_DOMAIN = {
    name: 'P402 Protocol',
    version: '1',
    chainId: 8453, // Base Mainnet
    verifyingContract: '0xd02a02386725d900ed86805bb341dccac08e3ba5' as Address
};

/**
 * EIP-712 Type Definition for Mandates
 */
export const MANDATE_TYPES = {
    Mandate: [
        { name: 'grantor', type: 'string' },
        { name: 'grantee', type: 'string' },
        { name: 'maxAmountUSD', type: 'string' },
        { name: 'allowedActions', type: 'string[]' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' }
    ]
} as const;

/**
 * TypeHash for Mandate struct
 */
export const MANDATE_TYPEHASH = keccak256(
    toBytes("Mandate(string grantor,string grantee,string maxAmountUSD,string[] allowedActions,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate a random nonce for a mandate
 */
export function generateMandateNonce(): Hex {
    const uuid = crypto.randomUUID().replace(/-/g, '');
    return `0x${uuid.padEnd(64, '0')}` as Hex;
}

/**
 * Create a mandate message ready for EIP-712 signing
 */
export function createMandateMessage(params: {
    grantor: string;
    grantee: string;
    maxAmountUSD: string;
    allowedActions: string[];
    validDays?: number;
    nonce?: Hex;
}): EIP712Mandate {
    const now = Math.floor(Date.now() / 1000);
    const validDays = params.validDays || 30;

    return {
        grantor: params.grantor,
        grantee: params.grantee,
        maxAmountUSD: params.maxAmountUSD,
        allowedActions: params.allowedActions,
        validAfter: now,
        validBefore: now + (86400 * validDays),
        nonce: params.nonce || generateMandateNonce()
    };
}

/**
 * Validate mandate structure before submission
 */
export function validateMandate(mandate: EIP712Mandate): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!mandate.grantor) {
        errors.push('Missing grantor');
    }

    if (!mandate.grantee) {
        errors.push('Missing grantee');
    }

    if (!mandate.maxAmountUSD || parseFloat(mandate.maxAmountUSD) <= 0) {
        errors.push('Invalid maxAmountUSD');
    }

    if (!mandate.allowedActions || mandate.allowedActions.length === 0) {
        errors.push('At least one allowed action is required');
    }

    const now = Math.floor(Date.now() / 1000);
    if (mandate.validBefore <= now) {
        errors.push('Mandate has already expired');
    }

    if (mandate.validAfter > mandate.validBefore) {
        errors.push('validAfter must be before validBefore');
    }

    if (!mandate.nonce || mandate.nonce.length !== 66) {
        errors.push('Invalid nonce format (must be bytes32)');
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Check if a mandate is currently valid (not expired)
 */
export function isMandateActive(mandate: EIP712Mandate): boolean {
    const now = Math.floor(Date.now() / 1000);
    return now >= mandate.validAfter && now < mandate.validBefore;
}

/**
 * Get typed data parameters for signing with wagmi/viem
 */
export function getMandateTypedData(mandate: EIP712Mandate) {
    return {
        domain: MANDATE_DOMAIN,
        types: MANDATE_TYPES,
        primaryType: 'Mandate' as const,
        message: mandate
    };
}
