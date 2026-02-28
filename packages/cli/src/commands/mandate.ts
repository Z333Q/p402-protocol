import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost, requireApiKey } from '../client.js';
import {
  printHeader, printKV, makeTable, printJson, printError, printSuccess, truncate,
} from '../output.js';

interface Mandate {
  id?: string;
  status?: string;
  type?: string;
  user_did?: string;
  agent_did?: string;
  amount_spent_usd?: number;
  constraints?: {
    max_amount_usd?: number;
    allowed_categories?: string[];
    valid_until?: string;
  };
  created_at?: string;
  [key: string]: unknown;
}

interface MandatesResponse {
  data?: Mandate[];
  mandates?: Mandate[];
  [key: string]: unknown;
}

export function mandateCommand(): Command {
  const cmd = new Command('mandate');
  cmd.description('AP2 mandate management');

  // p402 mandate list
  cmd
    .command('list')
    .description('List AP2 spending mandates')
    .option('--status <status>', 'Filter: active|exhausted|expired|revoked')
    .option('--json', 'Output as JSON')
    .action(async (opts: { status?: string; json?: boolean }) => {
      requireApiKey();
      const spinner = ora('Fetching mandates…').start();
      try {
        const qs = opts.status ? `?status=${opts.status}` : '';
        const data = await apiGet<MandatesResponse>(`/api/v2/governance/mandates${qs}`);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        const mandates = data.data ?? data.mandates ?? (Array.isArray(data) ? (data as Mandate[]) : []);
        printHeader(`Mandates (${mandates.length})`);

        if (mandates.length === 0) {
          console.log('  No mandates found.');
          return;
        }

        makeTable(
          ['ID', 'Status', 'Type', 'Agent DID', 'Max USD', 'Spent'],
          mandates.map((m) => [
            truncate(m.id ?? '—', 20),
            m.status ?? '—',
            m.type ?? '—',
            truncate(m.agent_did ?? '—', 24),
            m.constraints?.max_amount_usd != null ? `$${m.constraints.max_amount_usd}` : '—',
            m.amount_spent_usd != null ? `$${m.amount_spent_usd}` : '—',
          ])
        );
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to list mandates.', msg);
        process.exit(1);
      }
    });

  // p402 mandate create
  cmd
    .command('create')
    .description('Create a new AP2 spending mandate')
    .requiredOption('--user <did>', 'User DID (e.g. did:pkh:eip155:8453:0x...)')
    .requiredOption('--agent <did>', 'Agent DID')
    .requiredOption('--max <usd>', 'Maximum spend in USD')
    .option('--categories <list>', 'Comma-separated allowed categories')
    .option('--until <iso>', 'Expiry date (ISO 8601, e.g. 2026-12-31T00:00:00Z)')
    .option('--type <type>', 'Mandate type: intent|cart|payment', 'payment')
    .option('--json', 'Output as JSON')
    .action(async (opts: {
      user: string;
      agent: string;
      max: string;
      categories?: string;
      until?: string;
      type: string;
      json?: boolean;
    }) => {
      requireApiKey();
      const spinner = ora('Creating mandate…').start();
      try {
        const constraints: Record<string, unknown> = {
          max_amount_usd: parseFloat(opts.max),
        };
        if (opts.categories) {
          constraints['allowed_categories'] = opts.categories.split(',').map((c) => c.trim());
        }
        if (opts.until) constraints['valid_until'] = opts.until;

        const body = {
          user_did: opts.user,
          agent_did: opts.agent,
          type: opts.type,
          constraints,
        };

        const data = await apiPost<Mandate>('/api/v2/governance/mandates', body);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printSuccess(`Mandate created: ${data.id ?? '?'}`);
        printKV({
          id: data.id ?? '—',
          status: data.status ?? '—',
          type: data.type ?? '—',
          'user did': truncate(data.user_did ?? '—', 40),
          'agent did': truncate(data.agent_did ?? '—', 40),
          'max usd': data.constraints?.max_amount_usd != null ? `$${data.constraints.max_amount_usd}` : '—',
          expires: data.constraints?.valid_until ?? 'never',
        });
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to create mandate.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
