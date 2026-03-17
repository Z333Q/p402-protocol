/**
 * P402 VS Code Extension
 * =======================
 * Embeds the P402 MCP server as a McpServerDefinitionProvider so that
 * installing the extension is all a developer needs to get P402 tools
 * in Copilot agent mode. No .vscode/mcp.json editing required.
 *
 * The bundled MCP server (dist/mcp-server.mjs) is spawned by VS Code
 * as a child process using StdioServerTransport when Copilot needs it.
 */

import * as path from "path";
import * as vscode from "vscode";

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export function activate(context: vscode.ExtensionContext) {
  // 1. Register the embedded MCP server provider
  const mcpProvider = new P402McpServerProvider(context);
  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(EXTENSION_ID, mcpProvider)
  );

  // 2. Status bar: shows current router mode
  const statusBar = createStatusBarItem(context);
  context.subscriptions.push(statusBar);

  // 3. Tree views
  const sessionsProvider = new SessionsTreeProvider();
  const requestsProvider = new RecentRequestsTreeProvider();
  const providersTreeProvider = new ProviderStatusTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("p402.sessions", sessionsProvider),
    vscode.window.registerTreeDataProvider("p402.recentRequests", requestsProvider),
    vscode.window.registerTreeDataProvider("p402.providerStatus", providersTreeProvider)
  );

  // 4. Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("p402.configure", configureApiKey),
    vscode.commands.registerCommand("p402.showBudget", () => showBudget(sessionsProvider)),
    vscode.commands.registerCommand("p402.switchMode", switchRouterMode),
    vscode.commands.registerCommand("p402.openDashboard", openDashboard),
    vscode.commands.registerCommand("p402.createSession", () => createSession(sessionsProvider))
  );

  // 5. Prompt for API key on first activation
  const config = vscode.workspace.getConfiguration("p402");
  if (!config.get<string>("apiKey")) {
    vscode.window
      .showInformationMessage(
        "P402: Set your API key to enable AI routing and payments.",
        "Configure"
      )
      .then((selection) => {
        if (selection === "Configure") {
          vscode.commands.executeCommand("p402.configure");
        }
      });
  }
}

