// Entry point of digitaljs's simulation worker thread (see digitaljs_src.mjs).
import './digitaljs_hooks.mjs';

await import('../../node_modules/digitaljs/src/engines/worker-worker.mjs');
