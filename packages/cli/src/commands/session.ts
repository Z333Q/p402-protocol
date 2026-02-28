import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, requireApiKey } from '../client.js';
import {
  printHeader, printKV, makeTable, printJson, printError, printSuccess, truncate, fmt,
} from '../output.js';

interface Session {
  id?: string;
  status?: string;
  budget_usd?: number;
  spent_usd?: number;
  agent_id?: string;
  wallet_address?: string;
  created_at?: string;
  expires_at?: string;
  [key: string]: unknown;
}

interface SessionsResponse {
  data?: Session[];
  sessions?: Session[];
  [key: string]: unknown;
}

export function sessionCommand(): Command {
  const cmd = new Command('session');
  cmd.description('Session management');

  // p402 session list
  cmd
    .command('list')
    .description('List active sessions')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      requireApiKey();
      const spinner = ora('Fetching sessions…').start();
      try {
        const data = await apiGet<SessionsResponse>('/api/v2/sessions');
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        const sessions = data.data ?? data.sessions ?? (Array.isArray(data) ? (data as Session[]) : []);
        printHeader(`Sessions (${sessions.length})`);

        if (sessions.length === 0) {
          console.log('  No sessions found.');
          return;
        }

        makeTable(
          ['ID', 'Status', 'Budget', 'Spent', 'Agent'],
          sessions.map((s) => [
            truncate(s.id ?? '—', 22),
            s.status ?? '—',
            s.budget_usd != null ? `$${s.budget_usd}` : '—',
            s.spent_usd != null ? `$${s.spent_usd}` : '—',
            truncate(s.agent_id ?? '—', 20),
          ])
        );
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to list sessions.', msg);
        process.exit(1);
      }
    });

  // p402 session get <id>
  cmd
    .command('get <id>')
    .description('Get session details by ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, opts: { json?: boolean }) => {
      requireApiKey();
      const spinner = ora(`Fetching session ${fmt.dim(id)}…`).start();
      try {
        const data = await apiGet<Session>(`/api/v2/sessions/${id}`);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printHeader('Session');
        printKV({
          id: data.id ?? '—',
          status: data.status ?? '—',
          budget: data.budget_usd != null ? `$${data.budget_usd}` : '—',
          spent: data.spent_usd != null ? `$${data.spent_usd}` : '—',
          agent: data.agent_id ?? '—',
          wallet: data.wallet_address ?? '—',
          created: data.created_at ?? '—',
          expires: data.expires_at ?? '—',
        });
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to get session.', msg);
        process.exit(1);
      }
    });

  // p402 session create
  cmd
    .command('create')
    .description('Create a new session with a budget')
    .requiredOption('--budget <usd>', 'Budget in USD (e.g. 5.00)')
    .option('--agent <id>', 'Agent ID to associate')
    .option('--wallet <address>', 'Wallet address')
    .option('--expires <hours>', 'Expire after N hours (default: 24)', '24')
    .option('--json', 'Output as JSON')
    .action(async (opts: {
      budget: string;
      agent?: string;
      wallet?: string;
      expires: string;
      json?: boolean;
    }) => {
      requireApiKey();
      const spinner = ora('Creating session…').start();
      try {
        const body: Record<string, unknown> = {
          budget_usd: parseFloat(opts.budget),
          expires_in_hours: parseInt(opts.expires, 10),
        };
        if (opts.agent) body['agent_id'] = opts.agent;
        if (opts.wallet) body['wallet_address'] = opts.wallet;

        const data = await apiPost<Session>('/api/v2/sessions', body);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printSuccess(`Session created: ${data.id ?? '?'}`);
        printKV({
          id: data.id ?? '—',
          status: data.status ?? '—',
          budget: data.budget_usd != null ? `$${data.budget_usd}` : '—',
          expires: data.expires_at ?? '—',
        });
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to create session.', msg);
        process.exit(1);
      }
    });

  // p402 session fund <id> <amount>
  cmd
    .command('fund <id> <amount>')
    .description('Add budget to an existing session')
    .option('--tx <hash>', 'On-chain tx hash for the top-up')
    .option('--json', 'Output as JSON')
    .action(async (id: string, amount: string, opts: { tx?: string; json?: boolean }) => {
      requireApiKey();
      const spinner = ora(`Funding session ${fmt.dim(id)}…`).start();
      try {
        const body: Record<string, unknown> = {
          session_id: id,
          amount: parseFloat(amount),
        };
        if (opts.tx) body['tx_hash'] = opts.tx;

        const data = await apiPost<{ session?: Session }>('/api/v2/sessions/fund', body);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        const session = data.session ?? (data as Session);
        printSuccess(`Session funded.`);
        printKV({
          id: session.id ?? id,
          budget: session.budget_usd != null ? `$${session.budget_usd}` : '—',
          spent: session.spent_usd != null ? `$${session.spent_usd}` : '—',
        });
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to fund session.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
