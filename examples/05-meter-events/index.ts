/**
 * P402 Meter Events — Path B integration
 * ---------------------------------------
 * Post economic events without exposing content. Three modes:
 *   1. single event   → p402.meter.recordEvent
 *   2. batch          → p402.meter.recordEventsBatch
 *   3. buffered       → new MeterClient({ batch: { ... } }) + enqueueEvent
 *
 * Prerequisites:
 *   export P402_API_KEY=p402_live_...
 *   npm install @p402/sdk
 */

import P402Client, {
    MeterClient,
    P402Error,
    type MeterEventInput,
} from '@p402/sdk';

const apiKey = process.env['P402_API_KEY'];
if (!apiKey) {
    console.error('Set P402_API_KEY first.');
    process.exit(1);
}

const p402 = new P402Client({ apiKey });

// A helper to build a plausible metered event. Notice: NO prompt, NO
// response, NO messages. Only economics + attribution + outcome.
function makeEvent(reqId: string, cost: number): MeterEventInput {
    return {
        request_id: reqId,
        source: 'example-05',
        attribution: {
            department_id: 'claims',
            workflow_id: 'prior_authorization',
            action_type: 'claims_summary',
        },
        model: {
            provider: 'openai',
            model_used: 'gpt-4o-mini',
        },
        usage: {
            input_tokens: 2000,
            output_tokens: 500,
            cost_usd: cost,
            latency_ms: 720,
        },
        outcome: {
            status: 'accepted',
            quality_score: 0.9,
        },
    };
}

async function main() {
    // ─────────────────────────────────────────────────────────────────
    // 1. Single event
    // ─────────────────────────────────────────────────────────────────
    console.log('\n── 1. recordEvent (single) ──');
    const single = await p402.meter.recordEvent(makeEvent('req_single_1', 0.0041));
    if (single.deferred) {
        console.log(`  deferred to outbox: ${single.request_id}`);
    } else {
        console.log(`  event_id=${single.event_id}  privacy=${single.privacy.mode}`);
    }

    // ─────────────────────────────────────────────────────────────────
    // 2. Batch with a deliberate duplicate — proves UPSERT idempotency
    // ─────────────────────────────────────────────────────────────────
    console.log('\n── 2. recordEventsBatch (5 events, 1 duplicate) ──');
    const batch = await p402.meter.recordEventsBatch([
        makeEvent('req_batch_a', 0.0002),
        makeEvent('req_batch_b', 0.0003),
        makeEvent('req_batch_c', 0.0004),
        makeEvent('req_batch_a', 0.0002), // duplicate of the first
        makeEvent('req_batch_d', 0.0005),
    ]);
    console.log(`  accepted=${batch.accepted}  deferred=${batch.deferred}  rejected=${batch.rejected}`);
    // Both entries for req_batch_a will share the same event_id (UPSERT).
    const dupIds = batch.results
        .filter((r) => r.ok && r.request_id === 'req_batch_a' && !r.deferred)
        // TypeScript narrowing: only the ok:true, deferred:false branch has event_id.
        .map((r) => (r as { event_id: string }).event_id);
    console.log(`  duplicate 'req_batch_a' → event_ids: ${JSON.stringify(dupIds)}  (same id proves UPSERT)`);

    // ─────────────────────────────────────────────────────────────────
    // 3. Buffered mode via MeterClient directly
    // ─────────────────────────────────────────────────────────────────
    console.log('\n── 3. Buffered enqueueEvent + flush ──');
    const buffered = new MeterClient({
        routerUrl: 'https://p402.io',
        headers: () => ({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
        }),
        log: () => undefined,
        batch: { maxEvents: 3, maxLatencyMs: 2000 },
        retry: { maxRetries: 3, baseDelayMs: 200, maxDelayMs: 5000 },
    });

    // Fire-and-forget. The third enqueue triggers auto-flush at maxEvents.
    await buffered.enqueueEvent(makeEvent('req_buffered_1', 0.0001));
    await buffered.enqueueEvent(makeEvent('req_buffered_2', 0.0001));
    await buffered.enqueueEvent(makeEvent('req_buffered_3', 0.0001)); // auto-flush
    // Force-flush any remaining. This also awaits the in-flight auto-flush.
    const flushed = await buffered.flush();
    if (flushed) {
        console.log(`  flushed: accepted=${flushed.accepted}`);
    } else {
        console.log('  flush found nothing pending (auto-flush drained everything).');
    }

    // ─────────────────────────────────────────────────────────────────
    // 4. Client-side guard — this NEVER makes a network call
    // ─────────────────────────────────────────────────────────────────
    console.log('\n── 4. Content-key guard (client-side rejection) ──');
    try {
        await p402.meter.recordEvent({
            request_id: 'req_bad',
            // @ts-expect-error — demonstrating the guard
            prompt: 'this should never leave the process',
        });
    } catch (err) {
        if (err instanceof P402Error && err.code === 'METER_CONTENT_REJECTED') {
            console.log(`  guarded: ${err.message}`);
        } else {
            throw err;
        }
    }
}

main().catch((err) => {
    if (err instanceof P402Error) {
        console.error(`P402 error [${err.code}]:`, err.message);
    } else {
        console.error(err);
    }
    process.exit(1);
});
