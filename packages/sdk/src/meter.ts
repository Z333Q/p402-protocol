/**
 * P402 SDK — Meter
 * ================
 * Client for /api/v2/meter/events (single) and /api/v2/meter/events/batch
 * (batch). Path B of V5 §27.5: customer apps that call model providers
 * directly (OpenAI, Anthropic, Gemini, ...) post the economic event back
 * here to participate in Meter / Monitor / Control / Optimize WITHOUT ever
 * exposing prompts, responses, or other content.
 *
 * Hard rule (enforced both here and at the router):
 *   The SDK never sends content-bearing keys (prompt, response, messages,
 *   content, file, document, transcript, chat_history, PHI/PII/secrets,
 *   source_code) to the meter endpoint. We reject client-side before fetch
 *   so the bytes never leave the caller's process. Applied to every event
 *   individually, including inside a batch.
 *
 * OPT2-P0 additions:
 *   - `recordEventsBatch(events)` calls the batch endpoint directly.
 *   - Optional buffered mode: pass `batch: { maxEvents, maxLatencyMs }`
 *     to the constructor and use `enqueueEvent(event)` / `flush()`. When
 *     no `batch` config is provided the client behaves as before.
 *   - Retry with exponential backoff (jittered) around every HTTP call,
 *     for network errors and 5xx only. Event `request_id`s are preserved
 *     verbatim across retries so the router's (tenant_id, request_id)
 *     UPSERT guarantees single-row semantics under duplicate sends.
 */

