import { osirisConnector, renewOsiris, verifyUser } from '../auth/osiris-auth.js';
import { registerStatusCheck, type ServiceStatus } from '../auth/status.js';
import { service, type AppContext } from '../context.js';
import { toSafeError, TudelftError } from '../errors.js';
import { sha256 } from '../util/text.js';
import { OsirisClient } from './client.js';

export const OSIRIS_SERVICE = 'osiris';

export function osirisClient(ctx: AppContext): OsirisClient {
  return service<OsirisClient>(ctx, OSIRIS_SERVICE);
}

/** Verify the saved OSIRIS session against the live API. */
export async function osirisStatus(ctx: AppContext, verify = true): Promise<ServiceStatus> {
  const data = await ctx.session.load();
  if (!data.osiris) return { connected: false };
  const status: ServiceStatus = { connected: true, savedAt: data.osiris.savedAt };
  if (!verify) return status;
  try {
    const user = verifyUser(await osirisClient(ctx).request('/gebruiker'));
    if (sha256(user.studentNumber) !== data.osiris.studentHash) {
      throw new TudelftError(
        'ACCOUNT_CHANGED',
        'The live OSIRIS account differs from the saved one. Run "tudelft-mcp login".',
      );
    }
    status.verified = true;
  } catch (error) {
    status.verified = false;
    status.error = toSafeError(error);
  }
  return status;
}

/** Hook OSIRIS into the context: API client, login connector and status check. */
export function installOsiris(ctx: AppContext): void {
  const client = new OsirisClient(ctx.config, ctx.session, () => renewOsiris(ctx));
  ctx.services.set(OSIRIS_SERVICE, client);
  ctx.connectors.push(osirisConnector);
  registerStatusCheck(OSIRIS_SERVICE, (current) => osirisStatus(current, true));
}
