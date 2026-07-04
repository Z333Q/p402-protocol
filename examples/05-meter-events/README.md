# Example 05 — Meter Events (Path B)

Post economic events to P402 without ever exposing prompts, responses, or any
content field. This is the Path B integration for apps that call OpenAI /
Anthropic / Gemini directly but want P402's Meter / Monitor / Control /
Optimize surfaces.

Three modes demonstrated:

1. **Single event** — `p402.meter.recordEvent(input)`.
2. **Batch** — `p402.meter.recordEventsBatch(events)`, one HTTP request for N
   events with per-event UPSERT on `(tenant_id, request_id)`.
3. **Buffered** — `MeterClient` with `batch: { maxEvents, maxLatencyMs }`,
   `enqueueEvent()` for fire-and-forget metering, `flush()` to force-drain.

## Setup

```bash
cd examples/05-meter-events
npm install @p402/sdk
export P402_API_KEY=p402_live_...
```

## Run

```bash
npx tsx index.ts
```

## What It Does

1. Records one event via `p402.meter.recordEvent`.
2. Records five events as a single batch via `p402.meter.recordEventsBatch`,
   including a deliberate duplicate `request_id` to prove UPSERT idempotency.
3. Instantiates a `MeterClient` with a `batch` config, `enqueueEvent`s a
   handful of events, and demonstrates auto-flush + manual `flush()`.

## Privacy Contract

The SDK refuses to send any of the following top-level keys and throws
`METER_CONTENT_REJECTED` *before* the network call:

```
prompt, prompts, response, responses, completion,
messages, message, content, text,
file, files, document, documents,
chat, chat_history, transcript,
pii, phi, secret, secrets, source_code
```

P402 meters economics, not content. If you need content-side capabilities,
use the routed path (`/api/v2/chat/completions`) with your tenant's privacy
mode configured on the router side.

## Retry Policy

`MeterClient` retries network errors and 5xx responses with exponential
backoff and full jitter (defaults: 3 attempts, 200ms base, 5000ms cap;
constructor-overridable). Per-event `request_id`s are preserved verbatim
across retries; the router's `(tenant_id, request_id)` UPSERT guarantees a
duplicate submission produces the same `event_id`. Safe to retry
aggressively. `429` is not retried and surfaces immediately as
`RATE_LIMITED` — apply your own backoff for rate-limit handling.
