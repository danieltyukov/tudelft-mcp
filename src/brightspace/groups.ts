import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { array, numericId, plainText, record, str } from '../util/text.js';
import { readFileResource } from './content.js';

const ENROLLMENT_STYLES: Record<number, string> = {
  0: 'instructor',
  1: 'self_enrollment',
  2: 'self_enrollment',
  3: 'auto',
  4: 'self_enrollment',
  5: 'auto',
};

export interface GroupCategory {
  categoryId: string;
  name: string;
  description: string;
  enrollmentStyle: string;
  selfEnrollment: boolean;
  maxUsersPerGroup: number | null;
  selfEnrollmentExpires: string | null;
  groupIds: string[];
}

export interface Group {
  groupId: string;
  categoryId: string;
  name: string;
  description: string;
  code: string;
  memberCount: number;
  member: boolean;
}

export function parseCategory(raw: unknown): GroupCategory | undefined {
  const row = record(raw);
  const categoryId = str(row.GroupCategoryId);
  if (!/^\d+$/.test(categoryId)) return undefined;
  const style = Number(row.EnrollmentStyle);
  return {
    categoryId,
    name: str(row.Name),
    description: plainText(row.Description).slice(0, 1000),
    enrollmentStyle: ENROLLMENT_STYLES[style] ?? `style_${style}`,
    selfEnrollment: [1, 2, 4].includes(style),
    maxUsersPerGroup: typeof row.MaxUsersPerGroup === 'number' ? row.MaxUsersPerGroup : null,
    selfEnrollmentExpires:
      typeof row.SelfEnrollmentExpiryDate === 'string' ? row.SelfEnrollmentExpiryDate : null,
    groupIds: array(row.Groups)
      .map(str)
      .filter((value) => /^\d+$/.test(value)),
  };
}

export function parseGroup(raw: unknown, categoryId: string, userId: string): Group | undefined {
  const row = record(raw);
  const groupId = str(row.GroupId);
  if (!/^\d+$/.test(groupId)) return undefined;
  const members = array(row.Enrollments).map(str);
  return {
    groupId,
    categoryId,
    name: str(row.Name),
    description: plainText(row.Description).slice(0, 500),
    code: str(row.Code),
    memberCount: members.length,
    member: members.includes(userId),
  };
}

export async function myGroups(ctx: AppContext, courseId: string, categoryId?: string) {
  const id = numericId(courseId, 'course id');
  const identity = await ctx.brightspace.identity();
  const categories = (await ctx.brightspace.list('lp', `${id}/groupcategories/`)).items
    .map(parseCategory)
    .filter((category): category is GroupCategory => Boolean(category));
  const selected = categoryId
    ? categories.filter((category) => category.categoryId === numericId(categoryId, 'category id'))
    : categories;
  const out = [];
  for (const category of selected) {
    let groups: Group[] = [];
    let error: string | undefined;
    try {
      groups = (
        await ctx.brightspace.list('lp', `${id}/groupcategories/${category.categoryId}/groups/`)
      ).items
        .map((raw) => parseGroup(raw, category.categoryId, identity.id))
        .filter((group): group is Group => Boolean(group));
    } catch (failure) {
      error = failure instanceof TudelftError ? failure.code : 'INTERNAL_ERROR';
    }
    out.push({
      ...category,
      groups,
      myGroups: groups.filter((group) => group.member),
      ...(error ? { error } : {}),
    });
  }
  return {
    courseId: id,
    categories: out,
    url: `${ctx.brightspace.origin}/d2l/lms/group/user_group_list.d2l?ou=${id}`,
  };
}

export async function availableGroups(ctx: AppContext, courseId: string, categoryId?: string) {
  const all = await myGroups(ctx, courseId, categoryId);
  const categories = all.categories
    .filter((category) => category.selfEnrollment)
    .map((category) => ({
      ...category,
      groups: category.groups.map((group) => ({
        ...group,
        full: category.maxUsersPerGroup !== null && group.memberCount >= category.maxUsersPerGroup,
        joinable:
          !group.member &&
          (category.maxUsersPerGroup === null || group.memberCount < category.maxUsersPerGroup),
      })),
      alreadyMember: category.myGroups.length > 0,
    }));
  return {
    courseId: all.courseId,
    categories,
    url: all.url,
    note: 'Only categories that allow self-enrollment are listed. Joining uses prepare_group_join then confirm_group_join.',
  };
}

export interface JoinPlan {
  courseId: string;
  categoryId: string;
  categoryName: string;
  groupId: string;
  groupName: string;
  memberCount: number;
  maxUsersPerGroup: number | null;
  leavesGroup?: { groupId: string; name: string };
}

