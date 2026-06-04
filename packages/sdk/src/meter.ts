/**
 * P402 SDK — Meter
 * ================
 * Client for /api/v2/meter/events. Path B of V5 §27.5: customer apps that
 * call model providers directly (OpenAI, Anthropic, Gemini, ...) post the
 * economic event back here to participate in Meter / Monitor / Control /
 * Optimize WITHOUT ever exposing prompts, responses, or other content.
 *
 * Hard rule (enforced both here and at the router):
 *   The SDK never sends content-bearing keys (prompt, response, messages,
 *   content, file, document, transcript, chat_history, PHI/PII/secrets,
 *   source_code) to the meter endpoint. We reject client-side before fetch
 *   so the bytes never leave the caller's process.
 */

import {
    METER_FORBIDDEN_CONTENT_KEYS,
    type MeterEventInput,
    type MeterEventResult,
    type MeterEventWriteResult,
    type MeterEventDeferredResult,
    type MeterEvent,
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
}

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

export class MeterClient {
    private routerUrl: string;
    private headers: () => Record<string, string>;
    private log: (msg: string, data?: unknown) => void;
    private fetcher: Fetcher;

    constructor(deps: MeterClientDeps) {
        this.routerUrl = deps.routerUrl;
        this.headers   = deps.headers;
        this.log       = deps.log;
        this.fetcher   = deps.fetcher ?? ((url, init) => fetch(url, init));
    }

    /**
     * Record an economic event. Returns either a canonical write result
     * (200, with event_id) or a deferred result (202, durability outbox
     * captured the row and the retry worker will replay).
     *
     * Throws P402Error('METER_CONTENT_REJECTED') BEFORE any HTTP request
     * if the input contains a content-bearing top-level key.
     */
    async recordEvent(input: MeterEventInput): Promise<MeterEventResult> {
        // Client-side privacy guard. Cast through unknown so the typecheck
        // doesn't object — the runtime guard exists precisely because some
        // callers will defy the static type (any-cast, dynamic body).
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

        this.log('meter.recordEvent', { request_id: input.request_id });

        const res = await this.fetcher(`${this.routerUrl}/api/v2/meter/events`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(input),
        });

        // 200 OK   → canonical write, event_id present
        // 202      → deferred to outbox, event_id absent, deferred=true
        if (res.status === 200 || res.status === 202) {
            const body = (await res.json()) as MeterEventResult;
            // Light type narrowing so the caller doesn't have to discriminate
            // by status when they only care about durability.
            if (res.status === 202 && (body as MeterEventDeferredResult).deferred !== true) {
                // Defensive: the router should always set deferred=true on
                // 202, but we normalize so the type discriminator is honest.
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

        const res = await this.fetcher(url, { headers: this.headers() });
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
        const res = await this.fetcher(
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
