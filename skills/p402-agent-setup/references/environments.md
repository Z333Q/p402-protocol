# Hosting Environment Reference

This reference covers secrets management and environment configuration for running P402-connected agents across hosting platforms.

## Universal Rules

1. **Never commit API keys to Git-tracked files.** Use `.env` with `.gitignore` entries, or the platform's secrets manager.
2. **Use environment variables, not hardcoded strings.** Reference `${P402_API_KEY}` or `process.env.P402_API_KEY`. Never paste the raw key into config files.
3. **Rotate keys if compromised.** Generate a new key in the dashboard and update the environment variable. Old keys can be revoked.

## Zo Computer

Zo Computer is a personal cloud VM (Linux server with root access, persistent filesystem). Agents running on Zo persist across reboots and run 24/7.

### Setting the API key

```bash
# Add to shell profile for persistence across reboots
echo 'export P402_API_KEY="your-key-here"' >> ~/.bashrc
source ~/.bashrc
```

Or use a `.env` file in the agent's workspace:

```bash
# /home/workspace/my-agent/.env
P402_API_KEY=your-key-here
```

Load it in the agent's startup script or config. OpenClaw reads `.env` files from the workspace directory automatically.

### Security considerations for Zo

- Zo is a full Linux server with root access. The user controls all files.
- Keys stored in `~/.bashrc` or `.env` files are safe as long as the workspace is not publicly shared or committed to a public Git repo.
- Zo's snapshot or backup system captures the full disk state, including env vars. Anyone who restores a snapshot inherits the keys.
- If Zo is connected to a public Git repo, ensure `.env` is in `.gitignore`.

### MCP server on Zo

Zo supports MCP servers natively. Install the P402 MCP server globally:

```bash
npm install -g @p402/mcp-server
```

Add it to the Zo MCP configuration or the agent's MCP server list. Zo's persistent filesystem means the global npm install survives reboots.

## VPS (DigitalOcean, Linode, Hetzner, AWS EC2)

### Setting the API key

For systemd services:

```ini
# /etc/systemd/system/my-agent.service.d/env.conf
[Service]
Environment="P402_API_KEY=your-key-here"
```

Or use a `.env` file with restricted permissions:

```bash
echo 'P402_API_KEY=your-key-here' > /home/agent/.env
chmod 600 /home/agent/.env
```

### Security considerations for VPS

- `chmod 600 .env` restricts read access to the file owner.
- Use SSH key authentication, not passwords.
- For multi-agent VPSes, use separate system users with isolated home directories.

## Railway / Render / Fly.io

### Setting the API key

Use the platform's secrets UI:

- **Railway:** Settings → Variables → Add `P402_API_KEY`
- **Render:** Environment → Environment Variables → Add `P402_API_KEY`
- **Fly.io:** `fly secrets set P402_API_KEY=your-key-here`

### Security considerations

- Platform-managed secrets are encrypted at rest and injected at runtime.
- Keys are not visible in logs or build output.
- Redeploys automatically pick up updated secrets.

## Replit

### Setting the API key

Use Replit's Secrets tab (padlock icon in the sidebar):

1. Click "Secrets"
2. Add key: `P402_API_KEY`, value: your key
3. Access in code via `process.env.P402_API_KEY` (Node.js) or `os.environ["P402_API_KEY"]` (Python)

### Security considerations

- Replit Secrets are encrypted and not visible to collaborators or in the public repo.
- Do not put keys in `replit.nix`, `.replit`, or any tracked config file.
- Replit's hosting tiers vary; for always-on agent hosting, verify the current Replit plan supports persistent execution. Free-tier instances generally do not stay alive between sessions.

## Docker / Containers

### Setting the API key

Pass at runtime:

```bash
docker run -e P402_API_KEY=your-key-here my-agent
```

Or with Docker Compose:

```yaml
# docker-compose.yml
services:
  agent:
    image: my-agent
    env_file:
      - .env
```

```bash
# .env (not committed to Git)
P402_API_KEY=your-key-here
```

### Security considerations

- Never bake keys into Docker images. No `ENV P402_API_KEY=...` in the Dockerfile.
- Use Docker secrets or env files at runtime.
- With Docker Compose, add `.env` to `.gitignore`.

## Verifying the Connection

After setting up the environment, verify connectivity:

```bash
curl -s https://p402.io/api/v2/health \
  -H "Authorization: Bearer $P402_API_KEY" | jq .
```

A successful response confirms the key is valid and the router is reachable.

For uptime monitoring without authentication, the public status page is at `https://www.p402.io/status`.

If the agent runs in a restricted network (some VMs block outbound traffic by default), ensure HTTPS (port 443) to `p402.io` is allowed.

## Multiple Agents, One Key

A single P402 API key can serve multiple agents. Use separate `session_id` and `analytics_tag` values per agent to track spend independently:

- Agent A creates session `sess_research` with $10 budget, tags requests `analytics_tag: "research"`
- Agent B creates session `sess_coding` with $25 budget, tags requests `analytics_tag: "coding"`
- Both use the same API key. Budgets are isolated per session. Spend is broken down by tag in the dashboard.

This is the recommended pattern for users running multiple OpenClaw agents or a multi-agent orchestration setup.

## Choosing a Settlement Rail

P402 supports multiple stablecoin rails. The agent does not need to choose explicitly; `preferred_rail: "auto"` (the default) picks the cheaper healthy rail per request and tie-breaks to Tempo.

If the agent's user wants to fund sessions and the choice of rail matters for them:

- **Base mainnet (USDC):** Higher liquidity, broader wallet support, higher gas. Choose if the user already has USDC on Base.
- **Tempo mainnet (USDC.e):** Lower gas (paid in stablecoin via FeeAMM), faster confirmation, narrower wallet support today. Choose for cost-sensitive high-volume agents.

The dashboard shows which rail settled each charge in the per-request breakdown.

## Funding Today and Tomorrow

Today, funding requires the user to send stablecoin from their own wallet. The user pays gas (on Base) or stablecoin gas (on Tempo). After the on-chain confirmation, they POST the tx hash to `/api/v2/sessions/fund` to credit the session.

Stripe-style fiat onramp (card to stablecoin, embedded in the dashboard) is on the roadmap but not yet shipped. Until then, agents and their users must hold stablecoin in advance.
