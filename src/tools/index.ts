import type { AppContext } from '../context.js';
import type { ToolRegistry } from './registry.js';
import { registerAuthTools } from './auth.js';
import { registerCourseTools } from './courses.js';
import { registerContentTools } from './content.js';
import { registerNewsTools } from './news.js';
import { registerAssignmentTools } from './assignments.js';
import { registerGradeTools } from './grades.js';
import { registerPlanningTools } from './planning.js';
import { registerDiscussionTools } from './discussions.js';
import { registerSearchTools } from './search.js';
import { registerPromptsAndResources } from './prompts.js';

/**
 * Each domain registers its own tools. Add a line here when creating a new
 * tools/<domain>.ts module; keep the order stable because clients show it.
 */
export function registerAllTools(reg: ToolRegistry, ctx: AppContext): void {
  registerAuthTools(reg, ctx);
  registerCourseTools(reg, ctx);
  registerContentTools(reg, ctx);
  registerNewsTools(reg, ctx);
  registerAssignmentTools(reg, ctx);
  registerGradeTools(reg, ctx);
  registerPlanningTools(reg, ctx);
  registerDiscussionTools(reg, ctx);
  registerSearchTools(reg, ctx);
  registerPromptsAndResources(reg, ctx);
}
