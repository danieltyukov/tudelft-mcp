import { z } from 'zod';
import type { AppContext } from '../context.js';
import { confirmPost, forums, posts, preparePost, topics } from '../brightspace/discussions.js';
import {
  availableGroups,
  confirmJoin,
  lockerList,
  lockerRead,
  myGroups,
  prepareJoin,
} from '../brightspace/groups.js';
import { LOCAL, READ, WRITE, type ToolRegistry } from './registry.js';
import { chunkArgs, courseId, numericIdArg } from './content.js';
import { courseRef } from './courses.js';
import { confirmArgs } from './assignments.js';

export function registerDiscussionTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'read_discussions',
    {
      title: 'Discussions',
      description:
        'Read course discussions. Without forumId: the forums. With forumId: its topics. With forumId and topicId: the posts (oldest first, last 100 by default).',
      input: {
        courseId: courseRef,
        forumId: numericIdArg('Forum id').optional(),
        topicId: numericIdArg('Topic id').optional(),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: READ,
    },
    async (args, ctx) => {
      const id = await courseId(ctx, args.courseId);
      if (args.topicId && args.forumId)
        return { courseId: id, ...(await posts(ctx, id, args.forumId, args.topicId, { limit: args.limit })) };
      if (args.forumId) return { courseId: id, ...(await topics(ctx, id, args.forumId)) };
      return { courseId: id, ...(await forums(ctx, id)) };
    },
  );

  reg.tool(
    'prepare_discussion_post',
    {
      title: 'Preview a discussion post',
      description:
        'Prepare a new thread or a reply in a discussion topic and return an exact preview with a one-use token. Nothing is posted.',
      input: {
        courseId: courseRef,
        forumId: numericIdArg('Forum id'),
        topicId: numericIdArg('Topic id'),
        subject: z.string().trim().min(1).max(300),
        text: z.string().min(1).max(50_000).describe('Plain text; shown literally.'),
        parentPostId: numericIdArg('Post id to reply to').optional(),
      },
      annotations: READ,
    },
    async (args, ctx) => preparePost(ctx, { ...args, courseId: await courseId(ctx, args.courseId) }),
  );

  reg.tool(
    'confirm_discussion_post',
    {
      title: 'Post (after approval)',
      description:
        'Publish the previewed discussion post exactly once after the student explicitly approved it.',
      input: confirmArgs,
      annotations: WRITE,
    },
    async (args, ctx) => confirmPost(ctx, args.confirmationToken, args.confirmed),
  );

  reg.tool(
    'get_groups',
    {
      title: 'My groups',
      description:
        'Group categories of a course with the groups you belong to, enrollment style and capacity.',
      input: { courseId: courseRef, categoryId: numericIdArg('Category id').optional() },
      annotations: READ,
    },
    async (args, ctx) => myGroups(ctx, await courseId(ctx, args.courseId), args.categoryId),
  );

  reg.tool(
    'list_available_groups',
    {
      title: 'Groups open for self-enrollment',
      description: 'Groups you can join yourself, with member counts and whether each is full.',
      input: { courseId: courseRef, categoryId: numericIdArg('Category id').optional() },
      annotations: READ,
    },
    async (args, ctx) => availableGroups(ctx, await courseId(ctx, args.courseId), args.categoryId),
  );

  reg.tool(
    'prepare_group_join',
    {
      title: 'Preview joining a group',
      description:
        'Check that a group is open and has space, then return a preview and one-use token. No place is reserved.',
      input: { courseId: courseRef, groupId: numericIdArg('Group id') },
      annotations: READ,
    },
    async (args, ctx) => prepareJoin(ctx, await courseId(ctx, args.courseId), args.groupId),
  );

  reg.tool(
    'confirm_group_join',
    {
      title: 'Join group (after approval)',
      description: 'Join the previewed group exactly once after explicit approval, then verify membership.',
      input: confirmArgs,
      annotations: WRITE,
    },
    async (args, ctx) => confirmJoin(ctx, args.confirmationToken, args.confirmed),
  );

  reg.tool(
    'list_locker_files',
    {
      title: 'Group locker files',
      description: 'List files and folders in the shared locker of a group you belong to.',
      input: {
        courseId: courseRef,
        groupId: numericIdArg('Group id'),
        folder: z.string().max(2048).default('/'),
      },
      annotations: READ,
    },
    async (args, ctx) => lockerList(ctx, await courseId(ctx, args.courseId), args.groupId, args.folder),
  );

  reg.tool(
    'read_locker_file',
    {
      title: 'Read group locker file',
      description: 'Extract text from (or download) a file in your group locker.',
      input: {
        courseId: courseRef,
        groupId: numericIdArg('Group id'),
        path: z.string().min(1).max(2048),
        download: z.boolean().default(false),
        ...chunkArgs,
      },
      annotations: LOCAL,
    },
    async (args, ctx) => lockerRead(ctx, await courseId(ctx, args.courseId), args.groupId, args.path, args),
  );
}
