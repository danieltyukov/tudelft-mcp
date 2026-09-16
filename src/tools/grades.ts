import type { AppContext } from '../context.js';
import { courseGrades } from '../brightspace/grades.js';
import { selectCourses } from '../brightspace/planning.js';
import { toSafeError } from '../errors.js';
import { READ, type ToolRegistry } from './registry.js';
import { courseId } from './content.js';
import { courseRef } from './courses.js';
import { z } from 'zod';

export function registerGradeTools(reg: ToolRegistry, _ctx: AppContext): void {
  reg.tool(
    'get_grades',
    {
      title: 'Course grades',
      description:
        'Brightspace gradebook for one course: released grade values with points, percentages, weights and comments, ungraded items, the final grade when released, and a computed simple and weighted average. Separate from official OSIRIS results (use osiris_grades for those).',
      input: { courseId: courseRef },
      annotations: READ,
    },
    async (args, ctx) => courseGrades(ctx, await courseId(ctx, args.courseId)),
  );

  reg.tool(
    'get_grade_summary',
    {
      title: 'Grades across courses',
      description:
        'Released Brightspace grades and computed averages for every active course (or the given ones) in one call.',
      input: { courseIds: z.array(z.string().trim().min(1)).max(40).optional() },
      annotations: READ,
    },
    async (args, ctx) => {
      const courses = await selectCourses(ctx, args.courseIds);
      const results = await Promise.allSettled(courses.map((course) => courseGrades(ctx, course.id)));
      const items = results.map((result, index) => {
        const course = courses[index]!;
        if (result.status === 'rejected')
          return {
            courseId: course.id,
            courseCode: course.courseCode ?? course.code,
            courseName: course.name,
            error: toSafeError(result.reason),
          };
        const grades = result.value;
        return {
          courseId: course.id,
          courseCode: course.courseCode ?? course.code,
          courseName: course.name,
          finalGrade: grades.finalGrade,
          summary: grades.summary,
          releasedItems: (grades.values as unknown[]).length,
          values: grades.values,
        };
      });
      return { courses: items, fetchedAt: new Date().toISOString() };
    },
  );
}
