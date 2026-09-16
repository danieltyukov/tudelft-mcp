import type { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { registerAuthTools } from './auth.js';
import { registerCourseTools } from './courses.js';
import { registerOsirisTools } from './osiris.js';
import { registerTimetableTools } from './timetable.js';
import { registerExamTools } from './exams.js';
import { registerPublicTools } from './public.js';

/**
 * Each domain registers its own tools. Add a line here when creating a new
 * tools/<domain>.ts module; keep the order stable because clients show it.
 */
export function registerAllTools(reg: ToolRegistry, ctx: AppContext): void {
  registerAuthTools(reg, ctx);
  registerCourseTools(reg, ctx);
  registerOsirisTools(reg, ctx);
  registerTimetableTools(reg, ctx);
  registerExamTools(reg, ctx);
  registerPublicTools(reg, ctx);
}
