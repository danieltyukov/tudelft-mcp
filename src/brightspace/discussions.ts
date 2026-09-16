import type { AppContext } from '../context.js';
import { TudelftError } from '../errors.js';
import { toLocal } from '../util/dates.js';
import { numericId, plainText, record, str } from '../util/text.js';
import { describe, richLinks } from './content.js';

export async function forums(ctx: AppContext, courseId: string) {
  const id = numericId(courseId, 'course id');
  const result = await ctx.brightspace.list('le', `${id}/discussions/forums/`);
  return {
    items: result.items
      .map(record)
      .filter((row) => row.IsHidden !== true)
      .map((row) => ({
        forumId: str(row.ForumId),
        name: str(row.Name),
        description: describe(row.Description),
        locked: row.IsLocked === true,
        requiresApproval: row.RequiresApproval === true,
        opensAt: typeof row.StartDate === 'string' ? row.StartDate : null,
        closesAt: typeof row.EndDate === 'string' ? row.EndDate : null,
      })),
    complete: result.complete,
  };
}

export async function topics(ctx: AppContext, courseId: string, forumId: string) {
  const id = numericId(courseId, 'course id');
  const forum = numericId(forumId, 'forum id');
  const result = await ctx.brightspace.list('le', `${id}/discussions/forums/${forum}/topics/`);
  return {
    items: result.items
      .map(record)
      .filter((row) => row.IsHidden !== true)
      .map((row) => ({
        topicId: str(row.TopicId),
        forumId: forum,
        name: str(row.Name),
        description: describe(row.Description),
        locked: row.IsLocked === true,
        opensAt: typeof row.StartDate === 'string' ? row.StartDate : null,
        closesAt: typeof row.EndDate === 'string' ? row.EndDate : null,
        url: `${ctx.brightspace.origin}/d2l/le/${id}/discussions/topics/${str(row.TopicId)}/View`,
      })),
    complete: result.complete,
  };
}

export interface Post {
  postId: string;
  threadId: string;
  parentPostId: string | null;
  subject: string;
  text: string;
  links: { title: string; url: string }[];
  author: string;
  authorId: string;
  postedAt: string | null;
  postedLocal?: string;
  deleted: boolean;
}

export function parsePost(raw: unknown, origin: string): Post | undefined {
  const row = record(raw);
  const postId = str(row.PostId);
  if (!/^\d+$/.test(postId)) return undefined;
  const postedAt = typeof row.DatePosted === 'string' ? row.DatePosted : null;
  const local = toLocal(postedAt);
  return {
    postId,
    threadId: str(row.ThreadId),
    parentPostId: str(row.ParentPostId) || null,
    subject: plainText(row.Subject),
    text: describe(row.Message),
    links: richLinks(row.Message, origin),
    author: str(row.PostingUserDisplayName),
    authorId: str(row.PostingUserId),
    postedAt,
    ...(local ? { postedLocal: local } : {}),
    deleted: row.IsDeleted === true,
  };
}

export async function posts(
  ctx: AppContext,
  courseId: string,
  forumId: string,
  topicId: string,
  options: { limit?: number } = {},
) {
  const id = numericId(courseId, 'course id');
  const forum = numericId(forumId, 'forum id');
  const topic = numericId(topicId, 'topic id');
  const result = await ctx.brightspace.list('le', `${id}/discussions/forums/${forum}/topics/${topic}/posts/`);
  const items = result.items
    .map((raw) => parsePost(raw, ctx.brightspace.origin))
    .filter((post): post is Post => post !== undefined && !post.deleted);
  items.sort((a, b) => (a.postedAt ?? '').localeCompare(b.postedAt ?? ''));
  const limit = options.limit ?? 100;
  return {
    items: items.slice(-limit),
    total: items.length,
    complete: result.complete,
    url: `${ctx.brightspace.origin}/d2l/le/${id}/discussions/topics/${topic}/View`,
  };
}

export interface PostPlan {
  courseId: string;
  forumId: string;
  topicId: string;
  topicName: string;
  parentPostId: string | null;
  replyingTo?: { subject: string; author: string };
  subject: string;
  text: string;
}

export async function preparePost(
  ctx: AppContext,
  input: {
    courseId: string;
    forumId: string;
    topicId: string;
    subject: string;
    text: string;
    parentPostId?: string;
  },
) {
  const id = numericId(input.courseId, 'course id');
  const forum = numericId(input.forumId, 'forum id');
  const topic = numericId(input.topicId, 'topic id');
  const subject = input.subject.trim();
  const text = input.text.trim();
  if (!subject || !text)
    throw new TudelftError('INVALID_ARGUMENT', 'Both a subject and a message are required.');
  if (text.length > 50_000)
    throw new TudelftError('INVALID_ARGUMENT', 'Keep the message under 50,000 characters.');
  const topicRow = record(
    await ctx.brightspace.get('le', `${id}/discussions/forums/${forum}/topics/${topic}`),
  );
  if (topicRow.IsLocked === true) throw new TudelftError('NOT_ALLOWED', 'This discussion topic is locked.');
  const plan: PostPlan = {
    courseId: id,
    forumId: forum,
    topicId: topic,
    topicName: str(topicRow.Name),
    parentPostId: null,
    subject,
    text,
  };
  if (input.parentPostId) {
    const parent = parsePost(
      await ctx.brightspace.get(
        'le',
        `${id}/discussions/forums/${forum}/topics/${topic}/posts/${numericId(input.parentPostId, 'post id')}`,
      ),
      ctx.brightspace.origin,
    );
    if (!parent) throw new TudelftError('NOT_FOUND', 'The post you want to reply to was not found.');
    plan.parentPostId = parent.postId;
    plan.replyingTo = { subject: parent.subject, author: parent.author };
  }
  const identity = await ctx.brightspace.identity();
  const preview = ctx.previews.create('discussion_post', identity.id, plan);
  return {
    confirmationToken: preview.token,
    expiresAt: new Date(preview.expiresAt).toISOString(),
    preview: plan,
    postedAs: identity.name || identity.uniqueName,
    status: 'preview_only',
    note: 'Nothing has been posted. Show this preview to the student and call confirm_discussion_post with confirmed: true only after they approve it.',
  };
}

export async function confirmPost(ctx: AppContext, token: string, confirmed: boolean) {
  const identity = await ctx.brightspace.identity();
  const { payload: plan } = ctx.previews.consume<PostPlan>(token, 'discussion_post', identity.id, confirmed);
  const body = {
    ParentPostId: plan.parentPostId ? Number(plan.parentPostId) : null,
    Subject: plan.subject,
    Message: { Content: plan.text, Type: 'Text' },
    IsAnonymous: false,
  };
  const result = await ctx.brightspace.send(
    'POST',
    'le',
    `${plan.courseId}/discussions/forums/${plan.forumId}/topics/${plan.topicId}/posts/`,
    body,
  );
  const created = parsePost(result.data, ctx.brightspace.origin);
  if (!created) {
    const check = await posts(ctx, plan.courseId, plan.forumId, plan.topicId, { limit: 20 }).catch(
      () => undefined,
    );
    const mine = check?.items.find((post) => post.authorId === identity.id && post.subject === plan.subject);
    if (!mine)
      throw new TudelftError(
        'OUTCOME_UNKNOWN',
        'Brightspace accepted the request but the new post could not be verified. Check the topic before posting again.',
      );
    return { status: 'posted', post: mine, url: check!.url };
  }
  return {
    status: 'posted',
    post: created,
    url: `${ctx.brightspace.origin}/d2l/le/${plan.courseId}/discussions/topics/${plan.topicId}/View`,
  };
}
