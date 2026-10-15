// Entry point of digitaljs's simulation worker thread (see digitaljs_src.mjs).
import './digitaljs_hooks.mjs';

// Known digitaljs bugs that hdlstudio fixes: the harness applies the same
// fixes here, so the traces only differ where the port is wrong.
const { Memory } = await import('../../node_modules/digitaljs/src/cells/memory.mjs');
const operation = Memory.prototype.operation;
// Memory transparency/collision compare read and write addresses with JS
// `==`, by object; hdlstudio compares them by value. Making equal
// addresses the same object gives digitaljs the same rule.
Memory.prototype.operation = function (data) {
    const addrs = Object.keys(data).filter((p) => /^(rd|wr)\d+addr$/.test(p));
    const byValue = new Map();
    data = { ...data };
    for (const p of addrs) {
        const key = data[p].toBin();
        if (!byValue.has(key)) byValue.set(key, data[p]);
        data[p] = byValue.get(key);
    }
    return operation.call(this, data);
};

await import('../../node_modules/digitaljs/src/engines/worker-worker.mjs');
