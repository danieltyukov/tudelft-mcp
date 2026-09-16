import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { toLocal } from '../util/dates.js';
import { numericId, plainText, record, str } from '../util/text.js';

export interface GradeItem {
  id: string;
  name: string;
  type: string;
  categoryId: string | null;
  maxPoints: number | null;
  weight: number | null;
  bonus: boolean;
  description: string;
}

export interface GradeValue {
  id: string;
  name: string;
  type: string;
  displayed: string;
  points: number | null;
  maxPoints: number | null;
  percentage: number | null;
  weightedPoints: number | null;
  weightedMax: number | null;
  comments: string;
  releasedAt: string | null;
  lastModified: string | null;
  lastModifiedLocal?: string;
}

export function parseGradeItem(raw: unknown): GradeItem | undefined {
  const row = record(raw);
  const id = str(row.Id);
  if (!/^\d+$/.test(id) || row.IsHidden === true) return undefined;
  return {
    id,
    name: str(row.Name).trim(),
    type: str(row.GradeType) || 'Unknown',
    categoryId: str(row.CategoryId) || null,
    maxPoints: typeof row.MaxPoints === 'number' ? row.MaxPoints : null,
    weight: typeof row.Weight === 'number' ? row.Weight : null,
    bonus: row.IsBonus === true,
    description: plainText(row.Description).slice(0, 1000),
  };
}

export function parseGradeValue(raw: unknown): GradeValue | undefined {
  const row = record(raw);
  const id = str(row.GradeObjectIdentifier);
  if (!/^\d+$/.test(id)) return undefined;
  const points = typeof row.PointsNumerator === 'number' ? row.PointsNumerator : null;
  const maxPoints = typeof row.PointsDenominator === 'number' ? row.PointsDenominator : null;
  const lastModified = typeof row.LastModified === 'string' ? row.LastModified : null;
  const local = toLocal(lastModified);
  return {
    id,
    name: str(row.GradeObjectName).trim(),
    type: str(row.GradeObjectTypeName) || 'Unknown',
    displayed: plainText(row.DisplayedGrade),
    points,
    maxPoints,
    percentage: points !== null && maxPoints ? Math.round((points / maxPoints) * 1000) / 10 : null,
    weightedPoints: typeof row.WeightedNumerator === 'number' ? row.WeightedNumerator : null,
    weightedMax: typeof row.WeightedDenominator === 'number' ? row.WeightedDenominator : null,
    comments: plainText(row.Comments).slice(0, 2000),
    releasedAt: typeof row.ReleasedDate === 'string' ? row.ReleasedDate : null,
    lastModified,
    ...(local ? { lastModifiedLocal: local } : {}),
  };
}

export interface GradeSummary {
  gradedItems: number;
  totalItems: number;
  pointsEarned: number;
  pointsPossible: number;
  simpleAverage: number | null;
  weightedAverage: number | null;
  note: string;
}

/** Combine item definitions and released values into a plain summary. Weighted average uses Brightspace's own weighted numerators when present. */
export function summarise(items: GradeItem[], values: GradeValue[]): GradeSummary {
  const graded = values.filter((value) => value.points !== null && value.maxPoints);
  const pointsEarned = graded.reduce((sum, value) => sum + (value.points ?? 0), 0);
  const pointsPossible = graded.reduce((sum, value) => sum + (value.maxPoints ?? 0), 0);
  const weighted = graded.filter((value) => value.weightedPoints !== null && value.weightedMax);
  const weightedEarned = weighted.reduce((sum, value) => sum + (value.weightedPoints ?? 0), 0);
  const weightedPossible = weighted.reduce((sum, value) => sum + (value.weightedMax ?? 0), 0);
  const numericItems = items.filter((item) => ['Numeric', 'SelectBox', 'PassFail'].includes(item.type));
  return {
    gradedItems: graded.length,
    totalItems: numericItems.length || items.length,
    pointsEarned,
    pointsPossible,
    simpleAverage: pointsPossible ? Math.round((pointsEarned / pointsPossible) * 1000) / 10 : null,
    weightedAverage: weightedPossible ? Math.round((weightedEarned / weightedPossible) * 1000) / 10 : null,
    note: 'Averages cover released items only and follow the Brightspace gradebook, which may differ from the official OSIRIS result. Unreleased items are not counted.',
  };
}

export async function courseGrades(ctx: AppContext, courseId: string): Promise<Record<string, unknown>> {
  const id = numericId(courseId, 'course id');
  const [itemsResult, valuesResult] = await Promise.all([
    ctx.brightspace.list('le', `${id}/grades/`),
    ctx.brightspace.list('le', `${id}/grades/values/myGradeValues/`),
  ]);
  const items = itemsResult.items.map(parseGradeItem).filter((item): item is GradeItem => Boolean(item));
  const values = valuesResult.items
    .map(parseGradeValue)
    .filter((value): value is GradeValue => Boolean(value));
  let finalGrade: GradeValue | null = null;
  try {
    finalGrade =
      parseGradeValue(await ctx.brightspace.get('le', `${id}/grades/final/values/myGradeValue`)) ?? null;
  } catch (error) {
    if (!(error instanceof TudelftError) || !['NOT_FOUND', 'PERMISSION_DENIED'].includes(error.code))
      throw error;
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const merged = values.map((value) => {
    const item = byId.get(value.id);
    return item ? { ...value, weight: item.weight, categoryId: item.categoryId, bonus: item.bonus } : value;
  });
  const ungraded = items.filter(
    (item) => !values.some((value) => value.id === item.id) && item.type !== 'Calculated',
  );
  return {
    courseId: id,
    url: `${ctx.brightspace.origin}/d2l/lms/grades/my_grades/main.d2l?ou=${id}`,
    finalGrade,
    values: merged,
    ungradedItems: ungraded,
    summary: summarise(items, values),
    fetchedAt: new Date().toISOString(),
  };
}
