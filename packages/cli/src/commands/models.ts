import { Command } from 'commander';
import ora from 'ora';
import { apiGet } from '../client.js';
import { printHeader, makeTable, printJson, printError, truncate } from '../output.js';

interface ModelEntry {
  id?: string;
  name?: string;
  context_window?: number;
  cost_per_1k_tokens?: number;
  provider?: string;
  [key: string]: unknown;
}

interface ModelsResponse {
  data?: ModelEntry[];
  [key: string]: unknown;
}

export function modelsCommand(): Command {
  const cmd = new Command('models');
  cmd.description('Model commands');

  cmd
    .command('list')
    .description('List available models across all providers')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      const spinner = ora('Fetching models…').start();
      try {
        const data = await apiGet<ModelsResponse>('/api/v2/models');
        spinner.stop();

        if (opts.json) {
          printJson(data);
          return;
        }

        const models = data.data ?? (Array.isArray(data) ? (data as ModelEntry[]) : []);
        printHeader(`Models (${models.length})`);

        if (models.length === 0) {
          console.log('  No models found.');
          return;
        }

        makeTable(
          ['ID', 'Provider', 'Context', 'Cost/1k'],
          models.map((m) => [
            truncate(m.id ?? '—', 40),
            m.provider ?? '—',
            m.context_window != null ? String(m.context_window) : '—',
            m.cost_per_1k_tokens != null ? `$${m.cost_per_1k_tokens}` : '—',
          ])
        );
        console.log();
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Failed to list models.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
