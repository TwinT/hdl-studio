// A memory's contents, and the editor that shows them: pages of 8 rows,
// cells being read or written marked, edits written to the engine.

import { Device } from './cells';
import { bases, read, show, size } from './values';

// The words of a memory: its initial contents (memdata) plus what the
// engine wrote since.
export class MemContents {
    readonly bits: number;
    readonly words: number;
    #init: string[] = [];
    #written = new Map<number, string>();
    listeners = new Set<(addr: number) => void>();
    constructor(d: Device) {
        this.bits = d.bits;
        this.words = d.words ?? 2 ** d.abits;
        const hexlen = Math.ceil(this.bits / 4);
        const decode = (x: string) => {
            if (x.length === this.bits) this.#init.push(x);
            else for (let i = 0; i < x.length; i += hexlen) this.#init.push(read('hex', x.slice(i, i + hexlen), this.bits)!);
        };
        const rep: (string | number)[] = d.memdata ?? [];
        for (let i = 0; i < rep.length; i++) {
            const item = rep[i];
            if (typeof item === 'number') {
                for (let k = 0; k < item; k++) decode(rep[i + 1] as string);
                i++;
            } else decode(item);
        }
    }
    get(addr: number) {
        return this.#written.get(addr) ?? this.#init[addr] ?? 'x'.repeat(this.bits);
    }
    set(addr: number, value: string) {
        this.#written.set(addr, value);
        for (const fn of this.listeners) fn(addr);
    }
    // Back to the initial contents (a reset); listeners get -1.
    reset() {
        this.#written.clear();
        for (const fn of this.listeners) fn(-1);
    }
}

export interface MemPorts {
    // the address on each read and write port, or undefined if unknown
    reads(): (number | undefined)[];
    writes(): (number | undefined)[];
}

export function memoryEditor(d: Device, mem: MemContents, ports: MemPorts, write: (addr: number, value: string) => void) {
    const root = document.createElement('div');
    root.className = 'memeditor';
    root.innerHTML = `<div class="toolbar">
        <button name="prev" class="codicon codicon-arrow-left" title="Previous page"></button>
        <button name="next" class="codicon codicon-arrow-right" title="Next page"></button>
        <select name="base">${bases.map((b) => `<option${b === 'hex' ? ' selected' : ''}>${b}</option>`).join('')}</select>
    </div><table></table>`;
    const $ = <T extends Element>(q: string) => root.querySelector(q) as T;
    const table = $<HTMLTableElement>('table'), base = $<HTMLSelectElement>('select');
    const prev = $<HTMLButtonElement>('[name=prev]'), next = $<HTMLButtonElement>('[name=next]');
    const words = mem.words, rows = 8, ahex = Math.ceil(d.abits / 4);
    let columns = 1, address = 0;
    let inputs: HTMLInputElement[] = [];
    const cell = (addr: number) => inputs[addr - address];
    const marks = () => {
        for (const i of inputs) i.classList.remove('isread', 'iswrite');
        ports.reads().forEach((a) => a !== undefined && cell(a)?.classList.add('isread'));
        ports.writes().forEach((a) => a !== undefined && cell(a)?.classList.add('iswrite'));
    };
    const fill = () => {
        prev.disabled = address <= 0;
        next.disabled = address + rows * columns >= words;
        inputs.forEach((input, k) => {
            input.value = show(base.value, mem.get(address + k));
            input.classList.remove('invalid');
        });
        [...table.rows].forEach((tr, r) => { tr.cells[0].textContent = (address + r * columns).toString(16).padStart(ahex, '0'); });
        marks();
    };
    const redraw = () => {
        const ds = size(base.value, mem.bits);
        columns = Math.min(words, 16, Math.ceil(32 / ds));
        address = Math.max(0, Math.min(words - rows * columns, address));
        table.replaceChildren();
        inputs = [];
        for (let r = 0; r < rows && address + r * columns < words; r++) {
            const tr = table.insertRow();
            tr.insertCell();
            for (let c = 0; c < columns && address + r * columns + c < words; c++) {
                const input = document.createElement('input');
                input.size = input.maxLength = ds;
                const addr = () => address + r * columns + c;
                input.addEventListener('change', () => {
                    const v = read(base.value, input.value, mem.bits);
                    input.classList.toggle('invalid', v === undefined);
                    if (v !== undefined) {
                        mem.set(addr(), v);
                        write(addr(), v);
                    }
                });
                tr.insertCell().appendChild(input);
                inputs.push(input);
            }
        }
        fill();
    };
    base.addEventListener('change', redraw);
    prev.addEventListener('click', () => { address = Math.max(0, address - rows * columns); fill(); });
    next.addEventListener('click', () => { address = Math.min(words - rows * columns, address + rows * columns); fill(); });
    const changed = (addr: number) => {
        if (addr < 0) return fill();
        const input = cell(addr);
        if (!input || document.activeElement === input) return;
        input.value = show(base.value, mem.get(addr));
        input.classList.remove('flash');
        void input.offsetWidth; // restart the animation
        input.classList.add('flash');
    };
    mem.listeners.add(changed);
    redraw();
    return { root, update: marks, close: () => mem.listeners.delete(changed) };
}
