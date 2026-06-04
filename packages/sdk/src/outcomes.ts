/**
 * P402 SDK — Outcomes
 * ===================
 * Wraps POST /api/v2/outcomes. Outcomes are the "did this AI action actually
 * work" signal that feeds Optimize (Slice 2A+). Idempotent per
 * (tenant_id, request_id); repeat calls UPSERT.
 */

import type { OutcomeInput, OutcomeResult, OutcomeStatus } from './types';
import { P402Error } from './errors';

const VALID_OUTCOME_STATUSES: ReadonlySet<OutcomeStatus> = new Set<OutcomeStatus>([
    'accepted', 'rejected', 'retried', 'escalated', 'human_reviewed', 'failed',
]);

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

interface OutcomesClientDeps {
    routerUrl: string;
    headers: () => Record<string, string>;
    log: (msg: string, data?: unknown) => void;
    fetcher?: Fetcher;
}

export class OutcomesClient {
    private routerUrl: string;
    private headers: () => Record<string, string>;
    private log: (msg: string, data?: unknown) => void;
    private fetcher: Fetcher;

    constructor(deps: OutcomesClientDeps) {
        this.routerUrl = deps.routerUrl;
        this.headers   = deps.headers;
        this.log       = deps.log;
        this.fetcher   = deps.fetcher ?? ((url, init) => fetch(url, init));
    }

    async record(input: OutcomeInput): Promise<OutcomeResult> {
        if (!input.request_id || typeof input.request_id !== 'string') {
            throw new P402Error('INVALID_INPUT', 'request_id is required');
        }
        if (!VALID_OUTCOME_STATUSES.has(input.status)) {
            throw new P402Error(
                'OUTCOME_INVALID_STATUS',
                `status must be one of: ${[...VALID_OUTCOME_STATUSES].join(', ')}`,
                { received: input.status },
            );
        }
        if (input.quality_score !== undefined) {
            const n = input.quality_score;
            if (!Number.isFinite(n) || n < 0 || n > 1) {
                throw new P402Error('INVALID_INPUT', 'quality_score must be in [0, 1]');
            }
        }

        this.log('outcomes.record', { request_id: input.request_id, status: input.status });

        const res = await this.fetcher(`${this.routerUrl}/api/v2/outcomes`, {
            method: 'POST',
            headers: this.headers(),
            body: JSON.stringify(input),
        });

        if (!res.ok) {
            const err = (await res.json().catch(() => ({}))) as {
                error?: { code?: string; message?: string; details?: unknown };
            };
            throw new P402Error(
                res.status === 400 ? 'INVALID_INPUT' : 'NETWORK_ERROR',
                err.error?.message ?? `outcomes.record failed: ${res.statusText}`,
                err.error,
            );
        }
        return (await res.json()) as OutcomeResult;
    }
}
