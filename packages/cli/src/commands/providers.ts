import { Command } from 'commander';
import ora from 'ora';
import { apiGet, apiPost } from '../client.js';
import { printHeader, makeTable, printJson, printError, truncate } from '../output.js';

interface ProviderEntry {
  id?: string;
  name?: string;
  status?: string;
  latency_ms?: number;
  cost_per_1k?: number;
  models_count?: number;
  [key: string]: unknown;
}

interface ProvidersResponse {
  data?: ProviderEntry[];
  providers?: ProviderEntry[];
  [key: string]: unknown;
}

interface CompareResponse {
  [key: string]: unknown;
}

export function providersCommand(): Command {
  const cmd = new Command('providers');
  cmd.description('Provider commands');

  cmd
    .command('list')
    .description('List all AI providers and their current status')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const spinner = ora('Fetching providers…').start();
      try {
        const data = await apiGet<ProvidersResponse>('/api/v2/providers');
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        const providers = data.data ?? data.providers ?? (Array.isArray(data) ? (data as ProviderEntry[]) : []);
        printHeader(`Providers (${providers.length})`);

        if (providers.length === 0) {
          console.log('  No providers found.');
          return;
        }

        makeTable(
          ['ID', 'Name', 'Status', 'Latency', 'Cost/1k'],
          providers.map((p) => [
            truncate(p.id ?? '—', 20),
            truncate(p.name ?? '—', 20),
            p.status ?? '—',
            p.latency_ms != null ? `${p.latency_ms}ms` : '—',
            p.cost_per_1k != null ? `$${p.cost_per_1k}` : '—',
          ])
        );
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to list providers.', msg);
        process.exit(1);
      }
    });

  cmd
    .command('compare')
    .description('Compare providers for a given prompt')
    .option('--prompt <text>', 'Prompt to compare across providers')
    .option('--json', 'Output as JSON')
    .action(async (opts: { prompt?: string; json?: boolean }) => {
      const spinner = ora('Comparing providers…').start();
      try {
        const body = opts.prompt ? { prompt: opts.prompt } : {};
        const data = await apiPost<CompareResponse>('/api/v2/providers/compare', body);
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        printHeader('Provider Comparison');
        printJson(data);
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to compare providers.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
