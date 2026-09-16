import { describe, expect, it } from 'vitest';
import { redactLinks, safeLink, sameOrigin } from '../../src/util/url.js';

describe('safeLink', () => {
  it('keeps ordinary links and drops fragments', () => {
    expect(safeLink('https://brightspace.tudelft.nl/d2l/home/1#top')).toBe(
      'https://brightspace.tudelft.nl/d2l/home/1',
    );
  });
  it('removes credential-like query parameters', () => {
    const cleaned = safeLink(
      'https://x.tudelft.nl/launch?ou=5&token=abc&access_token=zzz&d2l_referrer_auth=q&SAMLResponse=r&x-amz-signature=s',
    );
    expect(cleaned).toBe('https://x.tudelft.nl/launch?ou=5');
  });
  it('rejects non-http and embedded credentials', () => {
    expect(safeLink('javascript:alert(1)')).toBeUndefined();
    expect(safeLink('https://user:pw@host/')).toBeUndefined();
    expect(safeLink('')).toBeUndefined();
  });
  it('resolves relative links against a base', () => {
    expect(safeLink('/d2l/le/content/1/Home', 'https://brightspace.tudelft.nl')).toBe(
      'https://brightspace.tudelft.nl/d2l/le/content/1/Home',
    );
  });
});

describe('redactLinks', () => {
  it('cleans links embedded in text', () => {
    expect(redactLinks('see https://a.nl/x?token=1&y=2 now')).toBe('see https://a.nl/x?y=2 now');
  });
});

describe('sameOrigin', () => {
  it('accepts same origin and rejects others', () => {
    expect(sameOrigin('/d2l/api/lp/1.63/users/whoami', 'https://brightspace.tudelft.nl').href).toContain(
      '/users/whoami',
    );
    expect(() => sameOrigin('https://evil.example/x', 'https://brightspace.tudelft.nl')).toThrow(
      /another service/,
    );
  });
});
