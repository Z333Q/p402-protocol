#!/usr/bin/env node
import { Command } from 'commander';
import { loginCommand, configCommand } from './commands/login.js';
import { chatCommand } from './commands/chat.js';
import { agentCommand } from './commands/agent.js';
import { modelsCommand } from './commands/models.js';
import { providersCommand } from './commands/providers.js';
import { sessionCommand } from './commands/session.js';
import { mandateCommand } from './commands/mandate.js';
import { analyticsCommand } from './commands/analytics.js';
import { healthCommand } from './commands/health.js';
import { fmt } from './output.js';

const program = new Command();

program
  .name('p402')
  .description(
    fmt.primary('P402') + ' — AI Payment Router CLI\n' +
    fmt.dim('  Docs: https://p402.io/docs  ·  Dashboard: https://p402.io/dashboard')
  )
  .version('1.0.0', '-v, --version');

// Top-level commands
program.addCommand(loginCommand());
program.addCommand(configCommand());
program.addCommand(chatCommand());
program.addCommand(agentCommand());
program.addCommand(healthCommand());

// Grouped commands
program.addCommand(modelsCommand());
program.addCommand(providersCommand());
program.addCommand(sessionCommand());
program.addCommand(mandateCommand());
program.addCommand(analyticsCommand());

// Show help if no subcommand given
program.on('command:*', () => {
  console.error(`Unknown command: ${program.args.join(' ')}\n`);
  program.help();
});

program.parse(process.argv);

if (process.argv.length === 2) {
  program.help();
}
