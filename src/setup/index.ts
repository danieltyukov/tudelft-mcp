import { createInterface } from 'node:readline/promises';
import type { ParsedArgs } from '../cli.js';
import type { AppContext, Logger } from '../context.js';
import { TudelftError } from '../errors.js';
import { createClients, type ClientDefinition, type WriteResult } from './clients.js';
import { COMMAND_MODES, serverCommand, type CommandMode, type ServerEntry } from './command.js';
import { defaultSetupEnv, type SetupEnv } from './paths.js';

export { serverCommand } from './command.js';

interface ClientReport extends WriteResult {
  id: string;
  name: string;
}

interface SetupReport {
  command: ServerEntry;
  dryRun: boolean;
  results: ClientReport[];
}

const out = (text: string): void => {
  process.stdout.write(text);
};

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');

function commandMode(flag: string | boolean | undefined): CommandMode {
  if (flag === undefined) return 'auto';
  if (typeof flag === 'string' && (COMMAND_MODES as readonly string[]).includes(flag)) {
    return flag as CommandMode;
  }
  throw new TudelftError('INVALID_ARGUMENT', `--command must be one of ${COMMAND_MODES.join(', ')}.`);
}

function byIds(clients: ClientDefinition[], ids: string[]): ClientDefinition[] {
  return ids.map((id) => {
    const client = clients.find((candidate) => candidate.id === id);
    if (!client) {
      throw new TudelftError(
        'INVALID_ARGUMENT',
        `Unknown client "${id}". Known clients: ${clients.map((c) => c.id).join(', ')}.`,
      );
    }
    return client;
  });
}

function parseChoice(answer: string, detected: ClientDefinition[]): ClientDefinition[] {
  const text = answer.trim().toLowerCase();
  if (!text || text === 'all' || text === 'a') return detected;
  if (text === 'none' || text === 'n' || text === 'q') return [];
  const picked: ClientDefinition[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const index = Number(part);
    const client =
      Number.isInteger(index) && index >= 1 && index <= detected.length
        ? detected[index - 1]
        : detected.find((c) => c.id === part);
    if (!client) throw new TudelftError('INVALID_ARGUMENT', `"${part}" is not one of the listed clients.`);
    if (!picked.includes(client)) picked.push(client);
  }
  return picked;
}

async function ask(detected: ClientDefinition[]): Promise<ClientDefinition[]> {
  out('Detected MCP clients:\n');
  detected.forEach((client, index) => out(`  ${index + 1}. ${client.name} (${client.id})\n`));
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question('Configure which? Numbers separated by commas, or all [all]: ');
    return parseChoice(answer, detected);
  } finally {
    rl.close();
  }
}

async function select(
  clients: ClientDefinition[],
  args: ParsedArgs,
  json: boolean,
): Promise<ClientDefinition[] | undefined> {
  if (args.positional.length) return byIds(clients, args.positional);
  const detected = clients.filter((client) => client.detect().installed);
  const ids = clients.map((client) => client.id).join(', ');
  if (args.flags.all === true) {
    if (detected.length) return detected;
    out(`No supported MCP client was detected. Pass a client id to configure it anyway: ${ids}\n`);
    return undefined;
  }
  if (!json && process.stdin.isTTY && process.stdout.isTTY) {
    if (detected.length) return ask(detected);
    out(`No supported MCP client was detected. Pass a client id to configure it anyway: ${ids}\n`);
    return undefined;
  }
  if (json) {
    out(`${JSON.stringify({ detected: detected.map((c) => ({ id: c.id, ...c.detect() })) }, null, 2)}\n`);
  } else {
    out(
      detected.length
        ? `Detected: ${detected.map((c) => c.id).join(', ')}\n`
        : 'No supported MCP client was detected.\n',
    );
    out(`Run "tudelft-mcp setup --all" or name clients to configure: ${ids}\n`);
  }
  process.exitCode = 2;
  return undefined;
}

function printReport(report: SetupReport): void {
  const restart: string[] = [];
  for (const result of report.results) {
    if (result.manual) {
      out(`${result.name}: not written. ${result.manual}\n${indent(result.preview)}\n\n`);
    } else if (report.dryRun) {
      const verb = result.changed ? 'would update' : 'is already up to date:';
      out(`${result.name}: ${verb} ${result.path}\n${indent(result.preview)}\n\n`);
    } else if (result.changed) {
      const backup = result.backup ? ` (previous version saved as ${result.backup})` : '';
      out(`${result.name}: updated ${result.path}${backup}\n`);
      restart.push(result.name);
    } else {
      out(`${result.name}: already configured in ${result.path}\n`);
    }
  }
  if (report.dryRun) {
    out('Dry run: nothing was written.\n');
    return;
  }
  out('\nNext steps\n  1. Sign in once: tudelft-mcp login\n');
  if (restart.length) out(`  2. Restart ${restart.join(', ')} so the new server is picked up.\n`);
}

export async function runSetup(
  _ctx: AppContext,
  args: ParsedArgs,
  log: Logger,
  setup: SetupEnv = defaultSetupEnv(),
): Promise<void> {
  const dryRun = args.flags['dry-run'] === true;
  const json = args.flags.json === true;
  const command = serverCommand({ mode: commandMode(args.flags.command), setup });
  const clients = createClients(setup);
  const selected = await select(clients, args, json);
  if (!selected?.length) return;
  const results: ClientReport[] = [];
  for (const client of selected) {
    log(`${dryRun ? 'Previewing' : 'Configuring'} ${client.name}...`);
    results.push({ id: client.id, name: client.name, ...(await client.write(command, { dryRun })) });
  }
  const report: SetupReport = { command, dryRun, results };
  if (json) out(`${JSON.stringify(report, null, 2)}\n`);
  else printReport(report);
}
