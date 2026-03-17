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

if (!API_KEY) {
  process.stderr.write("[p402-mcp] P402_API_KEY environment variable is required\n");
  process.exit(1);
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
  "Send a chat completion through P402's AI router. Automatically selects the best provider based on routing mode (cost / quality / speed / balanced).",
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
    system: z.string().optional().describe("Optional system prompt"),
  },
  async ({ message, mode, model, session_id, system }) => {
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
        } as { mode: "cost" | "quality" | "speed" | "balanced" },
      });

      const choice = response.choices[0];
      return ok({
        response: choice?.message.content ?? "",
        metadata: response.p402_metadata,
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
  "Check P402 router and x402 facilitator health. Returns status for both the routing layer and the on-chain settlement layer.",
  {},
  async () => {
    try {
      const [routerOk, facilitatorRes] = await Promise.all([
        p402.health(),
        fetch(`${ROUTER_URL}/api/v1/facilitator/health`).catch(() => null),
      ]);

      const facilitatorData = facilitatorRes?.ok
        ? await facilitatorRes.json().catch(() => null)
        : null;

      return ok({
        router: routerOk ? "healthy" : "degraded",
        facilitator: facilitatorData ?? (facilitatorRes?.ok ? "healthy" : "unreachable"),
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
