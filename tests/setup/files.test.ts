import { describe, expect, it } from 'vitest';
import { replaceTomlSection, setNested } from '../../src/setup/files.js';

const body = 'command = "tudelft-mcp"\nargs = ["serve"]';
const header = '[mcp_servers.tudelft]';

describe('replaceTomlSection', () => {
  it('appends to an empty or existing document', () => {
    expect(replaceTomlSection('', header, body)).toBe(`${header}\n${body}\n`);
    expect(replaceTomlSection('model = "o3"\n', header, body)).toBe(`model = "o3"\n\n${header}\n${body}\n`);
    expect(replaceTomlSection('model = "o3"', header, body)).toBe(`model = "o3"\n\n${header}\n${body}\n`);
  });

  it('replaces the block up to the next header and keeps everything else', () => {
    const doc = [
      'a = 1',
      '',
      '[ mcp_servers.tudelft ]',
      'command = "old"',
      '',
      '',
      '[[profiles]]',
      'x = 1',
      '',
    ].join('\n');
    expect(replaceTomlSection(doc, header, body)).toBe(
      ['a = 1', '', header, ...body.split('\n'), '', '[[profiles]]', 'x = 1', ''].join('\n'),
    );
  });

  it('replaces a block at the end of the file', () => {
    const doc = ['[other]', 'y = 2', '', header, 'command = "old"', 'args = []'].join('\n');
    expect(replaceTomlSection(doc, header, body)).toBe(
      ['[other]', 'y = 2', '', header, ...body.split('\n'), ''].join('\n'),
    );
  });
});

describe('setNested', () => {
  it('creates intermediate objects and keeps siblings', () => {
    const doc = { mcpServers: { other: { command: 'x' } }, flag: true };
    const next = setNested(doc, ['mcpServers', 'tudelft'], { command: 'y' });
    expect(next).toEqual({ mcpServers: { other: { command: 'x' }, tudelft: { command: 'y' } }, flag: true });
    expect(doc.mcpServers).not.toHaveProperty('tudelft');
    expect(setNested({ mcpServers: 'oops' }, ['mcpServers', 'tudelft'], 1)).toEqual({
      mcpServers: { tudelft: 1 },
    });
  });
});
