# Sessions

Sessions are the foundational primitive for agent spending control. Every autonomous agent should operate within a session — it physically cannot spend beyond its budget.

## Lifecycle

```
Create session (budget: $10)
       ↓
Fund session (USDC on Base, or test credits)
       ↓
Use session (pass session_id with each chat request)
       ↓
Budget exhausted → session status: 'exhausted' → requests rejected
       ↓
Refund unused balance (via dashboard or API)
```

## Create a Session

```typescript
const session = await p402.createSession({
  budget_usd: 10.00,           // Hard cap — cannot be exceeded
  expires_in_hours: 24,        // Auto-expire after N hours
  agent_id: 'my-agent-v2',    // Optional — for analytics grouping
  wallet_address: '0x...',    // Optional — for USDC settlement attribution
});

// session.id — store this and pass with every request
```

```bash
p402 session create --budget 10 --agent my-agent --expires 24
```

## Use a Session

```typescript
await p402.chat({
  messages,
  p402: {
    mode: 'cost',
    session_id: session.id,  // All costs deducted from this session
  }
});
```

Every chat request decrements `budget.used_usd` and increments `budget.remaining_usd` is reduced accordingly.

## Check Budget

```typescript
const { budget, status } = await p402.getSession(session.id);

console.log(budget.total_usd);      // 10.00
console.log(budget.used_usd);       // 3.47 (spent so far)
console.log(budget.remaining_usd);  // 6.53

if (status === 'exhausted') {
  // Create a new session or fund this one
}
```

```bash
p402 session get <session-id>
```

## Fund a Session

Top up an existing session:

```typescript
await p402.fundSession(session.id, 5.00, txHash); // Add $5
```

```bash
p402 session fund <session-id> 5.00 --tx 0x...
```

## Session Status

| Status | Meaning |
|---|---|
| `active` | Requests accepted, budget available |
| `exhausted` | Budget used up — requests rejected with 402 |
| `expired` | Time limit reached |
| `ended` | Manually closed |

## Budget Error Handling

When budget is exceeded, the API returns an error before touching any provider:

```json
{
  "error": {
    "code": "BUDGET_EXCEEDED",
    "message": "Session budget exhausted",
    "session_id": "sess_abc",
    "remaining_usd": 0
  }
}
```

Handle it:
```typescript
try {
  await p402.chat({ messages, p402: { session_id } });
} catch (err) {
  if (err instanceof P402Error && err.code === 'BUDGET_EXCEEDED') {
    // Create new session or notify user
  }
}
```

## Billing Guard Layers

P402 applies multiple guards before each request (in order):

| Layer | Error Code | Action |
|---|---|---|
| Session budget | `BUDGET_EXCEEDED` | Reject before provider call |
| Rate limit | `RATE_LIMITED` | Reject, include `retryAfterMs` |
| Daily cap | `DAILY_LIMIT_EXCEEDED` | Reject until daily reset |
| Concurrent cap | `TOO_MANY_CONCURRENT` | Reject, queue or reduce parallelism |
| Per-request cap | `REQUEST_TOO_EXPENSIVE` | Reject; use cheaper model |

All guards fail closed — no provider call is made when a guard triggers.

## List Sessions

```typescript
// Via API
await p402.listSessions?.();

// Via CLI
p402 session list
```

## Analytics

Track per-session spend in the [dashboard](https://p402.io/dashboard) or via:

```bash
p402 analytics spend --period 7d
```
