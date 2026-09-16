import { z } from 'zod';
import type { AppContext } from '../context.js';
import { notices, rooms, software, softwareDetail, spaces } from '../public/campus.js';
import { StudyGuide } from '../public/studyguide.js';
import { READ, type ToolRegistry } from './registry.js';

const PUBLIC_NOTE =
  'Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability.';

const offsetArg = z
  .number()
  .int()
  .min(0)
  .max(100_000)
  .default(0)
  .describe('Start position for paging (25 per page).');
const queryArg = z.string().trim().max(200).optional().describe('Words to match, case-insensitive.');

export function registerPublicTools(reg: ToolRegistry, ctx: AppContext): void {
  const guide = new StudyGuide(ctx.config);

  reg.tool(
    'search_study_guide',
    {
      title: 'Search the Study Guide',
      description: `Search the public TU Delft Study Guide (course catalogue) by course code or name for one academic year. Returns codes, names, credits, faculty and a public course page link. ${PUBLIC_NOTE}`,
      input: {
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe('Course code or words from the name, e.g. EE4109 or "signal processing".'),
        academicYear: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{4}$/)
          .optional()
          .describe('Such as 2025-2026; default the current academic year.'),
        language: z.enum(['en', 'nl']).default('en'),
        offset: z.number().int().min(0).max(10_000).default(0).describe('Start position (30 per page).'),
      },
      annotations: READ,
    },
    (args) => guide.search(args.query, args),
  );

  reg.tool(
    'get_study_guide',
    {
      title: 'Read a Study Guide course',
      description: `Full public Study Guide description of one course by exact course code: description, learning objectives, teaching method, assessment, literature, prerequisites, enrolment notes, lecturers and programmes. ${PUBLIC_NOTE}`,
      input: {
        code: z.string().trim().min(2).max(20).describe('Exact course code, e.g. EE4109.'),
        academicYear: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{4}$/)
          .optional()
          .describe('Such as 2025-2026; default the current academic year.'),
        language: z.enum(['en', 'nl']).default('en'),
      },
      annotations: READ,
    },
    (args) => guide.course(args.code, args),
  );

  reg.tool(
    'search_study_spaces',
    {
      title: 'Search study spaces',
      description: `Study places on campus from the public Spacefinder site (spacefinder.tudelft.nl): name, building, type and capacity. ${PUBLIC_NOTE} Live occupancy is not included.`,
      input: { query: queryArg, offset: offsetArg },
      annotations: READ,
    },
    (args) => spaces(args.query, args.offset),
  );

  reg.tool(
    'search_rooms',
    {
      title: 'Search teaching rooms',
      description: `Teaching rooms from the public room viewer (esviewer.tudelft.nl): building, type, seats, exam seats, computers, furniture, presentation equipment, facilities and software. ${PUBLIC_NOTE} Room bookings are not shown.`,
      input: { query: queryArg, offset: offsetArg },
      annotations: READ,
    },
    (args) => rooms(args.query, args.offset),
  );

  reg.tool(
    'search_software',
    {
      title: 'Search campus software',
      description: `Software packages listed on the public Softwarefinder (softwarefinder.tudelft.nl) with a short description and detail link. ${PUBLIC_NOTE} A listing does not mean the student holds a licence.`,
      input: { query: queryArg, offset: offsetArg },
      annotations: READ,
    },
    (args) => software(args.query, args.offset),
  );

  reg.tool(
    'get_software',
    {
      title: 'Read a software package page',
      description: `Details of one Softwarefinder package (how to obtain it, licence notes, platforms) by the id from search_software. ${PUBLIC_NOTE}`,
      input: {
        id: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{1,100}$/)
          .describe('Package id from search_software.'),
      },
      annotations: READ,
    },
    (args) => softwareDetail(args.id),
  );

  reg.tool(
    'get_ict_notices',
    {
      title: 'ICT incidents and maintenance',
      description: `Current and recent ICT notices from the public status site (meldingen-ict.tudelft.nl): incidents, planned maintenance or information messages, with status updates. ${PUBLIC_NOTE}`,
      input: {
        kind: z.enum(['incidents', 'maintenance', 'information']).default('incidents'),
        page: z.number().int().min(1).max(1000).default(1),
      },
      annotations: READ,
    },
    (args) => notices(args.kind, args.page),
  );
}
