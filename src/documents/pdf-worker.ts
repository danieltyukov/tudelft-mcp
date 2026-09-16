// Placeholder worker entry; replaced by the documents module.
import { parentPort } from 'node:worker_threads';
parentPort?.postMessage({ error: true });
