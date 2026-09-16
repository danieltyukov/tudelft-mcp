import type { Cookie } from '../auth/session.js';
import { TudelftError } from '../errors.js';

/**
 * Read a response body as text while enforcing a byte limit. The declared
 * content-length is checked first, then the stream is counted as it arrives.
 */
export async function readBounded(response: Response, maxBytes: number, label = 'response'): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new TudelftError('FILE_TOO_LARGE', `The ${label} is larger than the ${mb(maxBytes)} MB limit.`);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new TudelftError('FILE_TOO_LARGE', `The ${label} is larger than the ${mb(maxBytes)} MB limit.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function mb(bytes: number): string {
  return String(Math.round((bytes / 1048576) * 10) / 10);
}

export function isJson(response: Response): boolean {
  return (response.headers.get('content-type') ?? '').toLowerCase().includes('json');
}

/** Parse one Set-Cookie header into the stored cookie shape. Returns undefined for malformed input. */
export function parseSetCookie(header: string, url: URL): Cookie | undefined {
  const [pair, ...attributes] = header.split(';');
  const eq = (pair ?? '').indexOf('=');
  if (eq <= 0) return undefined;
  const name = pair!.slice(0, eq).trim();
  const value = pair!.slice(eq + 1).trim();
  if (!name) return undefined;
  const cookie: Cookie = {
    name,
    value,
    domain: url.hostname,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
  };
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split('=');
    const key = (rawKey ?? '').trim().toLowerCase();
    const rawValue = rest.join('=').trim();
    if (key === 'path' && rawValue.startsWith('/')) cookie.path = rawValue;
    else if (key === 'domain' && rawValue)
      cookie.domain = rawValue.startsWith('.') ? rawValue : `.${rawValue}`;
    else if (key === 'max-age' && /^-?\d+$/.test(rawValue))
      cookie.expires = Math.floor(Date.now() / 1000) + Number(rawValue);
    else if (key === 'expires' && cookie.expires === -1) {
      const time = Date.parse(rawValue);
      if (Number.isFinite(time)) cookie.expires = Math.floor(time / 1000);
    } else if (key === 'secure') cookie.secure = true;
    else if (key === 'httponly') cookie.httpOnly = true;
    else if (key === 'samesite') {
      const mode = rawValue.toLowerCase();
      if (mode === 'strict') cookie.sameSite = 'Strict';
      else if (mode === 'lax') cookie.sameSite = 'Lax';
      else if (mode === 'none') cookie.sameSite = 'None';
    }
  }
  return cookie;
}

/** Merge freshly received cookies into a stored list, replacing same name, domain and path. */
export function mergeCookies(existing: Cookie[], incoming: Cookie[]): Cookie[] {
  const key = (cookie: Cookie): string => `${cookie.name}|${cookie.domain.replace(/^\./, '')}|${cookie.path}`;
  const merged = new Map(existing.map((cookie) => [key(cookie), cookie]));
  for (const cookie of incoming) merged.set(key(cookie), cookie);
  return [...merged.values()];
}
