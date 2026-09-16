import { z } from 'zod';
import type { AppContext } from '../context.js';
import { listCourses } from '../brightspace/courses.js';
import { INSTRUCTIONS } from '../server.js';
import type { ToolRegistry } from './registry.js';

export function registerPromptsAndResources(reg: ToolRegistry, ctx: AppContext): void {
  reg.prompt(
    'weekly_briefing',
    'A sourced overview of the coming week: deadlines, classes, exams and news.',
    { days: z.string().optional().describe('Window in days, default 7') },
    (values) => {
      const days = values.days ?? '7';
      return `Give me a briefing for the next ${days} days. Call get_upcoming (days ${days}) for Brightspace deadlines and announcements, get_timetable (days ${days}) for classes with rooms, exam_overview for OSIRIS exam registrations, and whats_new for anything that changed. Group by day, keep Amsterdam local times, link each item to its source, and separate confirmed dates from items without a published date. End with the three most urgent actions.`;
    },
  );
  reg.prompt(
    'course_briefing',
    'Everything current about one course.',
    { course: z.string().describe('Course id or code') },
    (values) => {
      return `Brief me on course ${values.course}. Use get_course_content for the outline, list_assignments and list_quizzes for work, get_announcements for news, get_grades for released grades, and get_study_guide (current academic year) for the official description and assessment. Summarise what is due, what was recently added, and what the assessment looks like, with links. Mark anything you could not read.`;
    },
  );
  reg.prompt(
    'exam_prep',
    'A study plan for an upcoming exam built from the course materials.',
    { course: z.string().describe('Course id or code'), examDate: z.string().optional() },
    (values) => {
      return `Help me prepare for the exam of ${values.course}${values.examDate ? ` on ${values.examDate}` : ''}. Run sync_course on it and wait for get_sync_status to finish, then use get_course_content and search_materials to map the topics covered, list the lecture files per week, and pull the learning objectives and assessment format from get_study_guide. Produce a day-by-day plan until the exam with the exact files to read each day, and list past exam or practice material if the course has any.`;
    },
  );
  reg.prompt('study_plan', 'A weekly plan balancing all courses.', {}, () => {
    return 'Build me a study plan for this week. Combine get_upcoming (14 days), get_timetable (7 days) and exam_overview. Fit reading and assignment work around scheduled classes, prioritise by deadline and weight, and flag conflicts. Keep it realistic and show the sources.';
  });

  reg.resource('usage', 'tudelft://usage', 'How to use this server and its tools.', () =>
    JSON.stringify({ instructions: INSTRUCTIONS }),
  );
  reg.resource(
    'courses',
    'tudelft://courses',
    'Active Brightspace courses of the signed-in student.',
    async () => {
      const result = await listCourses(ctx.brightspace, { activeOnly: true });
      return JSON.stringify(
        result.items.map((course) => ({
          id: course.id,
          code: course.courseCode ?? course.code,
          name: course.name,
          period: course.period,
          year: course.academicYear,
        })),
      );
    },
  );
}
