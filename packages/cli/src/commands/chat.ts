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
  p402_metadata?: {
    human_verified?: boolean;
    human_usage_remaining?: number | null;
    provider?: string;
    cost_usd?: number;
    credits_spent?: number;
    credits_balance?: number | null;
    payment_rail?: string | null;
    analytics_tag?: string | null;
  };
  [key: string]: unknown;
}

type RoutingMode = 'cost' | 'quality' | 'speed' | 'balanced';
type Rail = 'auto' | 'tempo' | 'base';

export function chatCommand(): Command {
  const cmd = new Command('chat');
  cmd
    .description('Send a single-turn chat message via P402 multi-provider router')
    .argument('<message>', 'The message to send')
    .option('-m, --mode <mode>', 'Routing mode: cost|quality|speed|balanced', 'balanced')
    .option('--model <model>', 'Override model (e.g. gpt-4o, claude-3-5-sonnet)')
    .option('--session <id>', 'Attach to an existing session')
    .option('--rail <rail>', 'Settlement rail: auto|tempo|base (default: auto)', 'auto')
    .option('--tag <tag>', 'Analytics attribution tag (e.g. research-agent)')
    .option('--stream', 'Stream response tokens as they arrive')
    .option('--json', 'Output full API response as JSON')
    .action(async (message: string, opts: {
      mode?: string;
      model?: string;
      session?: string;
      rail?: string;
      tag?: string;
      stream?: boolean;
      json?: boolean;
    }) => {
      const apiKey = requireApiKey();
      const routerUrl = getRouterUrl();

      const validModes: RoutingMode[] = ['cost', 'quality', 'speed', 'balanced'];
      const mode = (validModes.includes(opts.mode as RoutingMode) ? opts.mode : 'balanced') as RoutingMode;

      const validRails: Rail[] = ['auto', 'tempo', 'base'];
      const rail = (validRails.includes(opts.rail as Rail) ? opts.rail : 'auto') as Rail;

      const p402Block: Record<string, unknown> = { mode };
      if (rail !== 'auto') p402Block['preferred_rail'] = rail;
      if (opts.tag) p402Block['analytics_tag'] = opts.tag;
      if (opts.session) p402Block['session_id'] = opts.session;

      const body: Record<string, unknown> = {
        messages: [{ role: 'user', content: message }],
        stream: opts.stream ?? false,
        p402: p402Block,
      };
      if (opts.model) body['model'] = opts.model;

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

        const footerParts: string[] = [];
        if (data.model) footerParts.push(`model: ${data.model}`);
        if (data.usage) {
          const u = data.usage;
          footerParts.push(`tokens: ${u.prompt_tokens ?? 0} in / ${u.completion_tokens ?? 0} out`);
        }
        if (data.p402_metadata?.human_verified) {
          const remaining = data.p402_metadata.human_usage_remaining;
          const badge = fmt.primary('[VERIFIED]');
          const uses = remaining != null ? fmt.dim(` (${remaining} free uses left)`) : '';
          footerParts.push(`${badge}${uses}`);
        }
        if (data.p402_metadata?.credits_balance != null) {
          const bal = data.p402_metadata.credits_balance;
          const spent = data.p402_metadata.credits_spent;
          const spentStr = spent ? fmt.dim(` -${spent}`) : '';
          footerParts.push(`credits: ${fmt.primary(String(bal))}${spentStr}`);
        }
        if (data.p402_metadata?.payment_rail) {
          footerParts.push(`rail: ${fmt.primary(data.p402_metadata.payment_rail)}`);
        }
        if (footerParts.length > 0) {
          process.stdout.write(fmt.dim('  ') + footerParts.join(fmt.dim('  ·  ')));
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
