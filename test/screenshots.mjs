//
'use strict';

// The README's screenshots of the circuit view (imgs/screenshots/: a
// subcircuit window with a source line lit, the memory editor, an FSM's
// diagram, the board's LED matrix, the waveform monitor), taken in
// test/schematic.spec.mjs's harness on a real engine. Not a test: run it by
// hand after a change to the view, with dist/schematic.js built (npm run
// compile) and yosys with read_slang:
//
//   node test/screenshots.mjs [OUTDIR]
//
// The others (VS Code's own panels) are taken by hand.

import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { chromium } from 'playwright';
import { designs, synthesize, convert } from './designs.mjs';
import { hdlstudio_bin } from '../src/hdlstudio_bin.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] ?? path.join(root, 'imgs/screenshots');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 760 }, deviceScaleFactor: 1 });
let engine;
const startEngine = () => {
    engine = spawn(hdlstudio_bin(), ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
    readline.createInterface({ input: engine.stdout }).on('line', (line) =>
        page.evaluate((ev) => window.postMessage({ command: 'engine', ev }, '*'), JSON.parse(line)).catch(() => {}));
};
await page.exposeFunction('__engineSend', (line) => engine.stdin.write(line + '\n'));
startEngine();
const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link href="http://host/node_modules/@vscode/codicons/dist/codicon.css" rel="stylesheet"/>
<script>window.__posted = []; window.acquireVsCodeApi = () => ({ postMessage: (m) => m.command === 'engine' ? window.__engineSend(JSON.stringify(m.req)) : window.__posted.push(m) });</script>
<script type="module" src="http://host/dist/schematic.js"></script>
<style>body { margin: 0; height: 100vh; font-family: sans-serif; }</style></head><body><div id="paper"></div></body></html>`;
await page.route('http://host/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    return p === '/' ? r.fulfill({ body: html, contentType: 'text/html' }) : r.fulfill({ path: path.join(root, p) });
});
await page.goto('http://host/');
const post = (m) => page.evaluate((m) => window.postMessage(m, '*'), m);
const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000 });
const show = async (name, opts = {}, synth = {}) => {
    await post({ command: 'showcircuit', circuit: { devices: {}, connectors: [] }, opts: {} });
    const circuit = JSON.parse(convert(synthesize(designs.find((d) => d.name === name), synth)));
    await page.evaluate(() => { window.__posted = []; });
    await post({ command: 'showcircuit', circuit, opts: { speed: null, ...opts } });
    await until(() => window.__posted.some((m) => m.command === 'iopanel:view'));
    return { circuit };
};
const io = async (label) => (await page.evaluate(() => window.__posted.findLast((m) => m.command === 'iopanel:view').view)).find((r) => r.label === label).id;
const dbl = (sel) => page.evaluate((sel) => document.querySelector(sel).dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true })), sel);
const shot = (name, clip) => page.screenshot({ path: path.join(out, name), ...(clip ? { clip } : {}) });

// 1. a subcircuit window, and the cells a source line made
{
    const { circuit } = await show('08_contador_decadas');
    await post({ command: 'iopanel:update', id: await io('rst'), value: '1' });
    await post({ command: 'startsim' });
    await page.waitForTimeout(300);
    await post({ command: 'iopanel:update', id: await io('rst'), value: '0' });
    const sub = Object.keys(circuit.devices).find((id) => circuit.devices[id].type === 'Subcircuit');
    await dbl(`.cell[data-id="${sub}"]`);
    await until(() => document.querySelectorAll('.dialog svg .cell').length > 3);
    const devs = Object.values(circuit.subcircuits[circuit.devices[sub].celltype].devices);
    const pos = devs.filter((d) => /Add/.test(d.type)).flatMap((d) => d.source_positions ?? [])[0] ?? devs.flatMap((d) => d.source_positions ?? [])[0];
    await post({ command: 'srcline', file: pos.name, line: pos.from.line });
    await page.waitForTimeout(1500);
    await post({ command: 'pausesim' });
    await page.mouse.move(5, 5);
    await shot('subcircuit-window.png', { x: 0, y: 40, width: 1120, height: 620 });
}

// 2. a memory and its editor
{
    const { circuit } = await show('07_rom');
    await post({ command: 'startsim' });
    await page.waitForTimeout(800);
    await post({ command: 'pausesim' });
    const mem = Object.keys(circuit.devices).find((id) => circuit.devices[id].type === 'Memory');
    await dbl(`.cell[data-id="${mem}"]`);
    await until(() => document.querySelector('.memeditor'));
    await page.waitForTimeout(300);
    await page.mouse.move(5, 5);
    await shot('memory-editor.png', { x: 0, y: 40, width: 1040, height: 400 });
}

// 3. an FSM as one cell and its state diagram
{
    const { circuit } = await show('alu', {}, { fsm: 'nomap' });
    const all = [['', circuit], ...Object.entries(circuit.subcircuits ?? {})];
    let fsmAt;
    for (const [type, g] of all) {
        const id = Object.keys(g.devices).find((i) => g.devices[i].type === 'FSM');
        if (id) { fsmAt = { type, id }; break; }
    }
    if (fsmAt) {
        if (fsmAt.type) {
            const inst = Object.keys(circuit.devices).find((id) => circuit.devices[id].celltype === fsmAt.type);
            await dbl(`.cell[data-id="${inst}"]`);
            await until(() => document.querySelectorAll('.dialog svg .cell').length > 1);
            await dbl(`.dialog .cell[data-id="${fsmAt.id}"]`);
        } else {
            await dbl(`.cell[data-id="${fsmAt.id}"]`);
        }
        await page.waitForTimeout(800);
        await page.mouse.move(5, 5);
        await shot('fsm-diagram.png');
    } else {
        console.log('no FSM cell in alu');
    }
}

// 4. the board: the LED matrix lit, run flat out
{
    await show('soc board');
    await post({ command: 'iopanel:update', id: await io('rst'), value: '1' });
    await post({ command: 'startsim' });
    await page.waitForTimeout(200);
    await post({ command: 'iopanel:update', id: await io('rst'), value: '0' });
    await until(() => [...document.querySelectorAll('circle')].filter((c) => c.getAttribute('fill') === '#ff3b30').length > 40);
    await page.waitForTimeout(2500);
    await post({ command: 'pausesim' });
    await page.mouse.move(5, 5);
    await shot('board-led-matrix.png', { x: 0, y: 50, width: 940, height: 210 });
}

// 5. waveforms: a group, the time cursor in the past
{
    const { circuit } = await show('04_counter', { pause: true });
    await page.evaluate((names) => {
        const seen = new Set();
        document.querySelectorAll('.wirehit').forEach((h, i) => {
            if (!names[i] || seen.has(names[i])) return;
            seen.add(names[i]);
            h.dispatchEvent(new window.MouseEvent('dblclick', { bubbles: true }));
        });
    }, circuit.connectors.map((c) => c.name));
    await post({ command: 'iopanel:update', id: await io('rst'), value: '1' });
    await post({ command: 'runfor', ticks: 250 });
    await page.waitForTimeout(500);
    await post({ command: 'iopanel:update', id: await io('rst'), value: '0' });
    await post({ command: 'runfor', ticks: 1800 });
    await page.waitForTimeout(800);
    await page.locator('#monitor button[name=fit]').click();
    await page.waitForTimeout(300);
    const names = await page.locator('#monitor .name').all();
    if (names.length >= 2) {
        await names[0].click();
        await names[1].click({ modifiers: ['Control'] });
        await names[0].click({ button: 'right' });
        const g = page.locator('.wavemenu button', { hasText: 'Group' }).first();
        if (await g.count()) { await g.click(); await page.keyboard.type('control'); await page.keyboard.press('Enter'); }
    }
    const wave = await page.evaluate(() => document.querySelector('#monitor .row canvas, #monitor canvas.wave')?.getBoundingClientRect().toJSON());
    if (wave) await page.mouse.click(wave.x + wave.width * 0.62, wave.y + 10);
    await page.waitForTimeout(600);
    await page.mouse.move(5, 5);
    await shot('waveforms.png');
}

await browser.close();
engine.kill();
console.log('done');
