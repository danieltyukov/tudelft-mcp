import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AppContext } from '../context.js';

/**
 * The bearer token for the HTTP transport, in order of precedence:
 * the --token flag, TUDELFT_MCP_HTTP_TOKEN, then the token kept in the session file
 * (generated on first use and saved there).
 */
export async function resolveToken(
  ctx: AppContext,
  flag: string | boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
  if (typeof flag === 'string' && flag.trim()) return flag.trim();
  const fromEnv = env.TUDELFT_MCP_HTTP_TOKEN?.trim();
  if (fromEnv) return fromEnv;
  const saved = (await ctx.session.load()).http?.token;
  if (saved) return saved;
  const token = randomBytes(32).toString('base64url');
  await ctx.session.update((data) => {
    data.http = { token, createdAt: new Date().toISOString() };
  });
  return token;
}

/** Constant-time comparison that does not leak the token length either. */
export function tokensMatch(expected: string, given: string): boolean {
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(given).digest();
  return timingSafeEqual(a, b);
}

/** Counts failed authentication attempts per address inside a sliding window. */
export class RateLimiter {
  private readonly attempts = new Map<string, number[]>();

  constructor(
    private readonly limit = 10,
    private readonly windowMs = 60_000,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.limit;
  }

  fail(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.attempts.set(key, list);
    if (this.attempts.size > 10_000) {
      const oldest = this.attempts.keys().next().value;
      if (oldest !== undefined) this.attempts.delete(oldest);
    }
  }

  private recent(key: string, now: number): number[] {
    return (this.attempts.get(key) ?? []).filter((time) => now - time < this.windowMs);
  }
}