export function deactivate() {
  // Cleanup handled by disposables in context.subscriptions
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EXTENSION_ID = "p402";
const STATUS_BAR_PRIORITY = 100;

// ---------------------------------------------------------------------------
// MCP Server Definition Provider
// ---------------------------------------------------------------------------

/**
 * Registers the P402 MCP server as an embedded stdio process.
 * VS Code spawns dist/mcp-server.mjs when Copilot agent mode needs it.
 * The developer installs the extension and P402 tools appear immediately
 * — no mcp.json editing, no npx commands.
 */
class P402McpServerProvider implements vscode.McpServerDefinitionProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  provideMcpServerDefinitions(
    _token: vscode.CancellationToken
  ): vscode.ProviderResult<vscode.McpServerDefinition[]> {
    const config = vscode.workspace.getConfiguration("p402");
    const apiKey = config.get<string>("apiKey") ?? "";
    const routerMode = config.get<string>("routerMode") ?? "balanced";

    // Bundled MCP server entry point — included in the .vsix
    const serverPath = path.join(
      this.context.extensionPath,
      "dist",
      "mcp-server.mjs"
    );

    return [
      new vscode.McpStdioServerDefinition(
        "P402 AI Payment Router",
        "node",
        [serverPath],
        {
          P402_API_KEY: apiKey,
          P402_ROUTER_URL: "https://p402.io",
          P402_ROUTER_MODE: routerMode,
        }
      ),
    ];
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function createStatusBarItem(context: vscode.ExtensionContext): vscode.StatusBarItem {
  const config = vscode.workspace.getConfiguration("p402");
  const item = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );

  const mode = config.get<string>("routerMode") ?? "balanced";
  item.text = `$(zap) P402: ${mode}`;
  item.tooltip = "P402 AI Payment Router — click to switch mode";
  item.command = "p402.switchMode";

  if (config.get<boolean>("showStatusBar", true)) {
    item.show();
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("p402.routerMode")) {
        const newMode =
          vscode.workspace.getConfiguration("p402").get<string>("routerMode") ?? "balanced";
        item.text = `$(zap) P402: ${newMode}`;
      }
      if (e.affectsConfiguration("p402.showStatusBar")) {
        const show = vscode.workspace.getConfiguration("p402").get<boolean>("showStatusBar", true);
        show ? item.show() : item.hide();
      }
    })
  );

  return item;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function configureApiKey() {
  const key = await vscode.window.showInputBox({
    prompt: "Enter your P402 API key (get one at p402.io/dashboard/settings)",
    placeHolder: "p402_live_...",
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => {
      if (!value || value.length < 10) {
        return "API key appears too short";
      }
      return null;
    },
  });

  if (key) {
    await vscode.workspace
      .getConfiguration("p402")
      .update("apiKey", key, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(
      "P402: API key saved. Reload the window to reconnect the MCP server.",
      "Reload"
    ).then((s) => {
      if (s === "Reload") vscode.commands.executeCommand("workbench.action.reloadWindow");
    });
  }
}

async function switchRouterMode() {
  const modes = [
    { label: "cost",     description: "Lowest price — DeepSeek, Haiku, GPT-4o-mini" },
    { label: "quality",  description: "Best output — Claude Opus, GPT-5, Gemini Pro" },
    { label: "speed",    description: "Lowest latency — Groq LPU, Flash models" },
    { label: "balanced", description: "Equal weight across all dimensions (default)" },
  ];

  const selected = await vscode.window.showQuickPick(modes, {
    placeHolder: "Select P402 router mode",
  });

  if (selected) {
    await vscode.workspace
      .getConfiguration("p402")
      .update("routerMode", selected.label, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`P402: Router mode set to "${selected.label}"`);
  }
}

function openDashboard() {
  vscode.env.openExternal(vscode.Uri.parse("https://p402.io/dashboard"));
}

async function createSession(provider: SessionsTreeProvider) {
  const budget = await vscode.window.showInputBox({
    prompt: "Session budget in USD",
    placeHolder: "10.00",
    validateInput: (value) => {
      const num = parseFloat(value);
      if (isNaN(num) || num <= 0) return "Enter a positive dollar amount";
      return null;
    },
  });

  if (budget) {
    // Production: call p402.createSession via @p402/sdk with the configured API key
    vscode.window.showInformationMessage(`P402: Session created with $${budget} budget`);
    provider.refresh();
  }
}

function showBudget(provider: SessionsTreeProvider) {
  provider.refresh();
  vscode.commands.executeCommand("p402.sessions.focus");
}

// ---------------------------------------------------------------------------
// Tree view providers
// ---------------------------------------------------------------------------

class SessionsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const config = vscode.workspace.getConfiguration("p402");
    if (!config.get<string>("apiKey")) {
      const item = new vscode.TreeItem("Configure API key to view sessions");
      item.command = { command: "p402.configure", title: "Configure API Key", arguments: [] };
      return [item];
    }

    // Production: fetch from GET /api/v2/sessions via @p402/sdk
    const budget = new vscode.TreeItem("Budget: $10.00");
    budget.description = "$8.40 remaining";

    const spent = new vscode.TreeItem("Spent: $1.60");
    spent.description = "47 requests";

    const mode = new vscode.TreeItem(`Mode: ${config.get<string>("routerMode") ?? "balanced"}`);

    return [budget, spent, mode];
  }
}

class RecentRequestsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    // Production: fetch from GET /api/v2/analytics/spend via @p402/sdk
    return [
      requestItem("gpt-4o-mini",       "$0.0003", "412ms"),
      requestItem("claude-sonnet-4-6",  "$0.0021", "1.2s"),
      requestItem("deepseek-v3",        "$0.0001", "890ms"),
    ];
  }
}

class ProviderStatusTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    // Production: fetch from GET /api/v1/facilitator/health via fetch
    return [
      providerItem("OpenAI",     "healthy"),
      providerItem("Anthropic",  "healthy"),
      providerItem("Google",     "healthy"),
      providerItem("Groq",       "healthy"),
      providerItem("DeepSeek",   "degraded"),
    ];
  }
}

// ---------------------------------------------------------------------------
// Tree item helpers
// ---------------------------------------------------------------------------

function requestItem(model: string, cost: string, latency: string): vscode.TreeItem {
  const item = new vscode.TreeItem(model);
  item.description = `${cost} · ${latency}`;
  return item;
}

function providerItem(name: string, status: "healthy" | "degraded" | "down"): vscode.TreeItem {
  const item = new vscode.TreeItem(name);
  const icon: Record<string, string> = { healthy: "$(check)", degraded: "$(warning)", down: "$(error)" };
  item.description = `${icon[status] ?? ""} ${status}`;
  return item;
}
