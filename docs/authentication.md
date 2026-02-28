# Authentication

## API Keys

P402 uses bearer token authentication. API keys are in the format `p402_live_...`.

```
Authorization: Bearer p402_live_...
```

**Security:** Raw API keys are shown exactly once at creation time. Only a SHA-256 hash is stored server-side. If you lose your key, generate a new one — the old one cannot be recovered.

## Setting Your Key

### Environment variable (recommended)
```bash
export P402_API_KEY=p402_live_...
```

### SDK
```typescript
const p402 = new P402Client({ apiKey: process.env.P402_API_KEY });
```

### CLI
```bash
npx p402 login --key p402_live_...
# or: npx p402 login   (interactive prompt)
```

The CLI stores the key in `~/.p402/config.json`. Override at runtime with `P402_API_KEY` env var.

### curl
```bash
curl -H "Authorization: Bearer $P402_API_KEY" https://p402.io/api/v2/models
```

## Scopes

All keys have full tenant scope. Key-level scoping is on the roadmap.

## Public Endpoints

These endpoints do not require authentication:
- `GET /api/health`
- `GET /api/v1/facilitator/health`
- `GET /api/v1/facilitator/supported`
- `GET /api/v2/models`
- `GET /.well-known/agent.json`

## Security Best Practices

- Never commit API keys to version control
- Use environment variables or secret managers (Doppler, AWS Secrets Manager, Vercel env)
- Rotate keys periodically from [the dashboard](https://p402.io/dashboard/settings)
- Use session budgets to limit blast radius for agent keys

## Error Codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHORIZED` | 401 | Missing or invalid API key |
| `RATE_LIMITED` | 429 | Too many requests — back off |
| `DAILY_LIMIT_EXCEEDED` | 429 | Daily spend cap reached |
