import { Command } from 'commander';
import ora from 'ora';
import { requireApiKey } from '../client.js';
import { getRouterUrl } from '../config.js';
import { printError, printJson, fmt } from '../output.js';

interface ChatChoice {
  message?: { role?: string; content?: string };
  delta?: { content?: string };
  finish_reason?: string | null;
}

interface ChatResponse {
  choices?: ChatChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  model?: string;
  [key: string]: unknown;
}

type RoutingMode = 'cost' | 'quality' | 'speed' | 'balanced';

export function chatCommand(): Command {
  const cmd = new Command('chat');
  cmd
    .description('Send a single-turn chat message via P402 multi-provider router')
    .argument('<message>', 'The message to send')
    .option('-m, --mode <mode>', 'Routing mode: cost|quality|speed|balanced', 'balanced')
    .option('--model <model>', 'Override model (e.g. gpt-4o, claude-3-5-sonnet)')
    .option('--session <id>', 'Attach to an existing session')
    .option('--stream', 'Stream response tokens as they arrive')
    .option('--json', 'Output full API response as JSON')
    .action(async (message: string, opts: {
      mode?: string;
      model?: string;
      session?: string;
      stream?: boolean;
      json?: boolean;
    }) => {
      const apiKey = requireApiKey();
      const routerUrl = getRouterUrl();

      const validModes: RoutingMode[] = ['cost', 'quality', 'speed', 'balanced'];
      const mode = (validModes.includes(opts.mode as RoutingMode) ? opts.mode : 'balanced') as RoutingMode;

      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: message }],
        routing_mode: mode,
        stream: opts.stream ?? false,
      };
      if (opts.model) body['model'] = opts.model;
      if (opts.session) body['session_id'] = opts.session;

      if (opts.stream) {
        // Streaming path
        const spinner = ora('Connecting…').start();
        try {
          const res = await fetch(`${routerUrl}/api/v2/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
          });

          if (!res.ok || !res.body) {
            spinner.stop();
            printError(`Request failed: HTTP ${res.status}`);
            process.exit(1);
          }

          spinner.stop();
          process.stdout.write('\n');

          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() ?? '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const raw = line.slice(6).trim();
              if (raw === '[DONE]') break;
              try {
                const chunk = JSON.parse(raw) as ChatResponse;
                const token = chunk.choices?.[0]?.delta?.content ?? '';
                process.stdout.write(token);
              } catch { /* skip malformed chunks */ }
            }
          }
          process.stdout.write('\n\n');
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          printError('Stream failed.', msg);
          process.exit(1);
        }
        return;
      }

      // Non-streaming path
      const spinner = ora(`Routing via ${fmt.dim(mode)} mode…`).start();
      try {
        const res = await fetch(`${routerUrl}/api/v2/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        const data = await res.json() as ChatResponse;
        spinner.stop();

        if (!res.ok) {
          printError(`Request failed: HTTP ${res.status}`);
          if (opts.json) printJson(data);
          process.exit(1);
        }

        if (opts.json) {
          printJson(data);
          return;
        }

        const content = data.choices?.[0]?.message?.content ?? '';
        console.log('\n' + content + '\n');

        if (data.model) {
          process.stdout.write(fmt.dim(`  model: ${data.model}`));
        }
        if (data.usage) {
          const u = data.usage;
          process.stdout.write(fmt.dim(`  tokens: ${u.prompt_tokens ?? 0} in / ${u.completion_tokens ?? 0} out`));
        }
        console.log('\n');
      } catch (err: unknown) {
        spinner.stop();
        const msg = err instanceof Error ? err.message : String(err);
        printError('Chat request failed.', msg);
        process.exit(1);
      }
    });

  return cmd;
}
