import type { AppContext } from '../context.js';
import { toLocal } from '../util/dates.js';
import { array, numericId, plainText, record, str } from '../util/text.js';

export interface Quiz {
  id: string;
  courseId: string;
  name: string;
  active: boolean;
  description: string;
  instructions: string;
  opensAt: string | null;
  closesAt: string | null;
  dueDate: string | null;
  dueLocal?: string;
  attemptsAllowed: number | 'unlimited' | null;
  timeLimitMinutes: number | null;
  gradeItemId: string | null;
  url: string;
}

export function parseQuiz(raw: unknown, courseId: string, origin: string): Quiz | undefined {
  const row = record(raw);
  const id = str(row.QuizId);
  if (!/^\d+$/.test(id)) return undefined;
  const attempts = record(row.AttemptsAllowed);
  const limit = record(row.SubmissionTimeLimit);
  const dueDate = typeof row.DueDate === 'string' ? row.DueDate : null;
  const dueLocal = toLocal(dueDate);
  return {
    id,
    courseId,
    name: str(row.Name).trim(),
    active: row.IsActive !== false,
    description: plainText(record(row.Description).Text ?? row.Description).slice(0, 2000),
    instructions: plainText(record(row.Instructions).Text ?? row.Instructions).slice(0, 2000),
    opensAt: typeof row.StartDate === 'string' ? row.StartDate : null,
    closesAt: typeof row.EndDate === 'string' ? row.EndDate : null,
    dueDate,
    ...(dueLocal ? { dueLocal } : {}),
    attemptsAllowed:
      attempts.IsUnlimited === true
        ? 'unlimited'
        : typeof attempts.NumberOfAttemptsAllowed === 'number'
          ? attempts.NumberOfAttemptsAllowed
          : null,
    timeLimitMinutes:
      limit.IsEnforced === true && typeof limit.TimeLimitValue === 'number' ? limit.TimeLimitValue : null,
    gradeItemId: str(row.GradeItemId) || null,
    url: `${origin}/d2l/lms/quizzing/user/quizzes_list.d2l?ou=${courseId}`,
  };
}

export async function quizzes(
  ctx: AppContext,
  courseId: string,
): Promise<{ items: Quiz[]; complete: boolean }> {
  const id = numericId(courseId, 'course id');
  const result = await ctx.brightspace.list('le', `${id}/quizzes/`);
  return {
    items: result.items
      .map((raw) => parseQuiz(raw, id, ctx.brightspace.origin))
      .filter((quiz): quiz is Quiz => Boolean(quiz)),
    complete: result.complete,
  };
}

export interface Checklist {
  id: string;
  name: string;
  description: string;
  categories: {
    id: string;
    name: string;
    items: {
      id: string;
      name: string;
      description: string;
      dueDate: string | null;
      completed: boolean | null;
    }[];
  }[];
}

export async function checklists(ctx: AppContext, courseId: string): Promise<Checklist[]> {
  const id = numericId(courseId, 'course id');
  const lists = (await ctx.brightspace.list('le', `${id}/checklists/`)).items.map(record);
  const out: Checklist[] = [];
  for (const list of lists.slice(0, 50)) {
    const listId = str(list.ChecklistId);
    if (!/^\d+$/.test(listId)) continue;
    const categories = (
      await ctx.brightspace
        .list('le', `${id}/checklists/${listId}/categories/`)
        .catch(() => ({ items: [] as unknown[] }))
    ).items.map(record);
    const items = (
      await ctx.brightspace
        .list('le', `${id}/checklists/${listId}/items/`)
        .catch(() => ({ items: [] as unknown[] }))
    ).items.map(record);
    out.push({
      id: listId,
      name: str(list.Name),
      description: plainText(list.Description).slice(0, 1000),
      categories: categories.map((category) => ({
        id: str(category.CategoryId),
        name: str(category.Name),
        items: items
          .filter((item) => str(item.CategoryId) === str(category.CategoryId))
          .map((item) => ({
            id: str(item.ChecklistItemId),
            name: str(item.Name),
            description: plainText(item.Description).slice(0, 500),
            dueDate: typeof item.DueDate === 'string' ? item.DueDate : null,
            completed: typeof item.IsCompleted === 'boolean' ? item.IsCompleted : null,
          })),
      })),
    });
    const uncategorised = items.filter(
      (item) => !categories.some((category) => str(category.CategoryId) === str(item.CategoryId)),
    );
    if (uncategorised.length) {
      out[out.length - 1]!.categories.push({
        id: '',
        name: 'Items',
        items: uncategorised.map((item) => ({
          id: str(item.ChecklistItemId),
          name: str(item.Name),
          description: plainText(item.Description).slice(0, 500),
          dueDate: typeof item.DueDate === 'string' ? item.DueDate : null,
          completed: typeof item.IsCompleted === 'boolean' ? item.IsCompleted : null,
        })),
      });
    }
  }
  return out;
}

export { array };
