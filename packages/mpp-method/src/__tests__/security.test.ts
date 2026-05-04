import { describe, it, expect } from 'vitest';
import { resolveAmount } from '../amount.js';

describe('resolveAmount — input validation', () => {
    describe('amountRaw', () => {
        it('accepts a valid non-negative integer string', () => {
            expect(resolveAmount({ amountRaw: '1000' })).toBe(1000n);
        });

        it('accepts "0"', () => {
            expect(resolveAmount({ amountRaw: '0' })).toBe(0n);
        });

        it('rejects negative string', () => {
            expect(() => resolveAmount({ amountRaw: '-1' })).toThrow('non-negative integer');
        });

        it('rejects hex string', () => {
            expect(() => resolveAmount({ amountRaw: '0x1234' })).toThrow('non-negative integer');
        });

        it('rejects scientific notation', () => {
            expect(() => resolveAmount({ amountRaw: '1e6' })).toThrow('non-negative integer');
        });

        it('rejects decimal string', () => {
            expect(() => resolveAmount({ amountRaw: '0.001' })).toThrow('non-negative integer');
        });

        it('rejects arbitrary text', () => {
            expect(() => resolveAmount({ amountRaw: 'abc' })).toThrow('non-negative integer');
        });

        it('rejects leading zeros (not "0")', () => {
            expect(() => resolveAmount({ amountRaw: '01' })).toThrow('non-negative integer');
        });
    });

    describe('amount', () => {
        it('accepts a valid decimal string', () => {
            expect(resolveAmount({ amount: '0.001' })).toBe(1000n);
        });

        it('accepts an integer string', () => {
            expect(resolveAmount({ amount: '1' })).toBe(1_000_000n);
        });

        it('rejects negative decimal', () => {
            expect(() => resolveAmount({ amount: '-0.001' })).toThrow('non-negative decimal');
        });

        it('rejects scientific notation', () => {
            expect(() => resolveAmount({ amount: '1e6' })).toThrow('non-negative decimal');
        });

        it('rejects hex string', () => {
            expect(() => resolveAmount({ amount: '0x1234' })).toThrow('non-negative decimal');
        });

        it('rejects arbitrary text', () => {
            expect(() => resolveAmount({ amount: 'abc' })).toThrow('non-negative decimal');
        });

        it('rejects empty string', () => {
            expect(() => resolveAmount({ amount: '' })).toThrow('non-negative decimal');
        });
    });

    it('throws when neither amount nor amountRaw is provided', () => {
        expect(() => resolveAmount({})).toThrow('either amount or amountRaw is required');
    });

    it('amountRaw takes precedence over amount', () => {
        expect(resolveAmount({ amount: '1', amountRaw: '500' })).toBe(500n);
    });
});
