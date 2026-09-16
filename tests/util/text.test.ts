import { describe, expect, it } from 'vitest';
import { numericId, plainText, snippet } from '../../src/util/text.js';

describe('plainText', () => {
  it('flattens Brightspace rich text objects', () => {
    expect(
      plainText({ Text: 'ignored', Html: '<p>Hello <b>world</b></p><ul><li>a</li><li>b</li></ul>' }),
    ).toBe('Hello world\na\nb');
  });
  it('drops scripts and keeps plain strings', () => {
    expect(plainText('<script>x()</script>Text<br>line')).toBe('Text\nline');
    expect(plainText('  simple   text ')).toBe('simple text');
  });
});

describe('numericId', () => {
  it('accepts numbers and digit strings only', () => {
    expect(numericId(774356)).toBe('774356');
    expect(() => numericId('abc')).toThrow();
  });
});

describe('snippet', () => {
  it('centres on the first match', () => {
    const text = 'a'.repeat(300) + ' target word ' + 'b'.repeat(300);
    expect(snippet(text, 'target', 100)).toContain('target');
  });
});
