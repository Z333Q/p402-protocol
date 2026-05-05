# P402 Agent Setup Skill

A Claude skill that guides developers through integrating P402 as the AI routing and payment layer for autonomous agent frameworks and cloud VM environments.

**Version:** 0.2.0
**Updated:** May 2026

## What This Skill Does

When a developer asks about connecting P402 to their agent setup, this skill provides the exact configuration, code snippets, and architecture guidance they need. It covers three integration depths (provider swap, MCP server, SDK) and routes to the right reference file based on the developer's framework and hosting environment.

The skill describes shipped behavior. Multi-rail settlement on Base and Tempo, six-layer Billing Guard policy enforcement, and per-charge analytics with `analytics_tag` attribution are all live in production. Forward-looking features (session intent for per-token settlement, embedded fiat onramp, external security audit) are explicitly marked as not yet shipped.

## Supported Frameworks

- **OpenClaw** (dedicated reference with SOUL.md patterns, fallback chains, MCP config)
- **LangChain / LangGraph** (Python `extra_body` pattern)
- **CrewAI** (LangChain-based LLM passthrough)
- **AutoGPT / Auto-GPT Forge** (YAML provider config)
- **Semantic Kernel** (.NET OpenAI connector)
- **Python OpenAI SDK** (`extra_body` pattern)
- **TypeScript / JavaScript OpenAI SDK** (typed extension pattern, no `@ts-ignore`)
- **cURL / raw HTTP** (direct API calls)
- **`@p402/mpp-method`** (advanced: direct mppx-protocol integration)
- Any framework that accepts an OpenAI-compatible endpoint

## Supported Hosting Environments

- Zo Computer
- VPS (DigitalOcean, Linode, Hetzner, AWS EC2)
- Railway / Render / Fly.io
- Replit
- Docker / Containers

## File Structure

```
p402-agent-setup/
├── SKILL.md                        # Main skill (decision tree, P402 API reference, response guidelines)
├── references/
│   ├── openclaw.md                 # OpenClaw-specific integration
│   ├── generic-agent.md            # All other agent frameworks
│   └── environments.md             # Secrets management per hosting platform
└── README.md                       # This file
```

## Installation

### Claude Desktop / Claude.ai Projects

Drop the `p402-agent-setup/` folder into your project's skill directory or upload the individual files as project knowledge.

### Claude Code

Place the folder in your workspace's skills directory:

```bash
cp -r p402-agent-setup/ .claude/skills/
```

### As a .skill Package

If distributing via skillhub.club or similar, zip the folder and rename the extension:

```bash
zip -r p402-agent-setup.skill p402-agent-setup/
```

## Triggering

The skill triggers on keywords including: OpenClaw, Zo Computer, agent setup, provider configuration, MCP server, API key management, budget caps, session management, autonomous agent, always-on agent, OpenAI compatible, base URL, agent hosting, VM setup, cloud agent, personal AI agent, CrewAI, AutoGPT, LangChain, agent framework integration, multi-rail payment, Tempo settlement, Base settlement, mppx, x402, `@p402/mpp-method`, `@p402/mcp-server`.

## Design Voice

Responses follow P402's design system voice: direct, technical, no fluff. No em dashes. Lead with the config block, follow with security notes, close with the session workflow.

## Changelog

### v0.2.0 (May 2026)

- Multi-rail settlement: Base (USDC, EURC) and Tempo (USDC.e, USDT0, cUSD, and seven others)
- `preferred_rail` field documented with auto-selection logic
- `analytics_tag` field for per-request cost attribution
- `payment_rail` and `charge_amount_raw` in response metadata
- Updated model lineup (Claude Opus 4.7, Sonnet 4.6, Haiku 4.5)
- OpenRouter-style model identifiers (`anthropic/claude-opus-4.7`)
- `model: "auto"` recommended as the default in all examples
- mppx and `@p402/mpp-method` package referenced
- x402 backwards compatibility through May 2027 documented
- Status page URL added (`https://www.p402.io/status`)
- Dashboard URL added (`https://p402.io/dashboard`)
- TypeScript example uses typed extension pattern (no `@ts-ignore`)
- LangChain `extra_body` (replaces older `model_kwargs`)
- All em dashes removed (P402 voice compliance)
- Forward-looking features clearly marked as not yet shipped

### v0.1.0 (April 2026)

Initial release. Base-only settlement, single-rail routing, OpenAI SDK and OpenClaw integration patterns.

## License

MIT
