import { z } from 'zod';
import type { AppContext } from '../context.js';
import { runLogin, type LoginReport } from '../auth/login.js';
import { authStatus, logoutAll } from '../auth/status.js';
import { DESTRUCTIVE, READ, WRITE, type ToolRegistry } from './registry.js';

export function registerAuthTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'auth_status',
    {
      title: 'Sign-in status',
      description:
        'Check which university services are connected (Brightspace, OSIRIS on my.tudelft.nl, MyTimetable) and verify the Brightspace session against the live API, renewing it silently if needed. Never opens a window.',
      input: {
        verify: z.boolean().default(true).describe('Verify the Brightspace session live (default true).'),
      },
      annotations: READ,
    },
    (args, ctx) => authStatus(ctx, args.verify),
  );

  reg.tool(
    'auth_login',
    {
      title: 'Open sign-in window',
      description:
        'Open the university sign-in in a browser window so the student can enter their password and MFA there. Connects Brightspace, then OSIRIS and MyTimetable in the same window. Use only when the student explicitly asks to sign in; routine refresh is automatic. Blocks until the sign-in finishes or times out.',
      input: {
        interactive: z
          .literal(true)
          .describe('Must be true. Confirms the student asked for a sign-in window.'),
        fresh: z
          .boolean()
          .default(false)
          .describe('Start with a clean browser profile (removes saved university cookies).'),
      },
      annotations: WRITE,
    },
    async (args, ctx): Promise<LoginReport> => runLogin(ctx, { fresh: args.fresh }, () => undefined),
  );

  reg.tool(
    'auth_logout',
    {
      title: 'Sign out locally',
      description:
        'Remove the saved sessions for every service and clear the browser profile. Downloads and the search index stay. University sessions are not revoked remotely.',
      input: {},
      annotations: DESTRUCTIVE,
    },
    (_args, ctx) => logoutAll(ctx),
  );
}
