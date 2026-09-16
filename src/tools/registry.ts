import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { AppContext } from '../context.js';
import { toSafeError } from '../errors.js';

export const READ: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
export const LOCAL: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export interface ToolSpec<S extends z.ZodRawShape> {
  title?: string;
  description: string;
  input: S;
  annotations?: ToolAnnotations;
}

export type ToolHandler<S extends z.ZodRawShape> = (
  args: z.output<z.ZodObject<S>>,
  ctx: AppContext,
) => Promise<unknown> | unknown;

export interface RegisteredToolInfo {
  name: string;
  title?: string;
  description: string;
  annotations?: ToolAnnotations;
  input: z.ZodRawShape;
}

/** Serialise a handler result into an MCP tool result. Errors become structured, never thrown. */
export async function toResult(task: () => Promise<unknown> | unknown): Promise<CallToolResult> {
  try {
    const raw = await task();
    const value: unknown = JSON.parse(JSON.stringify(raw ?? null));
    const structured =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value };
    return { content: [{ type: 'text', text: JSON.stringify(structured) }], structuredContent: structured };
  } catch (error) {
    const failure = toSafeError(error);
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: failure }) }],
      structuredContent: { error: failure },
    };
  }
}

export class ToolRegistry {
  readonly tools: RegisteredToolInfo[] = [];

  constructor(
    private readonly server: McpServer,
    private readonly ctx: AppContext,
  ) {}

  tool<S extends z.ZodRawShape>(name: string, spec: ToolSpec<S>, handler: ToolHandler<S>): void {
    const annotations = spec.annotations ?? READ;
    const info: RegisteredToolInfo = { name, description: spec.description, annotations, input: spec.input };
    if (spec.title) info.title = spec.title;
    this.tools.push(info);
    const config: { title?: string; description: string; inputSchema: S; annotations: ToolAnnotations } = {
      description: spec.description,
      inputSchema: spec.input,
      annotations,
    };
    if (spec.title) config.title = spec.title;
    this.server.registerTool(name, config, (async (args: z.output<z.ZodObject<S>>) =>
      toResult(() => handler(args, this.ctx))) as never);
  }

  prompt(
    name: string,
    description: string,
    args: Record<string, z.ZodTypeAny>,
    build: (values: Record<string, string>) => string,
  ): void {
    this.server.registerPrompt(name, { description, argsSchema: args as never }, ((
      values: Record<string, string>,
    ) => ({
      messages: [{ role: 'user' as const, content: { type: 'text' as const, text: build(values) } }],
    })) as never);
  }

  resource(name: string, uri: string, description: string, read: () => Promise<string> | string): void {
    this.server.registerResource(
      name,
      uri,
      { description, mimeType: 'application/json' },
      async (target) => ({
        contents: [{ uri: target.href, mimeType: 'application/json', text: await read() }],
      }),
    );
  }
}
