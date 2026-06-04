/**
 * SDK privacy contract for p402.meter.recordEvent.
 *
 * Hard rules pinned here:
 *   1. recordEvent NEVER sends content-bearing top-level keys. The SDK
 *      throws METER_CONTENT_REJECTED BEFORE any HTTP request — proven by
 *      asserting fetch was not called.
 *   2. recordEvent handles both the 200 canonical write and the 202
 *      deferred-outbox response shape.
 *   3. listEvents builds the query string with the documented filter set.
 *   4. outcomes.record validates status client-side.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MeterClient, scanForForbiddenContent } from './meter.js';
import { OutcomesClient } from './outcomes.js';
import { P402Error } from './errors.js';
import { METER_FORBIDDEN_CONTENT_KEYS, type MeterEventInput } from './types.js';

const ROUTER = 'https://router.test';
const headers = () => ({ 'Content-Type': 'application/json' });
const log = () => undefined;

interface FetchCall { url: string; init?: RequestInit }

function makeFetcher(responses: Array<{ status: number; body: unknown }>) {
    const calls: FetchCall[] = [];
    let idx = 0;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const r = responses[idx++];
        if (!r) throw new Error(`fetcher: no response queued for call ${idx}`);
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            statusText: `HTTP ${r.status}`,
            json: async () => r.body,
        } as Response;
    });
    return { fetcher, calls };
}

beforeEach(() => vi.clearAllMocks());

// ─────────────────────────────────────────────────────────────────────────────
// scanForForbiddenContent
// ─────────────────────────────────────────────────────────────────────────────

describe('scanForForbiddenContent', () => {
    it('flags each forbidden key', () => {
        for (const k of METER_FORBIDDEN_CONTENT_KEYS) {
            expect(scanForForbiddenContent({ [k]: 'anything' })).toBe(k);
        }
    });

    it('returns null for an event with only allowed top-level keys', () => {
        expect(scanForForbiddenContent({
            request_id: 'r1',
            attribution: { department_id: 'claims' },
            model: { provider: 'openai' },
            usage: { input_tokens: 10 },
            metadata: { run_id: 'x' },
        })).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordEvent — content guard
// ─────────────────────────────────────────────────────────────────────────────

describe('meter.recordEvent — content rejection (client-side)', () => {
    it('rejects "prompt" BEFORE any network request', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });

        await expect(meter.recordEvent({
            request_id: 'r1',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prompt: 'sensitive PHI',
        } as any)).rejects.toBeInstanceOf(P402Error);

        try {
            await meter.recordEvent({
                request_id: 'r1',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                prompt: 'sensitive PHI',
            } as any);
        } catch (e) {
            expect((e as P402Error).code).toBe('METER_CONTENT_REJECTED');
            expect((e as P402Error).message).toContain('prompt');
        }
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('rejects every key in METER_FORBIDDEN_CONTENT_KEYS, never calls fetch', async () => {
        for (const k of METER_FORBIDDEN_CONTENT_KEYS) {
            const { fetcher } = makeFetcher([]);
            const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
            await expect(meter.recordEvent({
                request_id: 'r1',
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                [k]: 'x',
            } as any)).rejects.toMatchObject({
                name: 'P402Error',
                code: 'METER_CONTENT_REJECTED',
            });
            expect(fetcher).not.toHaveBeenCalled();
        }
    });

    it('rejects when request_id is missing', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await expect(meter.recordEvent({} as any)).rejects.toMatchObject({
            code: 'INVALID_INPUT',
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('serialized body NEVER contains a forbidden top-level key (happy path)', async () => {
        const { fetcher, calls } = makeFetcher([{
            status: 200,
            body: {
                ok: true, event_id: 'evt_1', request_id: 'r1',
                privacy: { mode: 'metadata_only', source: 'tenant_default',
                           prompt_stored: false, response_stored: false,
                           redaction_applied: false, retention_expires_at: '2026-07-04T00:00:00Z' },
            },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });

        const input: MeterEventInput = {
            request_id: 'r1',
            attribution: { department_id: 'claims', employee_id: 'emp_42' },
            model: { provider: 'openai', model_used: 'gpt-4o-mini' },
            usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.0021 },
            metadata: { run_id: 'r_1' },
        };
        await meter.recordEvent(input);

        const sent = JSON.parse(String(calls[0]!.init!.body));
        for (const k of METER_FORBIDDEN_CONTENT_KEYS) {
            expect(sent).not.toHaveProperty(k);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// recordEvent — response shape handling
// ─────────────────────────────────────────────────────────────────────────────

describe('meter.recordEvent — response handling', () => {
    it('200 canonical: returns event_id, deferred undefined/false', async () => {
        const { fetcher } = makeFetcher([{
            status: 200,
            body: {
                ok: true,
                event_id: 'evt_canonical',
                request_id: 'r1',
                privacy: {
                    mode: 'metadata_only', source: 'tenant_default',
                    prompt_stored: false, response_stored: false,
                    redaction_applied: false,
                    retention_expires_at: '2026-07-04T00:00:00Z',
                },
            },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        const r = await meter.recordEvent({ request_id: 'r1' });

        expect(r.ok).toBe(true);
        expect(r.deferred).toBeFalsy();
        // Type-narrow: 200 path always has event_id
        if (!r.deferred) {
            expect(r.event_id).toBe('evt_canonical');
        }
    });

    it('202 deferred: returns deferred=true, no event_id, privacy posture present', async () => {
        const { fetcher } = makeFetcher([{
            status: 202,
            body: {
                ok: true,
                deferred: true,
                request_id: 'r_deferred',
                message: 'Economic event accepted for retry',
                privacy: {
                    mode: 'metadata_only', source: 'tenant_default',
                    prompt_stored: false, response_stored: false,
                    redaction_applied: false,
                    retention_expires_at: '2026-07-04T00:00:00Z',
                },
            },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        const r = await meter.recordEvent({ request_id: 'r_deferred' });

        expect(r.ok).toBe(true);
        expect(r.deferred).toBe(true);
        if (r.deferred) {
            expect(r.request_id).toBe('r_deferred');
            expect(r.privacy.prompt_stored).toBe(false);
            expect(r.privacy.response_stored).toBe(false);
            expect(r.message).toContain('retry');
            expect('event_id' in r).toBe(false);
        }
    });

    it('400 with server INVALID_INPUT maps to METER_CONTENT_REJECTED (defense in depth)', async () => {
        const { fetcher } = makeFetcher([{
            status: 400,
            body: { error: { code: 'INVALID_INPUT', message: 'server rejected content' } },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        // We have to pass a body that bypasses the SDK guard — use a normal
        // request_id; server-side 400 is the path we're testing here.
        await expect(meter.recordEvent({ request_id: 'r' })).rejects.toMatchObject({
            code: 'METER_CONTENT_REJECTED',
        });
    });

    it('429 maps to RATE_LIMITED', async () => {
        const { fetcher } = makeFetcher([{
            status: 429, body: { error: { message: 'too many' } },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(meter.recordEvent({ request_id: 'r' })).rejects.toMatchObject({
            code: 'RATE_LIMITED',
        });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// listEvents
// ─────────────────────────────────────────────────────────────────────────────

describe('meter.listEvents', () => {
    it('builds query string with the documented filter set', async () => {
        const { fetcher, calls } = makeFetcher([{
            status: 200,
            body: { ok: true, count: 0, events: [] },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await meter.listEvents({
            privacy_mode: 'metadata_only',
            department_id: 'claims',
            employee_id:   'emp_42',
            customer_id:   'cust_7',
            feature_id:    'summary',
            workflow_id:   'wf_1',
            provider:      'openai',
            model_used:    'gpt-4o-mini',
            action_type:   'claims_summary',
            evidence_status: 'present',
            since: new Date('2026-06-01T00:00:00Z'),
            until: '2026-06-04T00:00:00Z',
            limit: 50,
        });
        const url = new URL(calls[0]!.url);
        expect(url.pathname).toBe('/api/v2/meter/events');
        expect(url.searchParams.get('privacy_mode')).toBe('metadata_only');
        expect(url.searchParams.get('department_id')).toBe('claims');
        expect(url.searchParams.get('employee_id')).toBe('emp_42');
        expect(url.searchParams.get('customer_id')).toBe('cust_7');
        expect(url.searchParams.get('feature_id')).toBe('summary');
        expect(url.searchParams.get('workflow_id')).toBe('wf_1');
        expect(url.searchParams.get('provider')).toBe('openai');
        expect(url.searchParams.get('model_used')).toBe('gpt-4o-mini');
        expect(url.searchParams.get('action_type')).toBe('claims_summary');
        expect(url.searchParams.get('evidence_status')).toBe('present');
        expect(url.searchParams.get('since')).toBe('2026-06-01T00:00:00.000Z');
        expect(url.searchParams.get('until')).toBe('2026-06-04T00:00:00Z');
        expect(url.searchParams.get('limit')).toBe('50');
    });

    it('omits unset filters', async () => {
        const { fetcher, calls } = makeFetcher([{
            status: 200, body: { ok: true, count: 0, events: [] },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await meter.listEvents();
        expect(calls[0]!.url).toBe(`${ROUTER}/api/v2/meter/events`);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getEvent
// ─────────────────────────────────────────────────────────────────────────────

describe('meter.getEvent', () => {
    it('returns the event and exposes full privacy posture', async () => {
        const { fetcher } = makeFetcher([{
            status: 200,
            body: {
                ok: true,
                event: {
                    id: 'evt_1', request_id: 'r1',
                    privacy_mode: 'metadata_only',
                    prompt_stored: false, response_stored: false,
                    redaction_applied: false,
                    retention_expires_at: '2026-07-04T00:00:00Z',
                },
            },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        const ev = await meter.getEvent('evt_1');
        expect(ev.id).toBe('evt_1');
        expect(ev.privacy_mode).toBe('metadata_only');
        expect(ev.prompt_stored).toBe(false);
    });

    it('rejects empty id without calling fetch', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(meter.getEvent('')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(fetcher).not.toHaveBeenCalled();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// outcomes.record
// ─────────────────────────────────────────────────────────────────────────────

describe('outcomes.record', () => {
    it('happy path returns outcome_id + recorded_at', async () => {
        const { fetcher } = makeFetcher([{
            status: 200,
            body: {
                ok: true, outcome_id: 'oc_1', request_id: 'r1',
                status: 'accepted', quality_score: 0.92,
                recorded_at: '2026-06-04T18:30:00Z',
            },
        }]);
        const outcomes = new OutcomesClient({ routerUrl: ROUTER, headers, log, fetcher });
        const r = await outcomes.record({
            request_id: 'r1', status: 'accepted', quality_score: 0.92,
        });
        expect(r.outcome_id).toBe('oc_1');
        expect(r.status).toBe('accepted');
    });

    it('rejects invalid status BEFORE network call', async () => {
        const { fetcher } = makeFetcher([]);
        const outcomes = new OutcomesClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(outcomes.record({
            request_id: 'r1',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            status: 'galaxy_brain' as any,
        })).rejects.toMatchObject({ code: 'OUTCOME_INVALID_STATUS' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('rejects out-of-range quality_score', async () => {
        const { fetcher } = makeFetcher([]);
        const outcomes = new OutcomesClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(outcomes.record({
            request_id: 'r1', status: 'accepted', quality_score: 1.5,
        })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(fetcher).not.toHaveBeenCalled();
    });
});
