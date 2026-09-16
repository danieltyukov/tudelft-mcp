import { TudelftError } from '../errors.js';
import { str } from './text.js';

const CREDENTIAL_PARAM =
  /^(?:token|access_?token|id_?token|refresh_?token|auth|authorization|code|state|nonce|key|api_?key|access_?key|client_?id|client_?secret|d2l_?referrer_?auth|jwt|ltik|sig|signature|credentials?|assertion|login_?hint|lti_?message_?hint|relay_?state|verification_?code|enrol?l?ment_?key|session|session_?id|ticket|saml_?request|saml_?response|x-amz-.*|x-goog-.*)$/i;

/** Parse a URL that must belong to the given origin. */
export function sameOrigin(input: string, origin: string): URL {
  let url: URL;
  try {
    url = new URL(input, origin);
  } catch {
    throw new TudelftError('INVALID_URL', 'The URL is not valid.');
  }
  if (url.origin !== origin || url.username || url.password || url.protocol !== 'https:') {
    throw new TudelftError(
      'EXTERNAL_RESOURCE',
      'This link belongs to another service; university credentials are not sent to it.',
      {
        origin: url.origin,
      },
    );
  }
  return url;
}

/**
 * Return a link that is safe to show to a model: http(s) only, no embedded
 * credentials, and query parameters that look like tokens removed.
 */
export function safeLink(input: unknown, base?: string): string | undefined {
  const raw = str(input).trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return undefined;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined;
  for (const key of [...url.searchParams.keys()]) {
    const normalized = key.replace(/[-_.]/g, '').toLowerCase();
    if (
      CREDENTIAL_PARAM.test(key) ||
      CREDENTIAL_PARAM.test(normalized) ||
      /(?:token|secret|signature|saml|session)/.test(normalized)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.hash = '';
  return url.href;
}

/** Replace every URL inside free text with its safe form. */
export function redactLinks(text: string): string {
  return text.replace(/https?:\/\/[^\s<>"'\])]+/gi, (url) => safeLink(url) ?? '[link removed]');
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
