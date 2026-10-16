// The "Control" panel: run/pause/step, speed, run-for, timescale, and the
// top-level inputs and outputs. The panel does all time <-> tick conversion
// (src/time_units.mjs); the circuit view and the engine only see ticks.

import { parseTime, formatTime, formatFreq } from '../src/time_units.mjs';
import { read, show, size } from './schematic/values';

declare function acquireVsCodeApi(): { postMessage(msg: any): void };
declare global {
    interface Window { init_view: Row[]; init_timescale: string; init_speed: number | null; init_tick: number }
}
const vscode = acquireVsCodeApi();

// A row of the circuit view's iopanel:view message.
interface Row { id: string; label: string; dir: 'input' | 'output' | 'clock'; type: string; bits: number; value: any; rows?: number; cols?: number }
interface Widget { cells: HTMLElement[]; update(value: any): void; refresh?(): void; dir: string; bits: number; type: string }

const MAX_POS = 37;
const LED_ON = '#ff3b30'; // the LEDMatrix cell's colour
const LED_OFF = 'rgba(128, 128, 128, 0.22)'; // readable on light and dark themes
// Log scale: position p < MAX_POS is 10^(p/4) ticks/s (1 .. 1G), MAX_POS is
// "max" (null speed: flat out).
const posToSpeed = (pos: number) => (pos >= MAX_POS ? null : 10 ** (pos / 4));
const speedToPos = (speed: number | null) => (speed === null ? MAX_POS : Math.min(MAX_POS - 1, Math.max(0, Math.round(4 * Math.log10(speed)))));

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const post = (msg: any) => vscode.postMessage(msg);
const cmd = (panel_cmd: string, extra = {}) => post({ command: 'panel-cmd', panel_cmd, ...extra });

function cell(cls: string, ...children: (Node | string)[]) {
    const td = document.createElement('div');
    td.className = cls;
    td.append(...children);
    return td;
}
function nameCell(label: string) {
    const c = cell('io-name muted', label);
    c.title = label;
    return c;
}

class Status {
    #widgets: Record<string, Widget> = {};
    #running = false;
    #samples: [number, number][] = []; // [ms, tick] over the last second, for the measured speed
    #tick = 0;
    #tickSec = 1e-9; // seconds per tick, from the project's timescale option

