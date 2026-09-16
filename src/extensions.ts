import type { AppContext } from './context.js';

/**
 * Domain modules that hook into the context (login connectors, status checks,
 * background services) register themselves here. Keeps cli.ts and server.ts
 * free of domain imports.
 */
export function installExtensions(_ctx: AppContext): void {
  // Filled in by the OSIRIS, timetable and index modules.
}
