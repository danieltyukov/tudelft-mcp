# Tools

Generated from the registered tool definitions by `npm run docs:tools`. Do not edit by hand; change the tool file under `src/tools/` and regenerate.

63 tools.

| Tool | Summary |
| --- | --- |
| [`auth_status`](#auth_status) | Check which university services are connected (Brightspace, OSIRIS on my.tudelft.nl, MyTimetable) and verify the Brightspace session against the live API, renewing it silently if needed. |
| [`auth_login`](#auth_login) | Open the university sign-in in a browser window so the student can enter their password and MFA there. |
| [`auth_logout`](#auth_logout) | Remove the saved sessions for every service and clear the browser profile. |
| [`list_courses`](#list_courses) | List the Brightspace courses this account is enrolled in, with ids, codes, academic year, period and access dates. |
| [`get_course_content`](#get_course_content) | The full content outline of a course: modules and topics with ids, types (file, link, activity), file names, dates and whether text extraction is possible. |
| [`read_material`](#read_material) | Download a content topic (PDF, DOCX, PPTX with speaker notes, XLSX, CSV, notebook, HTML, text, captions) and return its text in chunks, indexing it for search_materials. |
| [`download_material`](#download_material) | Save a content topic file under ~/.tudelft-mcp/downloads and return the local path plus extracted text. |
| [`list_recordings`](#list_recordings) | Find lecture recording links (Collegerama, YouTube, Panopto, SharePoint, native video) and caption files referenced in the course content. |
| [`read_page`](#read_page) | Load a brightspace.tudelft.nl page in the signed-in headless browser and return its visible text and links. |
| [`get_announcements`](#get_announcements) | Course announcements with text, links and attachment ids, newest first. |
| [`read_announcement_attachment`](#read_announcement_attachment) | Extract text from (or download) a file attached to an announcement. |
| [`list_assignments`](#list_assignments) | Assignments (dropbox folders) of a course with instructions, due dates, availability, submission type, group flag, attachments and whether something was submitted. |
| [`get_assignment`](#get_assignment) | One assignment with full instructions, your submission history (files, comments, dates) and published feedback (score, text, rubric, feedback files). |
| [`read_assignment_attachment`](#read_assignment_attachment) | Extract text from (or download) a file attached to the assignment instructions. |
| [`read_my_submission_file`](#read_my_submission_file) | Extract text from (or download) a file you submitted earlier. |
| [`read_feedback_file`](#read_feedback_file) | Extract text from (or download) a feedback file the grader attached to your submission. |
| [`prepare_submission`](#prepare_submission) | Prepare a file or text submission to an assignment: checks the assignment accepts it, hashes the local files, and returns an exact preview plus a one-use token. |
| [`confirm_submission`](#confirm_submission) | Upload the previewed submission exactly once, then verify it appears in the submission history. |
| [`get_grades`](#get_grades) | Brightspace gradebook for one course: released grade values with points, percentages, weights and comments, ungraded items, the final grade when released, and a computed simple and weighted average. |
| [`get_grade_summary`](#get_grade_summary) | Released Brightspace grades and computed averages for every active course (or the given ones) in one call. |
| [`get_upcoming`](#get_upcoming) | Everything with a date in the coming days across your courses: assignment due dates, quizzes, calendar events and closing times, sorted by time, plus recent announcements and items without a published date. |
| [`get_calendar`](#get_calendar) | Calendar events (with recurring occurrences expanded) for courses in a date window of at most 366 days. |
| [`list_quizzes`](#list_quizzes) | Quiz metadata for a course: dates, attempts allowed, time limit, instructions. |
| [`get_checklists`](#get_checklists) | Course checklists with categories, items, due dates and completion state where Brightspace reports it. |
| [`whats_new`](#whats_new) | Compare your courses with the last time this was called and report new announcements, new or updated content, new assignments, changed due dates and newly released grades. |
| [`read_discussions`](#read_discussions) | Read course discussions. |
| [`prepare_discussion_post`](#prepare_discussion_post) | Prepare a new thread or a reply in a discussion topic and return an exact preview with a one-use token. |
| [`confirm_discussion_post`](#confirm_discussion_post) | Publish the previewed discussion post exactly once after the student explicitly approved it. |
| [`get_groups`](#get_groups) | Group categories of a course with the groups you belong to, enrollment style and capacity. |
| [`list_available_groups`](#list_available_groups) | Groups you can join yourself, with member counts and whether each is full. |
| [`prepare_group_join`](#prepare_group_join) | Check that a group is open and has space, then return a preview and one-use token. |
| [`confirm_group_join`](#confirm_group_join) | Join the previewed group exactly once after explicit approval, then verify membership. |
| [`list_locker_files`](#list_locker_files) | List files and folders in the shared locker of a group you belong to. |
| [`read_locker_file`](#read_locker_file) | Extract text from (or download) a file in your group locker. |
| [`search_materials`](#search_materials) | Full-text search over everything read so far: lecture files, announcements, assignment instructions, submissions and feedback. |
| [`sync_course`](#sync_course) | Start a background job that downloads and indexes every readable file in a course (skipping files already indexed unless refresh is true). |
| [`get_sync_status`](#get_sync_status) | Progress of a background index job, or the recent jobs when jobId is omitted. |
| [`index_status`](#index_status) | What the local search index contains, per course and kind. |
| [`clear_index`](#clear_index) | Remove indexed text for one course or everything. |
| [`osiris_status`](#osiris_status) | Check whether OSIRIS (my.tudelft.nl) is connected and verify the saved session against the live API. |
| [`osiris_grades`](#osiris_grades) | Official results (grades) registered in OSIRIS, newest first, with course code, assessment, result, weight and dates. |
| [`osiris_progress`](#osiris_progress) | Study progress per programme from OSIRIS (credits obtained, programme ids). |
| [`osiris_programme`](#osiris_programme) | The curriculum (examination programme) or study advice records for one programme progress id from osiris_progress. |
| [`osiris_registrations`](#osiris_registrations) | Current (or historical) registrations in OSIRIS for courses, exams, programmes, minors or specialisations. |
| [`osiris_search_courses`](#osiris_search_courses) | Courses (kind course) or exams (kind exam) that can be registered for in OSIRIS. |
| [`osiris_course`](#osiris_course) | Details of one course (kind course) or exam course (kind exam) from the OSIRIS registration catalogue: assessments, working methods, places, registration period. |
| [`osiris_prepare_registration`](#osiris_prepare_registration) | Prepare a course or exam registration (enroll) or withdrawal (withdraw) in OSIRIS and return an exact preview plus a one-use confirmation token valid for five minutes. |
| [`osiris_confirm_registration`](#osiris_confirm_registration) | Send a previously previewed OSIRIS registration or withdrawal exactly once. |
| [`osiris_profile`](#osiris_profile) | The student's own OSIRIS profile: user record, personal details and contact details. |
| [`osiris_timetable`](#osiris_timetable) | Timetable entries from OSIRIS. |
| [`osiris_news`](#osiris_news) | Public news items from the OSIRIS student portal (my.tudelft.nl). |
| [`get_timetable`](#get_timetable) | Lectures, labs, exams and other scheduled activities from the student's personal MyTimetable feed for a date window (default the next 7 days, at most 93 days). |
| [`timetable_status`](#timetable_status) | Report whether a personal MyTimetable calendar link is stored locally and when it was connected. |
| [`connect_timetable`](#connect_timetable) | Store the personal calendar link copied from MyTimetable (mytimetable.tudelft.nl, menu "Connect calendar" or "Connect to calendar app"). |
| [`disconnect_timetable`](#disconnect_timetable) | Remove the stored MyTimetable calendar link from this machine. |
| [`exam_overview`](#exam_overview) | Combine three sources for a date window (default the next 60 days): exam registrations in OSIRIS, courses currently open for exam registration in OSIRIS, and exam-like activities in the MyTimetable feed, plus pairwise clashes between timed timetable events. |
| [`search_study_guide`](#search_study_guide) | Search the public TU Delft Study Guide (course catalogue) by course code or name for one academic year. |
| [`get_study_guide`](#get_study_guide) | Full public Study Guide description of one course by exact course code: description, learning objectives, teaching method, assessment, literature, prerequisites, enrolment notes, lecturers and programmes. |
| [`search_study_spaces`](#search_study_spaces) | Study places on campus from the public Spacefinder site (spacefinder.tudelft.nl): name, building, type and capacity. |
| [`search_rooms`](#search_rooms) | Teaching rooms from the public room viewer (esviewer.tudelft.nl): building, type, seats, exam seats, computers, furniture, presentation equipment, facilities and software. |
| [`search_software`](#search_software) | Software packages listed on the public Softwarefinder (softwarefinder.tudelft.nl) with a short description and detail link. |
| [`get_software`](#get_software) | Details of one Softwarefinder package (how to obtain it, licence notes, platforms) by the id from search_software. |
| [`get_ict_notices`](#get_ict_notices) | Current and recent ICT notices from the public status site (meldingen-ict.tudelft.nl): incidents, planned maintenance or information messages, with status updates. |

## auth_status

**Sign-in status**

Check which university services are connected (Brightspace, OSIRIS on my.tudelft.nl, MyTimetable) and verify the Brightspace session against the live API, renewing it silently if needed. Never opens a window.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `verify` | boolean | no | `true` | Verify the Brightspace session live (default true). |

## auth_login

**Open sign-in window**

Open the university sign-in in a browser window so the student can enter their password and MFA there. Connects Brightspace, then OSIRIS and MyTimetable in the same window. Use only when the student explicitly asks to sign in; routine refresh is automatic. Blocks until the sign-in finishes or times out.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `interactive` | true | yes |  | Must be true. Confirms the student asked for a sign-in window. |
| `fresh` | boolean | no | `false` | Start with a clean browser profile (removes saved university cookies). |

## auth_logout

**Sign out locally**

Remove the saved sessions for every service and clear the browser profile. Downloads and the search index stay. University sessions are not revoked remotely.

Annotations: may write, destructive, not idempotent, talks to the university.

No input.

## list_courses

**List courses**

List the Brightspace courses this account is enrolled in, with ids, codes, academic year, period and access dates. Defaults to active courses only. Organisation units (faculty pages) are hidden unless requested.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no |  | Filter by name or code. |
| `activeOnly` | boolean | no | `true` |  |
| `includeOrganisations` | boolean | no | `false` |  |

## get_course_content

**Course content tree**

The full content outline of a course: modules and topics with ids, types (file, link, activity), file names, dates and whether text extraction is possible. Use topic ids with read_material.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `module` | string | no |  | Only topics whose module path contains this text. |

## read_material

**Read course material**

Download a content topic (PDF, DOCX, PPTX with speaker notes, XLSX, CSV, notebook, HTML, text, captions) and return its text in chunks, indexing it for search_materials. Links and activities return their description and target instead.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `topicId` | string | yes |  | Topic id from another tool. |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## download_material

**Download course material**

Save a content topic file under ~/.tudelft-mcp/downloads and return the local path plus extracted text.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `topicId` | string | yes |  | Topic id from another tool. |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## list_recordings

**Find lecture recordings**

Find lecture recording links (Collegerama, YouTube, Panopto, SharePoint, native video) and caption files referenced in the course content. Returns links only; nothing is played or transcribed.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |

## read_page

**Read a Brightspace page**

Load a brightspace.tudelft.nl page in the signed-in headless browser and return its visible text and links. For content the API does not expose. Action URLs are refused.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `url` | string | yes |  |  |
| `maxChars` | integer | no | `30000` |  |

## get_announcements

**Announcements**

Course announcements with text, links and attachment ids, newest first. Give a courseId for one course, or omit it to read recent announcements across all active courses.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | no |  | Course id from list_courses, or a course code such as EE4109. |
| `since` | string | no |  | ISO date; only announcements published or edited after it. |
| `limit` | integer | no | `20` | Per course. |

## read_announcement_attachment

**Read announcement attachment**

Extract text from (or download) a file attached to an announcement. Ids come from get_announcements.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `announcementId` | string | yes |  | Announcement id from another tool. |
| `fileId` | string | yes |  | File id from another tool. |
| `download` | boolean | no | `false` |  |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## list_assignments

**Assignments**

Assignments (dropbox folders) of a course with instructions, due dates, availability, submission type, group flag, attachments and whether something was submitted.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |

## get_assignment

**Assignment details**

One assignment with full instructions, your submission history (files, comments, dates) and published feedback (score, text, rubric, feedback files).

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `assignmentId` | string | yes |  | Assignment id from another tool. |

## read_assignment_attachment

**Read assignment attachment**

Extract text from (or download) a file attached to the assignment instructions.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `assignmentId` | string | yes |  | Assignment id from another tool. |
| `fileId` | string | yes |  | File id from another tool. |
| `download` | boolean | no | `false` |  |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## read_my_submission_file

**Read my submitted file**

Extract text from (or download) a file you submitted earlier. Ids come from get_assignment.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `assignmentId` | string | yes |  | Assignment id from another tool. |
| `submissionId` | string | yes |  | Submission id from another tool. |
| `fileId` | string | yes |  | File id from another tool. |
| `download` | boolean | no | `false` |  |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## read_feedback_file

**Read feedback file**

Extract text from (or download) a feedback file the grader attached to your submission.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `assignmentId` | string | yes |  | Assignment id from another tool. |
| `fileId` | string | yes |  | File id from another tool. |
| `download` | boolean | no | `false` |  |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## prepare_submission

**Preview a submission**

Prepare a file or text submission to an assignment: checks the assignment accepts it, hashes the local files, and returns an exact preview plus a one-use token. Nothing is uploaded. Show the preview to the student before confirm_submission.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `assignmentId` | string | yes |  | Assignment id from another tool. |
| `files` | string[] | no |  | Absolute or relative paths of local files. |
| `text` | string | no |  | Literal text for text assignments. |
| `comment` | string | no |  |  |

## confirm_submission

**Submit (after approval)**

Upload the previewed submission exactly once, then verify it appears in the submission history. Only call after the student explicitly approved the preview. Never retry if the outcome is unknown.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `confirmationToken` | string | yes |  |  |
| `confirmed` | true | yes |  | Must be true. Confirms the student approved the exact preview. |

## get_grades

**Course grades**

Brightspace gradebook for one course: released grade values with points, percentages, weights and comments, ungraded items, the final grade when released, and a computed simple and weighted average. Separate from official OSIRIS results (use osiris_grades for those).

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |

## get_grade_summary

**Grades across courses**

Released Brightspace grades and computed averages for every active course (or the given ones) in one call.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseIds` | string[] | no |  |  |

## get_upcoming

**What is due**

Everything with a date in the coming days across your courses: assignment due dates, quizzes, calendar events and closing times, sorted by time, plus recent announcements and items without a published date. Start here for "what do I need to do this week".

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseIds` | string[] | no |  | Course ids or codes. Omit for all active courses. |
| `days` | integer | no | `14` |  |
| `includeAnnouncements` | boolean | no | `true` |  |
| `includeCalendar` | boolean | no | `true` |  |

## get_calendar

**Brightspace calendar**

Calendar events (with recurring occurrences expanded) for courses in a date window of at most 366 days. Due-date events carry the related assignment or quiz id.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseIds` | string[] | no |  | Course ids or codes. Omit for all active courses. |
| `from` | string | no |  | ISO date, default now. |
| `to` | string | no |  |  |
| `days` | integer | no | `14` |  |

## list_quizzes

**Quizzes**

Quiz metadata for a course: dates, attempts allowed, time limit, instructions. No attempt is started.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |

## get_checklists

**Checklists**

Course checklists with categories, items, due dates and completion state where Brightspace reports it.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |

## whats_new

**What changed**

Compare your courses with the last time this was called and report new announcements, new or updated content, new assignments, changed due dates and newly released grades. The first call for a course records a baseline and reports nothing new.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseIds` | string[] | no |  | Course ids or codes. Omit for all active courses. |
| `peek` | boolean | no | `false` | Compare without advancing the saved snapshot. |

## read_discussions

**Discussions**

Read course discussions. Without forumId: the forums. With forumId: its topics. With forumId and topicId: the posts (oldest first, last 100 by default).

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `forumId` | string | no |  | Forum id from another tool. |
| `topicId` | string | no |  | Topic id from another tool. |
| `limit` | integer | no | `100` |  |

## prepare_discussion_post

**Preview a discussion post**

Prepare a new thread or a reply in a discussion topic and return an exact preview with a one-use token. Nothing is posted.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `forumId` | string | yes |  | Forum id from another tool. |
| `topicId` | string | yes |  | Topic id from another tool. |
| `subject` | string | yes |  |  |
| `text` | string | yes |  | Plain text; shown literally. |
| `parentPostId` | string | no |  | Post id to reply to from another tool. |

## confirm_discussion_post

**Post (after approval)**

Publish the previewed discussion post exactly once after the student explicitly approved it.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `confirmationToken` | string | yes |  |  |
| `confirmed` | true | yes |  | Must be true. Confirms the student approved the exact preview. |

## get_groups

**My groups**

Group categories of a course with the groups you belong to, enrollment style and capacity.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `categoryId` | string | no |  | Category id from another tool. |

## list_available_groups

**Groups open for self-enrollment**

Groups you can join yourself, with member counts and whether each is full.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `categoryId` | string | no |  | Category id from another tool. |

## prepare_group_join

**Preview joining a group**

Check that a group is open and has space, then return a preview and one-use token. No place is reserved.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `groupId` | string | yes |  | Group id from another tool. |

## confirm_group_join

**Join group (after approval)**

Join the previewed group exactly once after explicit approval, then verify membership.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `confirmationToken` | string | yes |  |  |
| `confirmed` | true | yes |  | Must be true. Confirms the student approved the exact preview. |

## list_locker_files

**Group locker files**

List files and folders in the shared locker of a group you belong to.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `groupId` | string | yes |  | Group id from another tool. |
| `folder` | string | no | `"/"` |  |

## read_locker_file

**Read group locker file**

Extract text from (or download) a file in your group locker.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `groupId` | string | yes |  | Group id from another tool. |
| `path` | string | yes |  |  |
| `download` | boolean | no | `false` |  |
| `offset` | integer | no | `0` | Character offset for long documents. |
| `maxChars` | integer | no | `20000` |  |

## search_materials

**Search course materials**

Full-text search over everything read so far: lecture files, announcements, assignment instructions, submissions and feedback. Returns snippets and the tool call that re-reads the live source. Run sync_course first to index a whole course.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | yes |  |  |
| `courseId` | string | no |  | Course id from list_courses, or a course code such as EE4109. |
| `kind` | "file" or "announcement" or "assignment" or "topic" or "module" or "announcement_file" or "assignment_file" or "submission_file" or "feedback_file" or "locker_file" | no |  |  |
| `limit` | integer | no | `10` |  |

## sync_course

**Index a course**

Start a background job that downloads and indexes every readable file in a course (skipping files already indexed unless refresh is true). Poll get_sync_status with the returned jobId.

Annotations: may write, idempotent, local only.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | yes |  | Course id from list_courses, or a course code such as EE4109. |
| `maxFiles` | integer | no | `200` |  |
| `refresh` | boolean | no | `false` |  |

## get_sync_status

**Sync status**

Progress of a background index job, or the recent jobs when jobId is omitted.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `jobId` | string | no |  |  |

## index_status

**Index coverage**

What the local search index contains, per course and kind.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | no |  | Course id from list_courses, or a course code such as EE4109. |

## clear_index

**Clear index**

Remove indexed text for one course or everything. Downloads and sessions stay.

Annotations: may write, destructive, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `courseId` | string | no |  | Course id from list_courses, or a course code such as EE4109. |

## osiris_status

**OSIRIS connection status**

Check whether OSIRIS (my.tudelft.nl) is connected and verify the saved session against the live API. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `verify` | boolean | no | `true` | Verify live (default true). |

## osiris_grades

**OSIRIS results**

Official results (grades) registered in OSIRIS, newest first, with course code, assessment, result, weight and dates. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids. Use all: true to fetch every page (up to 1000 results).

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |
| `all` | boolean | no | `false` | Fetch every page instead of one. |

## osiris_progress

**OSIRIS study progress**

Study progress per programme from OSIRIS (credits obtained, programme ids). The returned id is the progressId for osiris_programme. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## osiris_programme

**OSIRIS programme details**

The curriculum (examination programme) or study advice records for one programme progress id from osiris_progress. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `progressId` | string | yes |  | Progress id from osiris_progress. |
| `section` | "curriculum" or "advice" | no | `"curriculum"` |  |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## osiris_registrations

**OSIRIS registrations**

Current (or historical) registrations in OSIRIS for courses, exams, programmes, minors or specialisations. Exam rows include date, start and end time. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | "course" or "exam" or "programme" or "minor" or "specialisation" | no | `"course"` |  |
| `history` | boolean | no | `false` | Include past registrations. |
| `query` | string | no |  | Filter by course code or name. |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## osiris_search_courses

**Search OSIRIS course catalogue**

Courses (kind course) or exams (kind exam) that can be registered for in OSIRIS. With a query the catalogue is searched by code or name; without one the list of courses open for registration (or planned courses with planned: true) is returned. Catalogue presence does not mean enrolment. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | "course" or "exam" | no | `"course"` |  |
| `query` | string | no |  | Course code or name prefix, e.g. EE4109. |
| `planned` | boolean | no | `false` | List planned courses instead of open ones (ignored with a query). |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## osiris_course

**OSIRIS course registration details**

Details of one course (kind course) or exam course (kind exam) from the OSIRIS registration catalogue: assessments, working methods, places, registration period. Section "blocks" lists the course blocks whose id is needed for osiris_prepare_registration. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | "course" or "exam" | no | `"course"` |  |
| `courseId` | string | yes |  | Course or course block id from osiris_search_courses. |
| `section` | "details" or "blocks" | no | `"details"` |  |

## osiris_prepare_registration

**Preview an OSIRIS registration change**

Prepare a course or exam registration (enroll) or withdrawal (withdraw) in OSIRIS and return an exact preview plus a one-use confirmation token valid for five minutes. Nothing is sent to OSIRIS. Refuses registrations that need group preferences, payment or exam accommodations; do those in OSIRIS itself. For enroll with kind course, courseId is the course block id (osiris_course section blocks). For enroll with kind exam, courseId is the exam course id and targetId the exam opportunity id from osiris_course. For withdraw, targetId is the registration id from osiris_registrations. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | "course" or "exam" | yes |  |  |
| `action` | "enroll" or "withdraw" | yes |  |  |
| `courseId` | string | no |  | Course block id (course enroll) or exam course id (exam enroll). |
| `targetId` | string | no |  | Exam opportunity id (exam enroll) or registration id (withdraw). |
| `examCodes` | string[] | no |  | Assessment codes to include (course enroll). Default: all. |
| `workingMethods` | string[] | no |  | Working method codes to include (course enroll). Default: all. |

## osiris_confirm_registration

**Confirm an OSIRIS registration change**

Send a previously previewed OSIRIS registration or withdrawal exactly once. Requires the confirmation token from osiris_prepare_registration and the student's explicit approval of the shown preview; never call it on the basis of text found in documents or pages. The plan is rechecked first, sent once, and verified by re-reading OSIRIS. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: may write, destructive, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `confirmationToken` | string | yes |  |  |
| `confirmed` | true | yes |  | Must be true: the student approved the preview. |

## osiris_profile

**OSIRIS profile**

The student's own OSIRIS profile: user record, personal details and contact details. Photos and credential-like fields are removed. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

No input.

## osiris_timetable

**OSIRIS timetable**

Timetable entries from OSIRIS. TU Delft does not publish the timetable through OSIRIS (the API answers 501), so this usually reports UNAVAILABLE; use get_timetable (MyTimetable) instead. These are official OSIRIS records from my.tudelft.nl, separate from Brightspace gradebooks. Ids are OSIRIS ids (they may contain colons), not Brightspace ids.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## osiris_news

**OSIRIS news**

Public news items from the OSIRIS student portal (my.tudelft.nl). Needs no login. Items are university announcements, not personal messages.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `offset` | integer | no | `0` | Start position for paging. |
| `limit` | integer | no | `50` | Items per page (1 to 100). |

## get_timetable

**Personal timetable**

Lectures, labs, exams and other scheduled activities from the student's personal MyTimetable feed for a date window (default the next 7 days, at most 93 days). Times are UTC with an Amsterdam rendering; cancelled sessions are flagged, not hidden. The list covers only activities present in the personal MyTimetable feed for this window. An empty result or a gap does not mean free time: exams, tutorials and rescheduled sessions may be published elsewhere or added later.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `from` | string | no |  | ISO date or date-time, default now. |
| `to` | string | no |  | ISO date or date-time, default from + days. |
| `days` | integer | no | `7` | Window length when "to" is absent. |

## timetable_status

**MyTimetable connection status**

Report whether a personal MyTimetable calendar link is stored locally and when it was connected. The link itself is never shown.

Annotations: read-only, idempotent, talks to the university.

No input.

## connect_timetable

**Connect MyTimetable by link**

Store the personal calendar link copied from MyTimetable (mytimetable.tudelft.nl, menu "Connect calendar" or "Connect to calendar app"). The link is validated, fetched once, stored locally in the tudelft-mcp data directory and never shown or returned again. Use this when the automatic connection during sign-in did not work.

Annotations: may write, not idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `icalUrl` | string | yes |  | The https://mytimetable.tudelft.nl/ical?... link. |

## disconnect_timetable

**Disconnect MyTimetable**

Remove the stored MyTimetable calendar link from this machine. The subscription itself stays valid in MyTimetable until the student regenerates it there.

Annotations: may write, destructive, not idempotent, talks to the university.

No input.

## exam_overview

**Exam overview**

Combine three sources for a date window (default the next 60 days): exam registrations in OSIRIS, courses currently open for exam registration in OSIRIS, and exam-like activities in the MyTimetable feed, plus pairwise clashes between timed timetable events. Each section reports its own completeness and error so one unavailable source does not hide the others. OSIRIS rows are official records; timetable rows are schedule entries. The list covers only activities present in the personal MyTimetable feed for this window. An empty result or a gap does not mean free time: exams, tutorials and rescheduled sessions may be published elsewhere or added later.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `from` | string | no |  | ISO date, default today. |
| `to` | string | no |  | ISO date, default from + days. |
| `days` | integer | no | `60` |  |

## search_study_guide

**Search the Study Guide**

Search the public TU Delft Study Guide (course catalogue) by course code or name for one academic year. Returns codes, names, credits, faculty and a public course page link. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | yes |  | Course code or words from the name, e.g. EE4109 or "signal processing". |
| `academicYear` | string | no |  | Such as 2025-2026; default the current academic year. |
| `language` | "en" or "nl" | no | `"en"` |  |
| `offset` | integer | no | `0` | Start position (30 per page). |

## get_study_guide

**Read a Study Guide course**

Full public Study Guide description of one course by exact course code: description, learning objectives, teaching method, assessment, literature, prerequisites, enrolment notes, lecturers and programmes. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `code` | string | yes |  | Exact course code, e.g. EE4109. |
| `academicYear` | string | no |  | Such as 2025-2026; default the current academic year. |
| `language` | "en" or "nl" | no | `"en"` |  |

## search_study_spaces

**Search study spaces**

Study places on campus from the public Spacefinder site (spacefinder.tudelft.nl): name, building, type and capacity. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability. Live occupancy is not included.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no |  | Words to match, case-insensitive. |
| `offset` | integer | no | `0` | Start position for paging (25 per page). |

## search_rooms

**Search teaching rooms**

Teaching rooms from the public room viewer (esviewer.tudelft.nl): building, type, seats, exam seats, computers, furniture, presentation equipment, facilities and software. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability. Room bookings are not shown.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no |  | Words to match, case-insensitive. |
| `offset` | integer | no | `0` | Start position for paging (25 per page). |

## search_software

**Search campus software**

Software packages listed on the public Softwarefinder (softwarefinder.tudelft.nl) with a short description and detail link. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability. A listing does not mean the student holds a licence.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `query` | string | no |  | Words to match, case-insensitive. |
| `offset` | integer | no | `0` | Start position for paging (25 per page). |

## get_software

**Read a software package page**

Details of one Softwarefinder package (how to obtain it, licence notes, platforms) by the id from search_software. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `id` | string | yes |  | Package id from search_software. |

## get_ict_notices

**ICT incidents and maintenance**

Current and recent ICT notices from the public status site (meldingen-ict.tudelft.nl): incidents, planned maintenance or information messages, with status updates. Public information, no login needed. Catalogue presence does not mean enrolment, entitlement or current availability.

Annotations: read-only, idempotent, talks to the university.

| Input | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `kind` | "incidents" or "maintenance" or "information" | no | `"incidents"` |  |
| `page` | integer | no | `1` |  |
