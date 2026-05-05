#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { P402Client } from "@p402/sdk";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const API_KEY = process.env["P402_API_KEY"];
const ROUTER_URL = (process.env["P402_ROUTER_URL"] ?? "https://p402.io").replace(/\/$/, "");
const WORLD_ID_ENABLED = process.env["P402_WORLD_ID_ENABLED"] === "true";
const AGENT_ADDRESS = process.env["P402_AGENT_ADDRESS"];

if (!API_KEY) {
  process.stderr.write("[p402-mcp] P402_API_KEY environment variable is required\n");
  process.exit(1);
}

if (WORLD_ID_ENABLED) {
  process.stderr.write("[p402-mcp] World AgentKit enabled (P402_WORLD_ID_ENABLED=true)\n");
}

const p402 = new P402Client({ apiKey: API_KEY, routerUrl: ROUTER_URL });

const server = new McpServer({
  name: "p402",
  version: "1.0.0",
});

// ---------------------------------------------------------------------------
// Helper: safe JSON response
// ---------------------------------------------------------------------------

function ok(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function err(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
    isError: true as const,
  };
}

// ---------------------------------------------------------------------------
// Tool: p402_chat
// ---------------------------------------------------------------------------

server.tool(
  "p402_chat",
  "Send a chat completion through P402's AI router. Automatically selects the best provider based on routing mode (cost / quality / speed / balanced). Settles per-request in USDC.e on Tempo or USDC on Base.",
  {
    message: z.string().describe("The user message to send"),
    mode: z
      .enum(["cost", "quality", "speed", "balanced"])
      .optional()
      .describe("Routing mode — cost minimises price, quality maximises model capability, speed minimises latency, balanced is the default"),
    model: z
      .string()
      .optional()
      .describe("Pin a specific model (e.g. gpt-4o, claude-3-5-sonnet-20241022). Omit to let the router choose."),
    session_id: z
      .string()
      .optional()
      .describe("Session ID for budget tracking. The cost of this call is deducted from the session budget."),
    preferred_rail: z
      .enum(["auto", "tempo", "base"])
      .optional()
      .describe("Settlement rail: auto (default, picks cheaper healthy rail), tempo (Tempo mainnet USDC.e, chain 4217), or base (Base mainnet USDC/EURC, chain 8453)."),
    analytics_tag: z
      .string()
      .optional()
      .describe("Free-form attribution tag echoed in p402_metadata and traffic analytics (e.g. 'research-agent', 'code-review')."),
    system: z.string().optional().describe("Optional system prompt"),
  },
  async ({ message, mode, model, session_id, preferred_rail, analytics_tag, system }) => {
    try {
      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: message });

      const response = await p402.chat({
        ...(model ? { model } : {}),
        messages,
        p402: {
          mode: mode ?? "balanced",
          ...(session_id ? { session_id } : {}),
          ...(preferred_rail ? { preferred_rail } : {}),
          ...(analytics_tag ? { analytics_tag } : {}),
        },
      });

      const choice = response.choices[0];
      const meta = response.p402_metadata;
      return ok({
        response: choice?.message.content ?? "",
        metadata: meta,
        payment_rail: meta?.payment_rail ?? null,
        credits_spent: (meta as Record<string, unknown> | undefined)?.["credits_spent"] ?? null,
        credits_remaining: (meta as Record<string, unknown> | undefined)?.["credits_balance"] ?? null,
      });
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_create_session
// ---------------------------------------------------------------------------

server.tool(
  "p402_create_session",
  "Create a budget-capped agent session. All chat completions using the returned session_id are charged against this budget. Returns the session object including id and budget details.",
  {
    budget_usd: z
      .number()
      .positive()
      .describe("Session budget in USD (e.g. 1.00 for $1.00). The session deactivates once this is exhausted."),
    agent_id: z
      .string()
      .optional()
      .describe("Optional agent identifier for attribution and AP2 mandate wiring"),
    expires_in_hours: z
      .number()
      .positive()
      .optional()
      .describe("Session TTL in hours. Defaults to 24."),
  },
  async ({ budget_usd, agent_id, expires_in_hours }) => {
    try {
      const session = await p402.createSession({ budget_usd, agent_id, expires_in_hours });
      return ok(session);
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_get_session
// ---------------------------------------------------------------------------

server.tool(
  "p402_get_session",
  "Get session details including remaining budget, status, and expiry. Use this to check how much budget a session has left before sending requests.",
  {
    session_id: z.string().describe("The session ID returned by p402_create_session"),
  },
  async ({ session_id }) => {
    try {
      const session = await p402.getSession(session_id);
      return ok({
        id: session.id,
        status: session.status,
        budget: session.budget,
        expires_at: session.expires_at,
      });
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_list_models
// ---------------------------------------------------------------------------

server.tool(
  "p402_list_models",
  "List all AI models available through the P402 router with their pricing, capabilities, and provider information.",
  {},
  async () => {
    try {
      const res = await fetch(`${ROUTER_URL}/api/v2/models`, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return ok(await res.json());
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_compare_providers
// ---------------------------------------------------------------------------

server.tool(
  "p402_compare_providers",
  "Compare AI provider pricing and capabilities side-by-side. Helps identify the cheapest or fastest provider for a given task type.",
  {
    task_type: z
      .enum(["chat", "embedding", "code", "reasoning"])
      .optional()
      .describe("Filter comparison to providers that support this task type"),
  },
  async ({ task_type }) => {
    try {
      const url = task_type
        ? `${ROUTER_URL}/api/v2/providers/compare?task_type=${encodeURIComponent(task_type)}`
        : `${ROUTER_URL}/api/v2/providers`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${API_KEY}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return ok(await res.json());
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_health
// ---------------------------------------------------------------------------

server.tool(
  "p402_health",
  "Check P402 router, x402 facilitator, and mppx payment gate health. Returns status for the routing layer, on-chain settlement layer, and Tempo/Base payment rails.",
  {},
  async () => {
    try {
      const [routerOk, facilitatorRes, mppxRes] = await Promise.all([
        p402.health(),
        fetch(`${ROUTER_URL}/api/v1/facilitator/health`).catch(() => null),
        fetch(`${ROUTER_URL}/api/internal/mppx/health`).catch(() => null),
      ]);

      const facilitatorData = facilitatorRes?.ok
        ? await facilitatorRes.json().catch(() => null)
        : null;

      const mppxData = mppxRes?.ok
        ? await mppxRes.json().catch(() => null)
        : null;

      return ok({
        router: routerOk ? "healthy" : "degraded",
        facilitator: facilitatorData ?? (facilitatorRes?.ok ? "healthy" : "unreachable"),
        mppx: mppxData ?? (mppxRes?.ok ? "healthy" : "disabled"),
      });
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: p402_agent_status
// ---------------------------------------------------------------------------

server.tool(
  "p402_agent_status",
  "Check the World AgentKit status for a wallet address — whether it is registered in AgentBook with a World ID proof-of-human. Verified agents receive free-trial access to P402 endpoints without x402 payments.",
  {
    address: z
      .string()
      .optional()
      .describe(
        "Agent wallet address (0x-prefixed). Defaults to P402_AGENT_ADDRESS env var if not provided."
      ),
  },
  async ({ address }) => {
    const target = address ?? AGENT_ADDRESS;
    if (!target) {
      return err(
        new Error(
          "No agent address provided. Pass address or set P402_AGENT_ADDRESS env var."
        )
      );
    }
    try {
      const res = await fetch(
        `${ROUTER_URL}/api/v1/agentkit/lookup?address=${encodeURIComponent(target)}`,
        { headers: { Authorization: `Bearer ${API_KEY}` } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const data = await res.json() as {
        address: string;
        registered: boolean;
        human_id: string | null;
        agentkit_enabled: boolean;
        network?: string;
        message: string;
      };
      // Fetch credit balance (non-blocking — null if unavailable)
      let credits_remaining: number | null = null;
      try {
        const credRes = await fetch(`${ROUTER_URL}/api/v2/credits/balance`, {
          headers: { Authorization: `Bearer ${API_KEY}` },
        });
        if (credRes.ok) {
          const credData = await credRes.json() as { balance?: number };
          credits_remaining = credData.balance ?? null;
        }
      } catch { /* non-blocking */ }

      return ok({
        address: data.address,
        world_id_verified: data.registered,
        human_id: data.human_id,
        agentkit_enabled: data.agentkit_enabled,
        network: data.network ?? "eip155:8453",
        free_trial_available: data.registered && data.agentkit_enabled,
        credits_remaining,
        message: data.message,
      });
    } catch (e) {
      return err(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
