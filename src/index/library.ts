import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import MiniSearch from 'minisearch';
import { snippet } from '../util/text.js';
import { Lane } from '../util/paging.js';

export interface IndexedDocument {
  /** Stable id such as "774356:topic:123456" */
  id: string;
  courseId: string;
  kind: string;
  title: string;
  url: string;
  text: string;
  fetchedAt: string;
}

export interface SearchHit {
  id: string;
  courseId: string;
  kind: string;
  title: string;
  url: string;
  snippet: string;
  score: number;
  chunk: number;
  fetchedAt: string;
  readWith?: { tool: string; arguments: Record<string, string> };
}

interface StoredDocument extends Omit<IndexedDocument, 'text'> {
  chunks: string[];
}

interface Chunk {
  id: string;
  doc: string;
  courseId: string;
  kind: string;
  title: string;
  text: string;
  n: number;
}

interface FileFormat {
  version: 1;
  documents: StoredDocument[];
}

const CHUNK = 1400;
const OVERLAP = 150;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r/g, '').trim();
  if (!clean) return [];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(clean.length, start + CHUNK);
    if (end < clean.length) {
      const cut = clean.lastIndexOf('\n', end);
      if (cut > start + CHUNK / 2) end = cut;
      else {
        const space = clean.lastIndexOf(' ', end);
        if (space > start + CHUNK / 2) end = space;
      }
    }
    chunks.push(clean.slice(start, end).trim());
    if (end >= clean.length) break;
    start = Math.max(end - OVERLAP, start + 1);
  }
  return chunks.filter(Boolean);
}

/** Map an index id back to the tool that can re-read the live source. */
export function readTarget(id: string, courseId: string): SearchHit['readWith'] | undefined {
  const [scope, type, a, b, c] = id.split(':');
  if (scope !== courseId) return undefined;
  const base = { courseId };
  if (type === 'topic' && a) return { tool: 'read_material', arguments: { ...base, topicId: a } };
  if (type === 'module') return { tool: 'get_course_content', arguments: base };
  if (type === 'news' && a) return { tool: 'get_announcements', arguments: base };
  if (type === 'newsfile' && a && b)
    return { tool: 'read_announcement_attachment', arguments: { ...base, announcementId: a, fileId: b } };
  if (type === 'assignment' && a) return { tool: 'get_assignment', arguments: { ...base, assignmentId: a } };
  if (type === 'assignmentfile' && a && b)
    return { tool: 'read_assignment_attachment', arguments: { ...base, assignmentId: a, fileId: b } };
  if (type === 'submissionfile' && a && b && c)
    return {
      tool: 'read_my_submission_file',
      arguments: { ...base, assignmentId: a, submissionId: b, fileId: c },
    };
  if (type === 'feedbackfile' && a && b)
    return { tool: 'read_feedback_file', arguments: { ...base, assignmentId: a, fileId: b } };
  if (type === 'lockerfile' && a && b)
    return {
      tool: 'read_locker_file',
      arguments: { ...base, groupId: a, path: Buffer.from(b, 'base64url').toString('utf8') },
    };
  return undefined;
}

/**
 * Full-text index of everything read from one account, stored as JSON and
 * searched with MiniSearch (BM25 with prefix and fuzzy matching).
 */
export class Library {
  private documents = new Map<string, StoredDocument>();
  private index = this.newIndex();
  private loaded = false;
  private lane = new Lane();

  constructor(readonly file: string) {}