export async function prepareJoin(ctx: AppContext, courseId: string, groupId: string) {
  const id = numericId(courseId, 'course id');
  const group = numericId(groupId, 'group id');
  const all = await availableGroups(ctx, id);
  const category = all.categories.find((cat) => cat.groups.some((g) => g.groupId === group));
  const target = category?.groups.find((g) => g.groupId === group);
  if (!category || !target)
    throw new TudelftError('NOT_FOUND', 'This group is not open for self-enrollment in this course.');
  if (target.member) throw new TudelftError('ALREADY_DONE', 'You are already a member of this group.');
  if (target.full) throw new TudelftError('NOT_ALLOWED', 'This group is full.');
  const plan: JoinPlan = {
    courseId: id,
    categoryId: category.categoryId,
    categoryName: category.name,
    groupId: group,
    groupName: target.name,
    memberCount: target.memberCount,
    maxUsersPerGroup: category.maxUsersPerGroup,
  };
  const current = category.myGroups[0];
  if (current) plan.leavesGroup = { groupId: current.groupId, name: current.name };
  const identity = await ctx.brightspace.identity();
  const preview = ctx.previews.create('group_join', identity.id, plan);
  return {
    confirmationToken: preview.token,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    preview: plan,
    status: 'preview_only',
    note: 'No place is reserved. Show this to the student and confirm only after explicit approval.',
  };
}

export async function confirmJoin(ctx: AppContext, token: string, confirmed: boolean) {
  const identity = await ctx.brightspace.identity();
  const { payload: plan } = ctx.previews.consume<JoinPlan>(token, 'group_join', identity.id, confirmed);
  const fresh = await availableGroups(ctx, plan.courseId, plan.categoryId);
  const target = fresh.categories[0]?.groups.find((g) => g.groupId === plan.groupId);
  if (!target) throw new TudelftError('PREVIEW_CHANGED', 'The group is no longer available. Prepare again.');
  if (target.member) return { status: 'already_member', group: target };
  if (target.full) throw new TudelftError('NOT_ALLOWED', 'The group filled up before confirmation.');
  await ctx.brightspace.send(
    'POST',
    'lp',
    `${plan.courseId}/groupcategories/${plan.categoryId}/groups/${plan.groupId}/enrollments/`,
    { UserId: Number(identity.id) },
  );
  const after = await availableGroups(ctx, plan.courseId, plan.categoryId);
  const joined = after.categories[0]?.groups.find((g) => g.groupId === plan.groupId);
  if (!joined?.member)
    throw new TudelftError(
      'OUTCOME_UNKNOWN',
      'Brightspace accepted the request but membership could not be verified yet. Check the groups page before retrying.',
    );
  return { status: 'joined', group: joined, url: fresh.url };
}

export interface LockerEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number | null;
  modifiedAt: string | null;
}

function lockerPath(input: string): string {
  const path = `/${input.replace(/\\/g, '/').replace(/^\/+/, '')}`;
  if (path.split('/').some((part) => part === '..') || /[\r\n\0]/.test(path) || path.length > 2048)
    throw new TudelftError('INVALID_ARGUMENT', 'The locker path is not valid.');
  return path;
}

export async function lockerList(ctx: AppContext, courseId: string, groupId: string, folder = '/') {
  const id = numericId(courseId, 'course id');
  const group = numericId(groupId, 'group id');
  const path = lockerPath(folder);
  const groups = await myGroups(ctx, id);
  if (!groups.categories.some((category) => category.myGroups.some((g) => g.groupId === group)))
    throw new TudelftError(
      'PERMISSION_DENIED',
      'You are not a member of this group, so its locker is not readable.',
    );
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const raw = await ctx.brightspace.get(
    'le',
    `${id}/locker/group/${group}${encoded}${path.endsWith('/') ? '' : '/'}`,
  );
  const items: LockerEntry[] = array(raw)
    .map(record)
    .map((entry) => ({
      name: str(entry.Name),
      path: `${path.replace(/\/$/, '')}/${str(entry.Name)}`,
      type: str(entry.Type) === 'Folder' || entry.IsFolder === true ? 'folder' : 'file',
      size: typeof entry.Size === 'number' ? entry.Size : null,
      modifiedAt: typeof entry.LastModified === 'string' ? entry.LastModified : null,
    }));
  return {
    courseId: id,
    groupId: group,
    folder: path,
    items,
    url: `${ctx.brightspace.origin}/d2l/lms/locker/group_locker.d2l?ou=${id}&groupId=${group}`,
  };
}

export async function lockerRead(
  ctx: AppContext,
  courseId: string,
  groupId: string,
  filePath: string,
  options: { download?: boolean; offset?: number; maxChars?: number },
) {
  const id = numericId(courseId, 'course id');
  const group = numericId(groupId, 'group id');
  const path = lockerPath(filePath);
  const parent = path.slice(0, path.lastIndexOf('/') + 1) || '/';
  const listing = await lockerList(ctx, id, group, parent);
  const entry = listing.items.find((item) => item.path === path && item.type === 'file');
  if (!entry) throw new TudelftError('NOT_FOUND', 'That file was not found in the group locker folder.');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return readFileResource(ctx, {
    apiPath: `${id}/locker/group/${group}${encoded}`,
    indexId: `${id}:lockerfile:${group}:${Buffer.from(path, 'utf8').toString('base64url')}`,
    courseId: id,
    kind: 'locker_file',
    title: entry.name,
    sourceUrl: listing.url,
    filename: entry.name,
    ...options,
  });
}