    constructor() {
        window.addEventListener('message', (e) => this.#message(e.data));
        window.addEventListener('load', () => this.#init());
    }

    #init() {
        window.addEventListener('resize', () => { for (const w of Object.values(this.#widgets)) w.refresh?.(); });
        for (const [id, c] of [['start-sim', 'startsim'], ['pause-sim', 'pausesim'], ['single-step-sim', 'singlestepsim'],
                               ['next-event-sim', 'nexteventsim'], ['reset-sim', 'resetsim']])
            $(id).addEventListener('click', () => cmd(c));
        const runfor = $<HTMLInputElement>('runfor');
        const runFor = () => {
            const sec = parseTime(runfor.value);
            runfor.classList.toggle('invalid', sec === undefined);
            if (sec !== undefined) cmd('runfor', { ticks: Math.max(1, Math.round(sec / this.#tickSec)) });
        };
        $('runfor-sim').addEventListener('click', runFor);
        runfor.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$<HTMLButtonElement>('runfor-sim').disabled) runFor(); });
        const speed = $<HTMLInputElement>('speed');
        speed.value = String(speedToPos(window.init_speed));
        speed.addEventListener('input', () => this.#showSpeed());
        speed.addEventListener('change', () => post({ command: 'setspeed', speed: posToSpeed(Number(speed.value)) }));
        const timescale = $<HTMLInputElement>('timescale');
        timescale.addEventListener('change', () => {
            const sec = parseTime(timescale.value);
            timescale.classList.toggle('invalid', sec === undefined);
            if (sec !== undefined) post({ command: 'settimescale', value: formatTime(sec) });
        });
        this.#tick = window.init_tick;
        this.#setTimescale(window.init_timescale);
        // releases the host's queued messages
        post({ command: 'initialized' });
        this.#updateWidgets(window.init_view);
    }

    #setTimescale(timescale: string) {
        this.#tickSec = parseTime(timescale) || 1e-9;
        $<HTMLInputElement>('timescale').value = formatTime(this.#tickSec);
        this.#showTick();
        this.#showSpeed();
        for (const w of Object.values(this.#widgets)) w.refresh?.();
    }
    #showTick() {
        $('time-main').textContent = formatTime(this.#tick * this.#tickSec);
        $('time-ticks').textContent = `${this.#tick.toLocaleString('en-US').replace(/,/g, ' ')} ticks`;
    }
    #showSpeed() {
        const speed = $<HTMLInputElement>('speed'), pos = Number(speed.value), s = posToSpeed(pos);
        speed.style.setProperty('--fill', `${100 * pos / MAX_POS}%`);
        $('speed-label').textContent = s === null ? 'max' : `${formatTime(s * this.#tickSec)}/s`;
        $('speed-min').textContent = `${formatTime(this.#tickSec)}/s`;
        speed.title = s === null ? 'Simulation speed: as fast as possible' : `Simulation speed: ${Number(s.toPrecision(3))} ticks/s`;
        this.#showActualSpeed();
    }
    // Measured from the tick updates (one every ~25 ms): shows where the
    // circuit tops out when the requested speed is higher.
    #showActualSpeed() {
        const s = this.#samples, actual = $('speed-actual');
        if (!this.#running || s.length < 2 || s[s.length - 1][0] - s[0][0] < 200) {
            actual.textContent = '';
            return;
        }
        const rate = (s[s.length - 1][1] - s[0][1]) * 1000 / (s[s.length - 1][0] - s[0][0]);
        actual.textContent = `actual ≈ ${formatTime(rate * this.#tickSec)}/s`;
        actual.title = `Measured: ${Number(rate.toPrecision(3))} ticks/s`;
    }

    #updateWidgets(rows: Row[]) {
        const old = this.#widgets, panel = $('iopanel');
        this.#widgets = {};
        panel.replaceChildren();
        for (const row of rows) {
            let w = old[row.id];
            if (w && w.dir === row.dir && w.bits === row.bits && w.type === row.type) w.update(row.value);
            else w = { ...this.#newWidget(row), dir: row.dir, bits: row.bits, type: row.type };
            panel.append(...w.cells);
            w.refresh?.(); // now that it has a width (LED matrix)
            this.#widgets[row.id] = w;
        }
    }
    #newWidget(row: Row): Omit<Widget, 'dir' | 'bits' | 'type'> {
        if (row.dir === 'clock') return this.#clock(row);
        if (row.type === 'LEDMatrix' && row.rows && row.cols) return this.#ledMatrix(row);
        if (row.bits === 1) return row.dir === 'input' && row.type === 'PushButton' ? this.#pushButton(row) : this.#bit(row);
        return this.#number(row);
    }
    #bit(row: Row) {
        const input = row.dir === 'input';
        const box = document.createElement('input');
        box.type = 'checkbox';
        if (!input) {
            box.classList.add('readonly');
            box.tabIndex = -1;
        }
        const update = (v: string) => {
            box.indeterminate = !input && v !== '0' && v !== '1';
            box.checked = v === '1';
        };
        update(row.value);
        // a native checkbox doesn't fire `change` when set from code, so
        // updates from the circuit don't echo back
        if (input) box.addEventListener('change', () => post({ command: 'iopanel:update', id: row.id, value: box.checked ? '1' : '0' }));
        return { cells: [nameCell(row.label), cell('io-value', box), cell('io-extra')], update };
    }
    // Momentary: high only while held (mouse, touch, or Space/Enter).
    #pushButton(row: Row) {
        const button = document.createElement('button');
        button.className = 'primary';
        button.textContent = 'Push';
        let pressed = false;
        const set = (on: boolean) => {
            if (pressed === on) return;
            pressed = on;
            button.classList.toggle('pressed', on);
            post({ command: 'iopanel:update', id: row.id, value: on ? '1' : '0' });
        };
        button.addEventListener('pointerdown', () => set(true));
        for (const e of ['pointerup', 'pointerleave', 'blur']) button.addEventListener(e, () => set(false));
        button.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); set(true); } });
        button.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') set(false); });
        return { cells: [nameCell(row.label), cell('io-value', button), cell('io-extra')], update: () => {} };
    }
    // `value` is the Clock's propagation: ticks per half period.
    #clock(row: Row) {
        const input = document.createElement('input');
        input.type = 'text';
        input.title = 'Clock period (e.g. 200ns, 1us)';
        const freq = cell('mono');
        let value: number = row.value;
        const refresh = () => {
            const period = 2 * value * this.#tickSec;
            input.value = formatTime(period);
            input.classList.remove('invalid');
            freq.textContent = formatFreq(1 / period);
        };
        const update = (v: number) => { value = v; refresh(); };
        update(value);
        input.addEventListener('change', () => {
            const sec = parseTime(input.value);
            const v = sec === undefined ? value : Math.max(1, Math.round(sec / this.#tickSec / 2));
            refresh(); // the period actually used (whole ticks)
            if (sec === undefined) input.classList.add('invalid');
            if (v === value) return;
            update(v);
            post({ command: 'iopanel:update', id: row.id, value: v });
        });
        return { cells: [nameCell(row.label), cell('io-value', input), cell('io-extra muted', freq)], update, refresh };
    }
    // A small copy of the circuit's LEDMatrix: bit r*cols+c is row r, column c
    // (the last character of the value is bit 0).
    #ledMatrix(row: Row) {
        const { rows, cols, bits } = row as Required<Row>;
        const canvas = document.createElement('canvas');
        canvas.className = 'ledmatrix';
        const head = document.createElement('div');
        head.append(nameCell(row.label), cell('muted dims', `${rows}×${cols}`));
        const wrap = cell('io-wide', head, canvas);
        let bin: string = row.value;
        const draw = () => {
            // no width before it is attached; redrawn on append and resize
            const width = wrap.clientWidth || 240;
            const pitch = Math.max(2, Math.min(14, Math.floor(width / cols)));
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = `${pitch * cols}px`;
            canvas.style.height = `${pitch * rows}px`;
            canvas.width = pitch * cols * dpr;
            canvas.height = pitch * rows * dpr;
            const ctx = canvas.getContext('2d')!;
            ctx.scale(dpr, dpr);
            for (let r = 0; r < rows; r++)
                for (let c = 0; c < cols; c++) {
                    ctx.fillStyle = bin[bits - 1 - (r * cols + c)] === '1' ? LED_ON : LED_OFF;
                    ctx.beginPath();
                    ctx.arc((c + 0.5) * pitch, (r + 0.5) * pitch, pitch * 0.4, 0, 2 * Math.PI);
                    ctx.fill();
                }
        };
        return { cells: [wrap], update: (v: string) => { bin = v; draw(); }, refresh: draw };
    }
    #number(row: Row) {
        const isInput = row.dir === 'input', bits = row.bits;
        const input = document.createElement('input');
        input.type = 'text';
        input.readOnly = !isInput;
        input.className = 'mono';
        const base = document.createElement('select');
        for (const b of ['hex', 'bin', 'oct', 'dec']) base.add(new Option(b, b));
        let bin: string = row.value;
        const update = (v: string) => {
            bin = v;
            // the text can change with the base even if the value didn't
            input.value = show(base.value, bin);
            input.classList.remove('invalid');
            if (!isInput) input.title = input.value; // wide outputs end in an ellipsis
        };
        base.addEventListener('change', () => {
            input.size = Math.min(size(base.value, bits), 16);
            if (isInput) input.maxLength = size(base.value, bits);
            update(bin);
        });
        base.dispatchEvent(new Event('change'));
        if (isInput)
            input.addEventListener('change', () => {
                const v = read(base.value, input.value, bits);
                input.classList.toggle('invalid', v === undefined);
                if (v === undefined || v === bin) return;
                bin = v;
                post({ command: 'iopanel:update', id: row.id, value: v });
            });
        return { cells: [nameCell(row.label), cell('io-value', input), cell('io-extra', base)], update };
    }

    #message(m: any) {
        switch (m.command) {
            case 'tick': {
                this.#tick = m.tick;
                this.#showTick();
                const now = Date.now();
                this.#samples.push([now, m.tick]);
                while (now - this.#samples[0][0] > 1000) this.#samples.shift();
                this.#showActualSpeed();
                return;
            }
            case 'timescale':
                return this.#setTimescale(m.value);
            case 'runstate': {
                const s = m.state, free = !s.luaActive;
                this.#running = s.running;
                if (!s.running) this.#samples = [];
                this.#showActualSpeed();
                const enable = (id: string, on: boolean) => { $<HTMLButtonElement>(id).disabled = !on; };
                enable('start-sim', free && !s.running);
                enable('pause-sim', free && s.running);
                enable('single-step-sim', free && !s.running);
                enable('next-event-sim', free && !s.running && s.pendingEvents);
                enable('runfor-sim', free && !s.running);
                enable('reset-sim', s.hascircuit);
                return;
            }
            case 'iopanel:view':
                return this.#updateWidgets(m.view);
            case 'iopanel:update':
                return this.#widgets[m.id]?.update(m.value);
        }
    }
}

new Status();
