import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { TudelftError } from '../errors.js';
import { Lane } from '../util/paging.js';

export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix seconds, -1 for session cookies. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface Identity {
  id: string;
  name: string;
  uniqueName: string;
  orgDefinedId?: string;
}

export interface BrightspaceSession {
  origin: string;
  cookies: Cookie[];
  xsrf?: string;
  bearer?: string;
  identity: Identity;
  savedAt: string;
}

export interface OsirisSession {
  origin: string;
  token: string;
  expiresAt: number | null;
  cookies: Cookie[];
  /** sha256 of the student number, used to detect account changes. */
  studentHash: string;
  savedAt: string;
}

export interface TimetableSession {
  icalUrl: string;
  connectedAt: string;
}

export interface SessionData {
  version: 1;
  brightspace?: BrightspaceSession;
  osiris?: OsirisSession;
  timetable?: TimetableSession;
  http?: { token: string; createdAt: string };
}

const EMPTY: SessionData = { version: 1 };

interface Envelope {
  format: 'plain-v1' | 'dpapi-v1';
  value: string;
}

async function dpapi(input: string, decrypt: boolean): Promise<string> {
  const method = decrypt ? 'Unprotect' : 'Protect';
  const script = `$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${method}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const fail = () =>
      reject(
        new TudelftError(
          'INTERNAL_ERROR',
          'Windows data protection failed for the saved session. Sign in again.',
        ),
      );
    const timer = setTimeout(() => {
      child.kill();
      fail();
    }, 20_000);
    let output = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (output += chunk));
    child.on('error', () => {
      clearTimeout(timer);
      fail();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0 && output.trim()) resolve(output.trim());
      else fail();
    });
    child.stdin.end(input);
  });
}

/**
 * Stores the saved sign-in state as one JSON file with owner-only permissions.
 * On Windows the payload is additionally wrapped with DPAPI for the current user.
 */
export class SessionStore {
  private lane = new Lane();
  private cache?: SessionData;

  constructor(
    readonly file: string,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  async load(): Promise<SessionData> {
    if (this.cache) return structuredClone(this.cache);
    let text: string;
    try {
      text = await readFile(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cache = structuredClone(EMPTY);
        return structuredClone(EMPTY);
      }
      throw new TudelftError('INTERNAL_ERROR', 'The saved session could not be read. Sign in again.');
    }
    try {
      const envelope = JSON.parse(text) as Envelope;
      let json: string;
      if (envelope.format === 'dpapi-v1') {
        if (this.platform !== 'win32') throw new Error('dpapi on non-windows');
        json = Buffer.from(await dpapi(envelope.value, true), 'base64').toString('utf8');
      } else if (envelope.format === 'plain-v1') {
        json = envelope.value;
      } else throw new Error('unknown format');
      const data = JSON.parse(json) as SessionData;
      if (data.version !== 1) throw new Error('unknown version');
      this.cache = data;
      return structuredClone(data);
    } catch {
      throw new TudelftError(
        'INTERNAL_ERROR',
        'The saved session is damaged or was written by another user. Run "tudelft-mcp logout" and sign in again.',
      );
    }
  }

  /** Apply a mutation atomically and persist the result. */
  async update(mutate: (data: SessionData) => void): Promise<SessionData> {
    return this.lane.run(async () => {
      const data = await this.load();
      mutate(data);
      await this.write(data);
      this.cache = data;
      return structuredClone(data);
    });
  }

  async clear(): Promise<void> {
    await this.lane.run(async () => {
      await rm(this.file, { force: true });
      this.cache = structuredClone(EMPTY);
    });
  }

  private async write(data: SessionData): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
    const json = JSON.stringify(data);
    const envelope: Envelope =
      this.platform === 'win32'
        ? { format: 'dpapi-v1', value: await dpapi(Buffer.from(json, 'utf8').toString('base64'), false) }
        : { format: 'plain-v1', value: json };
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(envelope), { mode: 0o600, flag: 'wx' });
      await rename(temp, this.file);
    } finally {
      await rm(temp, { force: true });
    }
  }
}

/** Cookies that apply to a URL right now. */
export function cookiesFor(cookies: Cookie[], url: URL): Cookie[] {
  const now = Date.now() / 1000;
  return cookies.filter((cookie) => {
    if (cookie.expires > 0 && cookie.expires < now) return false;
    const domain = cookie.domain.replace(/^\./, '');
    const hostMatch = cookie.domain.startsWith('.')
      ? url.hostname === domain || url.hostname.endsWith(`.${domain}`)
      : url.hostname === domain;
    if (!hostMatch) return false;
    if (cookie.secure && url.protocol !== 'https:') return false;
    const path = cookie.path || '/';
    return url.pathname === path || url.pathname.startsWith(path.endsWith('/') ? path : `${path}/`);
  });
}

export function cookieHeader(cookies: Cookie[], url: URL): string {
  return cookiesFor(cookies, url)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}