import {
    METER_FORBIDDEN_CONTENT_KEYS,
    type MeterEventInput,
    type MeterEventResult,
    type MeterEventWriteResult,
    type MeterEventDeferredResult,
    type MeterEvent,
    type MeterBatchConfig,
    type MeterBatchResult,
    type MeterRetryConfig,
    type ListMeterEventsParams,
    type ListMeterEventsResponse,
} from './types.js';
import { P402Error } from './errors.js';

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface MeterClientDeps {
    routerUrl: string;
    headers: () => Record<string, string>;
    log: (msg: string, data?: unknown) => void;
    fetcher?: Fetcher;
    batch?: MeterBatchConfig;
    retry?: MeterRetryConfig;
    /**
     * Deterministic sleep for tests. Production leaves this undefined and
     * uses setTimeout. Tests inject a fake so backoff assertions do not
     * depend on real wall time.
     */
    sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRY: Required<MeterRetryConfig> = {
    maxRetries: 3,
    baseDelayMs: 200,
    maxDelayMs: 5000,
};

const DEFAULT_BATCH_MAX_EVENTS = 100;
const DEFAULT_BATCH_MAX_LATENCY_MS = 1000;

function toIso(v: string | Date | undefined): string | undefined {
    if (v === undefined) return undefined;
    return v instanceof Date ? v.toISOString() : v;
}

/**
 * Scan an arbitrary object for forbidden content keys. Top-level only by
 * design — the router accepts `metadata` as JSONB, and content nested
 * under `metadata` is the tenant's choice (their privacy_mode still
 * governs storage). This guard catches the easy mistake: a caller passing
 * { request_id, prompt: '...' } directly.
 */
export function scanForForbiddenContent(body: Record<string, unknown>): string | null {
    for (const k of METER_FORBIDDEN_CONTENT_KEYS) {
        if (Object.prototype.hasOwnProperty.call(body, k)) return k;
    }
    return null;
}

function isRetryableStatus(status: number): boolean {
    // Only 5xx server failures are retried automatically. 429 surfaces to
    // the caller as RATE_LIMITED so the caller can back off with its own
    // policy; 4xx is caller error and never retried.
    return status >= 500 && status < 600;
}

export class MeterClient {
    private routerUrl: string;
    private headers: () => Record<string, string>;
    private log: (msg: string, data?: unknown) => void;
    private fetcher: Fetcher;
    private batchConfig: Required<MeterBatchConfig> | null;
    private retryConfig: Required<MeterRetryConfig>;
    private sleep: (ms: number) => Promise<void>;

    // Batching state (only populated when batchConfig !== null).
    private buffer: MeterEventInput[] = [];
    private flushTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingFlush: Promise<MeterBatchResult> | null = null;

    constructor(deps: MeterClientDeps) {
        this.routerUrl = deps.routerUrl;
        this.headers   = deps.headers;
        this.log       = deps.log;
        this.fetcher   = deps.fetcher ?? ((url, init) => fetch(url, init));
        this.sleep     = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        this.retryConfig = { ...DEFAULT_RETRY, ...(deps.retry ?? {}) };
        this.batchConfig = deps.batch
            ? {
                maxEvents:    deps.batch.maxEvents    ?? DEFAULT_BATCH_MAX_EVENTS,
                maxLatencyMs: deps.batch.maxLatencyMs ?? DEFAULT_BATCH_MAX_LATENCY_MS,
              }
            : null;
    }

    /**
     * Record a single economic event synchronously. Returns either a
     * canonical write result (200, event_id present) or a deferred result
     * (202, durability outbox captured the row and the retry worker will
     * replay).
     *
     * Throws P402Error('METER_CONTENT_REJECTED') BEFORE any HTTP request
     * if the input contains a content-bearing top-level key.
     *
     * Ignores the buffered batch mode by design: some callers want the
     * canonical event_id back on the request path. Use `enqueueEvent` when
     * fire-and-forget batching is what you want.
     */
    async recordEvent(input: MeterEventInput): Promise<MeterEventResult> {
        this.guardEvent(input);
        this.log('meter.recordEvent', { request_id: input.request_id });

        const url = `${this.routerUrl}/api/v2/meter/events`;
        const res = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(input),
        });

        // 200 OK   → canonical write, event_id present
        // 202      → deferred to outbox, event_id absent, deferred=true
        if (res.status === 200 || res.status === 202) {
            const body = (await res.json()) as MeterEventResult;
            if (res.status === 202 && (body as MeterEventDeferredResult).deferred !== true) {
                (body as MeterEventDeferredResult).deferred = true;
            }
            return body;
        }

        const errBody = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string; details?: unknown };
        };
        const code = mapHttpToP402Error(res.status, errBody.error?.code);
        throw new P402Error(
            code,
            errBody.error?.message ?? `meter.recordEvent failed: ${res.statusText}`,
            errBody.error,
        );
    }

    /**
     * Record N economic events in a single HTTP request against
     * `/api/v2/meter/events/batch`. Content-key guard runs per event
     * before any network hop. Per-event `request_id`s are preserved
     * across retries; the router's (tenant_id, request_id) UPSERT
     * guarantees idempotency even if the caller (or a proxy) double-sends
     * a batch.
     *
     * Returns the batch result envelope with per-event outcomes. Individual
     * event failures do not throw; they land in `results` with `ok:false`.
     * Only a hard transport/envelope failure throws.
     */
    async recordEventsBatch(events: MeterEventInput[]): Promise<MeterBatchResult> {
        if (!Array.isArray(events) || events.length === 0) {
            throw new P402Error('INVALID_INPUT', 'recordEventsBatch requires a non-empty array of events');
        }
        // Guard every event before we serialize. A single content-bearing
        // event fails the whole batch pre-flight so the bytes never leave
        // the process — same posture as the single-event path.
        for (const ev of events) {
            this.guardEvent(ev);
        }
        this.log('meter.recordEventsBatch', { count: events.length });

        const url = `${this.routerUrl}/api/v2/meter/events/batch`;
        const res = await this.fetchWithRetry(url, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify({ events }),
        });

        if (res.status === 200) {
            return (await res.json()) as MeterBatchResult;
        }

        const errBody = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string; details?: unknown };
        };
        const code = mapHttpToP402Error(res.status, errBody.error?.code);
        throw new P402Error(
            code,
            errBody.error?.message ?? `meter.recordEventsBatch failed: ${res.statusText}`,
            errBody.error,
        );
    }

    /**
     * Buffered enqueue. Only available when the client was constructed
     * with a `batch` config. Adds the event to an internal buffer that
     * flushes when either bound (maxEvents, maxLatencyMs) is reached.
     *
     * Content guard fires here, synchronously, so a bad event fails the
     * caller immediately and never enters the buffer.
     */
    async enqueueEvent(input: MeterEventInput): Promise<void> {
        if (this.batchConfig === null) {
            throw new P402Error(
                'INVALID_INPUT',
                'enqueueEvent requires MeterClient({ batch: ... }) — construct with a batch config',
            );
        }
        this.guardEvent(input);
        this.buffer.push(input);

        if (this.buffer.length >= this.batchConfig.maxEvents) {
            // Fire-and-forget flush; caller uses `await flush()` or the
            // returned promise on the next tick if they want to await.
            void this.flush();
            return;
        }
        if (this.flushTimer === null) {
            this.flushTimer = setTimeout(() => { void this.flush(); }, this.batchConfig.maxLatencyMs);
        }
    }

    /**
     * Force-flush the buffered events. Safe to call at any time; returns
     * null when the buffer is empty. If a flush is already in flight,
     * returns that in-flight promise so concurrent callers coalesce.
     */
    async flush(): Promise<MeterBatchResult | null> {
        if (this.pendingFlush) return this.pendingFlush;

        if (this.flushTimer !== null) {
            clearTimeout(this.flushTimer);
            this.flushTimer = null;
        }
        if (this.buffer.length === 0) return null;

        const events = this.buffer;
        this.buffer = [];
        this.pendingFlush = this.recordEventsBatch(events)
            .finally(() => { this.pendingFlush = null; });
        return this.pendingFlush;
    }

    /**
     * List recent economic events for the current tenant. All filters are
     * optional. since/until accept Date or ISO string. limit is capped at
     * 200 by the router; passing a larger value is silently clamped.
     */
    async listEvents(params: ListMeterEventsParams = {}): Promise<ListMeterEventsResponse> {
        const qs = new URLSearchParams();
        if (params.privacy_mode)    qs.set('privacy_mode',    params.privacy_mode);
        if (params.department_id)   qs.set('department_id',   params.department_id);
        if (params.employee_id)     qs.set('employee_id',     params.employee_id);
        if (params.customer_id)     qs.set('customer_id',     params.customer_id);
        if (params.feature_id)      qs.set('feature_id',      params.feature_id);
        if (params.workflow_id)     qs.set('workflow_id',     params.workflow_id);
        if (params.provider)        qs.set('provider',        params.provider);
        if (params.model_used)      qs.set('model_used',      params.model_used);
        if (params.action_type)     qs.set('action_type',     params.action_type);
        if (params.evidence_status) qs.set('evidence_status', params.evidence_status);
        const since = toIso(params.since); if (since) qs.set('since', since);
        const until = toIso(params.until); if (until) qs.set('until', until);
        if (params.limit !== undefined) qs.set('limit', String(params.limit));

        const url = qs.toString()
            ? `${this.routerUrl}/api/v2/meter/events?${qs.toString()}`
            : `${this.routerUrl}/api/v2/meter/events`;

        const res = await this.fetchWithRetry(url, { headers: this.headers() });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new P402Error('NETWORK_ERROR', `meter.listEvents failed: ${res.statusText}`, err);
        }
        return (await res.json()) as ListMeterEventsResponse;
    }

    /**
     * Fetch the full detail (including the full privacy posture) for a
     * single economic event by its canonical id.
     */
    async getEvent(eventId: string): Promise<MeterEvent> {
        if (!eventId || typeof eventId !== 'string') {
            throw new P402Error('INVALID_INPUT', 'eventId is required');
        }
        const res = await this.fetchWithRetry(
            `${this.routerUrl}/api/v2/meter/events/${encodeURIComponent(eventId)}`,
            { headers: this.headers() },
        );
        if (res.status === 404) {
            throw new P402Error('INVALID_INPUT', `meter event ${eventId} not found`);
        }
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new P402Error('NETWORK_ERROR', `meter.getEvent failed: ${res.statusText}`, err);
        }
        const body = (await res.json()) as { ok: true; event: MeterEvent } | MeterEvent;
        return 'event' in body ? body.event : body;
    }

    // ─────────────────────────────────────────────────────────────────────
    // Internal helpers
    // ─────────────────────────────────────────────────────────────────────

    private guardEvent(input: MeterEventInput): void {
        const offender = scanForForbiddenContent(input as unknown as Record<string, unknown>);
        if (offender) {
            throw new P402Error(
                'METER_CONTENT_REJECTED',
                `Meter endpoint rejects content fields. Remove "${offender}" — P402 meters economics, not content.`,
                { rejected_field: offender, forbidden_fields: [...METER_FORBIDDEN_CONTENT_KEYS] },
            );
        }
        if (!input.request_id || typeof input.request_id !== 'string') {
            throw new P402Error('INVALID_INPUT', 'request_id is required and must be a non-empty string');
        }
    }

    /**
     * Fetch with exponential backoff on network errors and 5xx/429.
     * Delay formula: min(maxDelay, baseDelay * 2^attempt) with full jitter
     * in [0, delay]. The request body is untouched between attempts so
     * each event's `request_id` is preserved verbatim and the router's
     * UPSERT keeps duplicate replays idempotent.
     */
    private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
        const { maxRetries, baseDelayMs, maxDelayMs } = this.retryConfig;
        let lastError: unknown = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const res = await this.fetcher(url, init);
                if (isRetryableStatus(res.status) && attempt < maxRetries) {
                    lastError = new Error(`retryable status ${res.status}`);
                    await this.sleep(this.backoffDelay(attempt, baseDelayMs, maxDelayMs));
                    continue;
                }
                return res;
            } catch (err) {
                lastError = err;
                if (attempt >= maxRetries) break;
                await this.sleep(this.backoffDelay(attempt, baseDelayMs, maxDelayMs));
            }
        }
        throw new P402Error(
            'NETWORK_ERROR',
            `meter fetch failed after ${maxRetries + 1} attempts`,
            lastError instanceof Error ? { message: lastError.message } : { error: lastError },
        );
    }

    private backoffDelay(attempt: number, base: number, cap: number): number {
        const raw = Math.min(cap, base * Math.pow(2, attempt));
        // Full jitter: random in [0, raw]. Prevents synchronized retries.
        return Math.floor(Math.random() * raw);
    }
}

function mapHttpToP402Error(status: number, code?: string): import('./types.js').P402ErrorCode {
    if (status === 401 || status === 403) return 'UNAUTHORIZED';
    if (status === 429) return 'RATE_LIMITED';
    if (status === 400) {
        // The router emits INVALID_INPUT for content-field violations; map
        // those to METER_CONTENT_REJECTED so the SDK-side and server-side
        // rejections present the same error code to callers.
        if (code === 'INVALID_INPUT') return 'METER_CONTENT_REJECTED';
        return 'INVALID_INPUT';
    }
    return 'NETWORK_ERROR';
}

export type { MeterEventResult, MeterEventWriteResult, MeterEventDeferredResult };
