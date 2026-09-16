import { join } from 'node:path';
import type { AppContext } from '../context.js';
import { sha256 } from '../util/text.js';
import { Library } from './library.js';

const libraries = new WeakMap<AppContext, Map<string, Library>>();

/** The search index for the signed-in Brightspace account. */
export async function getLibrary(ctx: AppContext): Promise<Library> {
  const identity = await ctx.brightspace.identity();
  const key = sha256(`${ctx.config.brightspaceUrl}:${identity.id}`).slice(0, 16);
  let perContext = libraries.get(ctx);
  if (!perContext) {
    perContext = new Map();
    libraries.set(ctx, perContext);
  }
  let library = perContext.get(key);
  if (!library) {
    library = new Library(join(ctx.config.indexDir, `${key}.json`));
    perContext.set(key, library);
  }
  return library;
}

export function accountKey(ctx: AppContext, accountId: string): string {
  return sha256(`${ctx.config.brightspaceUrl}:${accountId}`).slice(0, 16);
}
