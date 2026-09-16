import type { ParsedArgs } from '../cli.js';
import type { AppContext, Logger } from '../context.js';

/** Placeholder until the setup module lands. */
export async function runSetup(_ctx: AppContext, _args: ParsedArgs, log: Logger): Promise<void> {
  log('Setup is not available in this build.');
}
