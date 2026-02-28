# Example 03 — Next.js Session Budget

A budget-capped AI chat app using Next.js App Router. Each browser session gets a $1 budget — when it runs out, the app shows a "refill" message instead of making more API calls.

## Setup

```bash
cd examples/03-nextjs-session-budget
npm install
cp .env.example .env.local
# Edit .env.local and add your P402_API_KEY
npm run dev
```

## What It Shows

- Creating a P402 session server-side (App Router route handler)
- Passing `session_id` with every chat request
- Checking remaining budget and displaying it in the UI
- Graceful handling of `BUDGET_EXCEEDED` errors

## Key Files

| File | Purpose |
|---|---|
| `app/api/chat/route.ts` | Server-side route handler — creates session, proxies chat |
| `app/page.tsx` | Client-side chat UI with budget display |
