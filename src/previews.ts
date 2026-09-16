import { randomBytes } from 'node:crypto';
import { TudelftError } from './errors.js';

export interface Preview<T> {
  token: string;
  kind: string;
  payload: T;
  expiresAt: number;
  accountId: string;
}

const TTL_MS = 5 * 60_000;
const MAX = 50;

/**
 * Holds previews for write actions. A preview is created by a prepare_* tool,
 * shown to the student, and consumed exactly once by the matching confirm_* tool.
 */
export class PreviewStore {
  private previews = new Map<string, Preview<unknown>>();

  create<T>(kind: string, accountId: string, payload: T): Preview<T> {
    this.sweep();
    if (this.previews.size >= MAX)
      throw new TudelftError('RATE_LIMITED', 'Too many pending previews. Wait for old ones to expire.');
    const preview: Preview<T> = {
      token: randomBytes(24).toString('base64url'),
      kind,
      payload,
      expiresAt: Date.now() + TTL_MS,
      accountId,
    };
    this.previews.set(preview.token, preview as Preview<unknown>);
    return preview;
  }

  /** Remove and return the preview. Removal happens before any await so a token cannot be replayed. */
  consume<T>(token: string, kind: string, accountId: string, confirmed: boolean): Preview<T> {
    if (confirmed !== true)
      throw new TudelftError(
        'CONFIRMATION_REQUIRED',
        'Show the preview to the student and call again with confirmed: true only after they approve.',
      );
    const preview = this.previews.get(token);
    this.previews.delete(token);
    if (!preview || preview.kind !== kind || preview.expiresAt <= Date.now()) {
      throw new TudelftError(
        'PREVIEW_EXPIRED',
        'This preview is missing or expired. Prepare it again and ask for approval.',
      );
    }
    if (preview.accountId !== accountId)
      throw new TudelftError('ACCOUNT_CHANGED', 'The preview belongs to a different account.');
    return preview as Preview<T>;
  }

  clear(): void {
    this.previews.clear();
  }

  private sweep(): void {
    const now = Date.now();
    for (const [token, preview] of this.previews) if (preview.expiresAt <= now) this.previews.delete(token);
  }
}
