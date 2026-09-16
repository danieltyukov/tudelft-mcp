import { registerStatusCheck } from '../auth/status.js';
import { timetableConnector } from '../auth/timetable-auth.js';
import { service, type AppContext } from '../context.js';
import { TimetableService } from './service.js';

export const TIMETABLE_SERVICE = 'timetable';

export function timetableService(ctx: AppContext): TimetableService {
  return service<TimetableService>(ctx, TIMETABLE_SERVICE);
}

/** Hook MyTimetable into the context: feed service, login connector and status check. */
export function installTimetable(ctx: AppContext): void {
  ctx.services.set(TIMETABLE_SERVICE, new TimetableService(ctx.config, ctx.session));
  ctx.connectors.push(timetableConnector);
  registerStatusCheck(TIMETABLE_SERVICE, async (current) => {
    const status = await timetableService(current).status();
    return status.connectedAt
      ? { connected: status.configured, connectedAt: status.connectedAt }
      : { connected: status.configured };
  });
}
