import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export interface Config {
  /** Data directory, default ~/.tudelft-mcp */
  home: string;
  profileDir: string;
  sessionFile: string;
  indexDir: string;
  downloadsDir: string;
  snapshotDir: string;
  brightspaceUrl: string;
  osirisUrl: string;
  timetableUrl: string;
  studyGuideApiUrl: string;
  studyGuideUrl: string;
  /** Explicit browser executable, otherwise auto-detected. */
  browserPath: string | undefined;
  timeoutMs: number;
  loginTimeoutMs: number;
  silentLoginTimeoutMs: number;
  maxFileBytes: number;
  maxTextChars: number;
}

function httpsOrigin(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid HTTPS origin.`);
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(`${name} must be a bare HTTPS origin such as https://example.tudelft.nl.`);
  }
  return url.origin;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const home = resolve(env.TUDELFT_MCP_HOME ?? join(homedir(), '.tudelft-mcp'));
  return {
    home,
    profileDir: join(home, 'profile'),
    sessionFile: join(home, 'session.json'),
    indexDir: join(home, 'index'),
    downloadsDir: join(home, 'downloads'),
    snapshotDir: join(home, 'snapshots'),
    brightspaceUrl: httpsOrigin(
      env.TUDELFT_BRIGHTSPACE_URL ?? 'https://brightspace.tudelft.nl',
      'TUDELFT_BRIGHTSPACE_URL',
    ),
    osirisUrl: httpsOrigin(env.TUDELFT_OSIRIS_URL ?? 'https://my.tudelft.nl', 'TUDELFT_OSIRIS_URL'),
    timetableUrl: httpsOrigin(
      env.TUDELFT_TIMETABLE_URL ?? 'https://mytimetable.tudelft.nl',
      'TUDELFT_TIMETABLE_URL',
    ),
    studyGuideApiUrl: 'https://curriculum.tudelft.nl',
    studyGuideUrl: 'https://studyguide.tudelft.nl',
    browserPath: env.TUDELFT_BROWSER_PATH || undefined,
    timeoutMs: 30_000,
    loginTimeoutMs: 15 * 60_000,
    silentLoginTimeoutMs: 45_000,
    maxFileBytes: 50 * 1024 * 1024,
    maxTextChars: 2_000_000,
  };
}

export const TIMEZONE = 'Europe/Amsterdam';
export const SERVER_NAME = 'tudelft';