  private newIndex(): MiniSearch<Chunk> {
    return new MiniSearch<Chunk>({
      fields: ['title', 'text'],
      storeFields: ['doc', 'courseId', 'kind', 'title', 'n'],
      searchOptions: { boost: { title: 2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
      tokenize: (value) => value.toLowerCase().match(/[\p{L}\p{N}]+(?:[.'_-][\p{L}\p{N}]+)*/gu) ?? [],
    });
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      return;
    }
    try {
      const data = JSON.parse(raw) as FileFormat;
      if (data.version !== 1 || !Array.isArray(data.documents)) return;
      for (const doc of data.documents) this.documents.set(doc.id, doc);
      this.rebuild();
    } catch {
      this.documents.clear();
    }
  }

  private rebuild(): void {
    this.index = this.newIndex();
    const chunks: Chunk[] = [];
    for (const doc of this.documents.values()) {
      doc.chunks.forEach((text, n) =>
        chunks.push({
          id: `${doc.id}#${n}`,
          doc: doc.id,
          courseId: doc.courseId,
          kind: doc.kind,
          title: doc.title,
          text,
          n,
        }),
      );
    }
    this.index.addAll(chunks);
  }

  private async persist(): Promise<void> {
    await this.lane.run(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });
      const data: FileFormat = { version: 1, documents: [...this.documents.values()] };
      const temp = `${this.file}.tmp`;
      await writeFile(temp, JSON.stringify(data), { mode: 0o600 });
      await rename(temp, this.file);
    });
  }

  async put(doc: IndexedDocument): Promise<void> {
    await this.load();
    const previous = this.documents.get(doc.id);
    if (previous) previous.chunks.forEach((_, n) => this.index.discard(`${doc.id}#${n}`));
    const chunks = chunkText(doc.text);
    const stored: StoredDocument = {
      id: doc.id,
      courseId: doc.courseId,
      kind: doc.kind,
      title: doc.title,
      url: doc.url,
      fetchedAt: doc.fetchedAt,
      chunks,
    };
    this.documents.set(doc.id, stored);
    this.index.addAll(
      chunks.map((text, n) => ({
        id: `${doc.id}#${n}`,
        doc: doc.id,
        courseId: doc.courseId,
        kind: doc.kind,
        title: doc.title,
        text,
        n,
      })),
    );
    await this.persist();
  }

  async putMany(docs: IndexedDocument[]): Promise<void> {
    await this.load();
    for (const doc of docs) {
      const previous = this.documents.get(doc.id);
      if (previous) previous.chunks.forEach((_, n) => this.index.discard(`${doc.id}#${n}`));
      const chunks = chunkText(doc.text);
      this.documents.set(doc.id, {
        id: doc.id,
        courseId: doc.courseId,
        kind: doc.kind,
        title: doc.title,
        url: doc.url,
        fetchedAt: doc.fetchedAt,
        chunks,
      });
      this.index.addAll(
        chunks.map((text, n) => ({
          id: `${doc.id}#${n}`,
          doc: doc.id,
          courseId: doc.courseId,
          kind: doc.kind,
          title: doc.title,
          text,
          n,
        })),
      );
    }
    await this.persist();
  }

  async has(id: string): Promise<boolean> {
    await this.load();
    return this.documents.has(id);
  }

  async search(
    query: string,
    options: { courseId?: string; kind?: string; limit?: number; perDocument?: number } = {},
  ): Promise<SearchHit[]> {
    await this.load();
    const limit = Math.max(1, Math.min(50, options.limit ?? 10));
    const results = this.index.search(query, {
      filter: (result) =>
        (!options.courseId || result.courseId === options.courseId) &&
        (!options.kind || result.kind === options.kind),
    });
    const hits: SearchHit[] = [];
    const seenDocs = new Map<string, number>();
    for (const result of results) {
      const docId = String(result.doc);
      const perDoc = seenDocs.get(docId) ?? 0;
      if (perDoc >= (options.perDocument ?? 1)) continue;
      seenDocs.set(docId, perDoc + 1);
      const doc = this.documents.get(docId);
      if (!doc) continue;
      const n = Number(result.n);
      const hit: SearchHit = {
        id: doc.id,
        courseId: doc.courseId,
        kind: doc.kind,
        title: doc.title,
        url: doc.url,
        snippet: snippet(doc.chunks[n] ?? '', query),
        score: Math.round(result.score * 100) / 100,
        chunk: n,
        fetchedAt: doc.fetchedAt,
      };
      const readWith = readTarget(doc.id, doc.courseId);
      if (readWith) hit.readWith = readWith;
      hits.push(hit);
      if (hits.length >= limit) break;
    }
    return hits;
  }

  async coverage(
    courseId?: string,
  ): Promise<
    Array<{ courseId: string; kind: string; documents: number; chunks: number; latestFetch: string }>
  > {
    await this.load();
    const groups = new Map<
      string,
      { courseId: string; kind: string; documents: number; chunks: number; latestFetch: string }
    >();
    for (const doc of this.documents.values()) {
      if (courseId && doc.courseId !== courseId) continue;
      const key = `${doc.courseId}:${doc.kind}`;
      const group = groups.get(key) ?? {
        courseId: doc.courseId,
        kind: doc.kind,
        documents: 0,
        chunks: 0,
        latestFetch: '',
      };
      group.documents++;
      group.chunks += doc.chunks.length;
      if (doc.fetchedAt > group.latestFetch) group.latestFetch = doc.fetchedAt;
      groups.set(key, group);
    }
    return [...groups.values()].sort(
      (a, b) => a.courseId.localeCompare(b.courseId) || a.kind.localeCompare(b.kind),
    );
  }

  async clear(courseId?: string): Promise<number> {
    await this.load();
    let removed = 0;
    for (const [id, doc] of this.documents) {
      if (courseId && doc.courseId !== courseId) continue;
      this.documents.delete(id);
      removed++;
    }
    this.rebuild();
    if (this.documents.size === 0) await rm(this.file, { force: true });
    else await this.persist();
    return removed;
  }

  get size(): number {
    return this.documents.size;
  }
}
