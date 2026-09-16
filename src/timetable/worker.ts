// Placeholder worker entry; replaced by the timetable module.
import { parentPort } from 'node:worker_threads';
parentPort?.postMessage({ error: { code: 'INTERNAL_ERROR', message: 'not built' } });
