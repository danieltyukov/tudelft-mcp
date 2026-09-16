import type { AppContext } from './context.js';
import { installOsiris } from './osiris/install.js';
import { installTimetable } from './timetable/install.js';

/**
 * Domain modules that hook into the context (login connectors, status checks,
 * background services) register themselves here. Keeps cli.ts and server.ts
 * free of domain imports. Connectors run after Brightspace in array order.
 */
export function installExtensions(ctx: AppContext): void {
  installOsiris(ctx);
  installTimetable(ctx);
}
