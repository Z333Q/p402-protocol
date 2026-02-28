# Example 02 — OpenAI Migration

Drop-in replacement for the OpenAI SDK. Change one URL and one API key — everything else stays identical.

## Setup

```bash
cd examples/02-openai-migration
npm install
export P402_API_KEY=p402_live_...
```

## Run

```bash
npx tsx index.ts
```

## What It Shows

- Using the raw `fetch` API against P402's OpenAI-compatible endpoint
- Using the official OpenAI SDK pointed at P402 (`baseURL` override)
- How to read `p402_metadata` from the response
- Both approaches produce identical response shapes

## Migration Checklist

| Before | After |
|---|---|
| `https://api.openai.com/v1` | `https://p402.io/api/v2` |
| `Authorization: Bearer $OPENAI_KEY` | `Authorization: Bearer $P402_API_KEY` |
| `model: 'gpt-4o'` | `model: 'gpt-4o'` (optional — P402 can choose) |
| (nothing) | Add `p402: { mode: 'cost' }` for routing control |
