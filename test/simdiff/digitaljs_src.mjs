// digitaljs's src/ tree in plain Node, with its real WorkerEngine (the
// engine the extension runs) on a worker thread started from worker_boot.mjs.
import './digitaljs_hooks.mjs';

const src = new URL('../../node_modules/digitaljs/src/', import.meta.url);
export const { HeadlessCircuit } = await import(new URL('circuit.mjs', src));
export const { WorkerEngine } = await import(new URL('engines/worker.mjs', src));
export const { Vector4vl } = await import('@twint/4vl');
export const workerURL = new URL('./worker_boot.mjs', import.meta.url).href;
