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

// ─────────────────────────────────────────────────────────────────────────────
// recordEventsBatch — OPT2-P0
// ─────────────────────────────────────────────────────────────────────────────

describe('meter.recordEventsBatch', () => {
    const okBatchBody = (n: number) => ({
        ok: true,
        accepted: n,
        deferred: 0,
        rejected: 0,
        results: Array.from({ length: n }, (_, i) => ({
            ok: true, deferred: false, request_id: `r${i}`, event_id: `evt_${i}`,
        })),
    });

    it('POSTs to /api/v2/meter/events/batch with an { events } envelope', async () => {
        const { fetcher, calls } = makeFetcher([{ status: 200, body: okBatchBody(2) }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });

        const events: MeterEventInput[] = [
            { request_id: 'r0', usage: { input_tokens: 10 } },
            { request_id: 'r1', usage: { input_tokens: 20 } },
        ];
        const r = await meter.recordEventsBatch(events);

        expect(calls[0]!.url).toBe(`${ROUTER}/api/v2/meter/events/batch`);
        const sent = JSON.parse(String(calls[0]!.init!.body));
        expect(sent).toEqual({ events });
        expect(r.accepted).toBe(2);
    });

    it('rejects the whole batch pre-flight if any event contains a forbidden key', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });

        await expect(meter.recordEventsBatch([
            { request_id: 'r0' },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            { request_id: 'r1', prompt: 'sensitive' } as any,
        ])).rejects.toMatchObject({ code: 'METER_CONTENT_REJECTED' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('rejects an empty batch without calling fetch', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(meter.recordEventsBatch([])).rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('preserves per-event request_id when the router returns mixed results', async () => {
        const { fetcher } = makeFetcher([{
            status: 200,
            body: {
                ok: true, accepted: 1, deferred: 1, rejected: 0,
                results: [
                    { ok: true, deferred: false, request_id: 'r0', event_id: 'evt_0' },
                    { ok: true, deferred: true,  request_id: 'r1', message: 'Economic event accepted for retry' },
                ],
            },
        }]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });

        const r = await meter.recordEventsBatch([
            { request_id: 'r0' }, { request_id: 'r1' },
        ]);
        expect(r.results[0]).toMatchObject({ ok: true, request_id: 'r0' });
        expect(r.results[1]).toMatchObject({ ok: true, deferred: true, request_id: 'r1' });
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Buffered enqueue + flush — OPT2-P0
// ─────────────────────────────────────────────────────────────────────────────

describe('meter buffered mode (enqueueEvent / flush)', () => {
    it('flushes when the buffer reaches maxEvents', async () => {
        const { fetcher, calls } = makeFetcher([{
            status: 200,
            body: { ok: true, accepted: 3, deferred: 0, rejected: 0, results: [] },
        }]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            batch: { maxEvents: 3, maxLatencyMs: 60_000 },
        });

        await meter.enqueueEvent({ request_id: 'r0' });
        await meter.enqueueEvent({ request_id: 'r1' });
        expect(fetcher).not.toHaveBeenCalled();
        await meter.enqueueEvent({ request_id: 'r2' });
        // The final enqueue triggers a fire-and-forget flush; explicitly
        // flush to await it and prove no double-send.
        await meter.flush();

        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(calls[0]!.url).toBe(`${ROUTER}/api/v2/meter/events/batch`);
        const sent = JSON.parse(String(calls[0]!.init!.body));
        expect(sent.events).toHaveLength(3);
        expect(sent.events.map((e: MeterEventInput) => e.request_id)).toEqual(['r0', 'r1', 'r2']);
    });

    it('flush() is a no-op when the buffer is empty', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            batch: { maxEvents: 100, maxLatencyMs: 1000 },
        });
        const r = await meter.flush();
        expect(r).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('guard runs before enqueue; a bad event never enters the buffer', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            batch: { maxEvents: 3, maxLatencyMs: 60_000 },
        });

        await expect(meter.enqueueEvent({
            request_id: 'r0',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            prompt: 'nope',
        } as any)).rejects.toMatchObject({ code: 'METER_CONTENT_REJECTED' });

        // Buffer was not populated; explicit flush produces no HTTP call.
        const r = await meter.flush();
        expect(r).toBeNull();
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('enqueueEvent without a batch config is an INVALID_INPUT error', async () => {
        const { fetcher } = makeFetcher([]);
        const meter = new MeterClient({ routerUrl: ROUTER, headers, log, fetcher });
        await expect(meter.enqueueEvent({ request_id: 'r0' }))
            .rejects.toMatchObject({ code: 'INVALID_INPUT' });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it('flushes on the latency timer even below maxEvents', async () => {
        vi.useFakeTimers();
        try {
            const { fetcher, calls } = makeFetcher([{
                status: 200,
                body: { ok: true, accepted: 1, deferred: 0, rejected: 0, results: [] },
            }]);
            const meter = new MeterClient({
                routerUrl: ROUTER, headers, log, fetcher,
                batch: { maxEvents: 100, maxLatencyMs: 500 },
            });
            await meter.enqueueEvent({ request_id: 'r0' });
            expect(fetcher).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(500);
            // The timer fires flush() as fire-and-forget; await any pending
            // flush to observe the fetch call.
            await meter.flush();
            expect(fetcher).toHaveBeenCalledTimes(1);
            expect(JSON.parse(String(calls[0]!.init!.body)).events).toHaveLength(1);
        } finally {
            vi.useRealTimers();
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Retry / exponential backoff — OPT2-P0
// ─────────────────────────────────────────────────────────────────────────────

describe('meter retry policy', () => {
    // Zero-delay sleep so backoff waits don't slow tests down; jitter values
    // are still exercised through backoffDelay() internally.
    const noSleep = () => Promise.resolve();

    it('retries a 500 up to maxRetries with preserved request_id, then succeeds', async () => {
        const okBody = {
            ok: true, event_id: 'evt_final', request_id: 'r0',
            privacy: {
                mode: 'metadata_only', source: 'tenant_default',
                prompt_stored: false, response_stored: false,
                redaction_applied: false, retention_expires_at: '2026-07-04T00:00:00Z',
            },
        };
        const { fetcher, calls } = makeFetcher([
            { status: 500, body: { error: { message: 'boom' } } },
            { status: 500, body: { error: { message: 'boom' } } },
            { status: 200, body: okBody },
        ]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
            sleep: noSleep,
        });
        const r = await meter.recordEvent({ request_id: 'r0' });

        expect(fetcher).toHaveBeenCalledTimes(3);
        // Every attempt sent the exact same body — request_id preserved.
        const bodies = calls.map(c => JSON.parse(String(c.init!.body)).request_id);
        expect(bodies).toEqual(['r0', 'r0', 'r0']);
        expect((r as { event_id: string }).event_id).toBe('evt_final');
    });

    it('gives up after maxRetries + 1 attempts on persistent 5xx and throws NETWORK_ERROR', async () => {
        const { fetcher } = makeFetcher([
            { status: 503, body: {} },
            { status: 503, body: {} },
            { status: 503, body: {} },
        ]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
            sleep: noSleep,
        });
        // The final attempt returns 503; recordEvent maps that through
        // mapHttpToP402Error which produces NETWORK_ERROR for non-4xx.
        await expect(meter.recordEvent({ request_id: 'r0' }))
            .rejects.toMatchObject({ code: 'NETWORK_ERROR' });
        expect(fetcher).toHaveBeenCalledTimes(3);
    });

    it('does NOT retry on 400 or 429', async () => {
        const { fetcher } = makeFetcher([
            { status: 400, body: { error: { code: 'INVALID_INPUT', message: 'bad' } } },
        ]);
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
            sleep: noSleep,
        });
        await expect(meter.recordEvent({ request_id: 'r0' })).rejects.toBeInstanceOf(P402Error);
        expect(fetcher).toHaveBeenCalledTimes(1);

        const { fetcher: f2 } = makeFetcher([{ status: 429, body: { error: { message: 'slow down' } } }]);
        const m2 = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher: f2,
            retry: { maxRetries: 3, baseDelayMs: 1, maxDelayMs: 2 },
            sleep: noSleep,
        });
        await expect(m2.recordEvent({ request_id: 'r0' })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
        expect(f2).toHaveBeenCalledTimes(1);
    });

    it('retries on a thrown network error, preserving the batch payload', async () => {
        const events: MeterEventInput[] = [
            { request_id: 'r0' }, { request_id: 'r1' }, { request_id: 'r2' },
        ];
        const okBatchBody = {
            ok: true, accepted: 3, deferred: 0, rejected: 0,
            results: events.map((e) => ({ ok: true, deferred: false, request_id: e.request_id, event_id: `evt_${e.request_id}` })),
        };

        let call = 0;
        const captured: string[] = [];
        const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
            captured.push(String(init!.body));
            call++;
            if (call === 1) throw new Error('ECONNRESET');
            return {
                ok: true, status: 200, statusText: 'OK',
                json: async () => okBatchBody,
            } as Response;
        });
        const meter = new MeterClient({
            routerUrl: ROUTER, headers, log, fetcher,
            retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 2 },
            sleep: noSleep,
        });
        const r = await meter.recordEventsBatch(events);
        expect(fetcher).toHaveBeenCalledTimes(2);
        // Both attempts serialized the same body; per-event request_ids
        // preserved verbatim across the retry.
        expect(captured[0]).toBe(captured[1]);
        const requestIds = JSON.parse(captured[0]!).events.map((e: MeterEventInput) => e.request_id);
        expect(requestIds).toEqual(['r0', 'r1', 'r2']);
        expect(r.accepted).toBe(3);
    });
});
