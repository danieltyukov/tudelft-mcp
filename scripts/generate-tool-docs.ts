/**
 * Generates docs/tools.md from the registered tool definitions.
 *
 * Run with `npm run docs:tools`. Builds the server against a temporary data
 * directory so nothing on the machine is read or written.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { createContext } from '../src/context.js';
import { installExtensions } from '../src/extensions.js';
import { createServer } from '../src/server.js';
import type { RegisteredToolInfo } from '../src/tools/registry.js';

interface JsonSchema {
  type?: string | string[];
  description?: string;
  default?: unknown;
  const?: unknown;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}

interface FieldDoc {
  name: string;
  type: string;
  required: boolean;
  defaultValue: string;
  description: string;
}

const OUTPUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'tools.md');

function jsonType(schema: JsonSchema): string {
  if (schema.const !== undefined) return JSON.stringify(schema.const);
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' or ');
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants) {
    const names = variants.map(jsonType).filter((name, index, all) => all.indexOf(name) === index);
    return names.join(' or ');
  }
  if (Array.isArray(schema.type)) return schema.type.join(' or ');
  if (schema.type === 'array') return `${schema.items ? jsonType(schema.items) : 'unknown'}[]`;
  return schema.type ?? 'unknown';
}

/** Fallback when z.toJSONSchema is not available: walk the zod definition. */
function zodType(schema: unknown): string {
  let current = schema as
    | {
        _zod?: { def?: { type?: string; innerType?: unknown; element?: unknown; values?: unknown[] } };
        _def?: { typeName?: string; innerType?: unknown };
      }
    | undefined;
  for (let depth = 0; current && depth < 12; depth++) {
    const def = current._zod?.def;
    if (def) {
      if (
        def.innerType &&
        ['optional', 'default', 'nullable', 'readonly', 'catch'].includes(def.type ?? '')
      ) {
        current = def.innerType as typeof current;
        continue;
      }
      if (def.type === 'array') return `${zodType(def.element)}[]`;
      if (def.type === 'enum' && def.values) return def.values.map((v) => JSON.stringify(v)).join(' or ');
      return def.type ?? 'unknown';
    }
    const legacy = current._def;
    if (legacy?.typeName) {
      if (legacy.innerType) {
        current = legacy.innerType as typeof current;
        continue;
      }
      return legacy.typeName.replace(/^Zod/, '').toLowerCase();
    }
    return 'unknown';
  }
  return 'unknown';
}

function describeFields(input: z.ZodRawShape): FieldDoc[] {
  const names = Object.keys(input);
  if (names.length === 0) return [];
  const converter = (z as unknown as { toJSONSchema?: (schema: unknown, options?: unknown) => JsonSchema })
    .toJSONSchema;
  let jsonSchema: JsonSchema | undefined;
  if (typeof converter === 'function') {
    try {
      jsonSchema = converter(z.object(input), { io: 'input', unrepresentable: 'any' });
    } catch {
      jsonSchema = undefined;
    }
  }
  const required = new Set(jsonSchema?.required ?? []);
  return names.map((name) => {
    const field = jsonSchema?.properties?.[name];
    const raw = input[name] as { description?: string } | undefined;
    const description = field?.description ?? raw?.description ?? '';
    const type = field ? jsonType(field) : zodType(input[name]);
    const defaultValue = field && field.default !== undefined ? JSON.stringify(field.default) : '';
    return { name, type, required: field ? required.has(name) : false, defaultValue, description };
  });
}

function annotationSummary(annotations: ToolAnnotations | undefined): string {
  if (!annotations) return 'none';
  const parts: string[] = [];
  parts.push(annotations.readOnlyHint ? 'read-only' : 'may write');
  if (annotations.destructiveHint) parts.push('destructive');
  parts.push(annotations.idempotentHint ? 'idempotent' : 'not idempotent');
  parts.push(annotations.openWorldHint ? 'talks to the university' : 'local only');
  return parts.join(', ');
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function firstSentence(text: string): string {
  const match = /^(.*?[.!?])(\s|$)/.exec(text);
  return (match ? match[1] : text) ?? text;
}

function renderTool(tool: RegisteredToolInfo): string {
  const lines: string[] = [];
  lines.push(`## ${tool.name}`);
  lines.push('');
  if (tool.title) {
    lines.push(`**${cell(tool.title)}**`);
    lines.push('');
  }
  lines.push(tool.description.trim());
  lines.push('');
  lines.push(`Annotations: ${annotationSummary(tool.annotations)}.`);
  lines.push('');
  const fields = describeFields(tool.input);
  if (fields.length === 0) {
    lines.push('No input.');
  } else {
    lines.push('| Input | Type | Required | Default | Description |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const field of fields) {
      lines.push(
        `| \`${field.name}\` | ${cell(field.type)} | ${field.required ? 'yes' : 'no'} | ${
          field.defaultValue ? `\`${cell(field.defaultValue)}\`` : ''
        } | ${cell(field.description)} |`,
      );
    }
  }
  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'tudelft-mcp-docs-'));
  const ctx = createContext(loadConfig({ TUDELFT_MCP_HOME: dir }));
  try {
    installExtensions(ctx);
    const { registry } = createServer(ctx);
    const tools = registry.tools;
    const out: string[] = [];
    out.push('# Tools');
    out.push('');
    out.push(
      'Generated from the registered tool definitions by `npm run docs:tools`. Do not edit by hand; change the tool file under `src/tools/` and regenerate.',
    );
    out.push('');
    out.push(`${tools.length} tools.`);
    out.push('');
    out.push('| Tool | Summary |');
    out.push('| --- | --- |');
    for (const tool of tools) {
      out.push(`| [\`${tool.name}\`](#${tool.name}) | ${cell(firstSentence(tool.description))} |`);
    }
    out.push('');
    for (const tool of tools) out.push(renderTool(tool));
    await writeFile(OUTPUT, `${out.join('\n').trimEnd()}\n`, 'utf8');
    process.stdout.write(`Wrote ${OUTPUT} (${tools.length} tools)\n`);
  } finally {
    await ctx.close().catch(() => undefined);
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().then(
  () => {
    process.exitCode = 0;
  },
  (error: unknown) => {
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    process.exitCode = 1;
  },
);
