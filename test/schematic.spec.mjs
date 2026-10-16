//
'use strict';

// The new schematic (view/schematic/): its value formats, and the real
// webview bundle (dist/schematic.js) in Chromium on a real `hdlstudio serve`,
// with this file as the extension host. Needs yosys with read_slang for the
// designs (skips without it).

import assert from 'assert';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { level, read, show } from '../view/schematic/values.ts';
import { hdlstudio_bin } from '../src/hdlstudio_bin.mjs';
import { designs, synthesize, slangAvailable, convert } from './simdiff/designs.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('schematic values', function () {
    it('formats like 4vl', function () {
        assert.strictEqual(show('hex', '0000101'), '05');
        assert.strictEqual(show('hex', 'zzzz0001'), 'z1');
        assert.strictEqual(show('hex', 'zzz0001'), 'x1'); // a short top digit isn't all z
        assert.strictEqual(show('oct', '1x0101'), 'x5');
        assert.strictEqual(show('dec', '1111'), '15');
        assert.strictEqual(show('dec2c', '1111'), '-1');
        assert.strictEqual(show('dec', '1x11'), 'x');
        assert.strictEqual(show('dec', 'zzzz'), 'z');
    });
    it('reads like 4vl', function () {
        assert.strictEqual(read('hex', '5', 8), '00000101');
        assert.strictEqual(read('hex', 'x5', 12), 'xxxxxxxx0101');
        assert.strictEqual(read('hex', '1ff', 8), '11111111');
        assert.strictEqual(read('dec2c', '-1', 4), '1111');
        assert.strictEqual(read('bin', '12', 4), undefined);
    });
    it('classifies levels like digitaljs', function () {
        assert.deepStrictEqual(['111', '000', '010', 'zzz', 'z1z', 'x00'].map(level), ['high', 'low', 'def', 'highz', 'undef', 'undef']);
    });
});

describe('schematic webview on the engine', function () {
    this.timeout(120000);
    let browser, page, engine;
    const errors = [];

    before(async function () {
        if (!slangAvailable() || !fs.existsSync(path.join(root, 'dist/schematic.js'))) {
            console.warn('  yosys with read_slang or dist/schematic.js missing - skipping the webview test');
            this.skip();
        }
        const { chromium } = await import('playwright');
        engine = spawn(hdlstudio_bin(), ['serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
        browser = await chromium.launch();
        page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
        page.on('pageerror', (e) => errors.push(e.stack));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        await page.exposeFunction('__engineSend', (line) => engine.stdin.write(line + '\n'));
        readline.createInterface({ input: engine.stdout }).on('line', (line) => {
            page.evaluate((ev) => window.postMessage({ command: 'engine', ev }, '*'), JSON.parse(line)).catch(() => {});
        });
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><script>
            window.__posted = [];
            window.acquireVsCodeApi = () => ({ postMessage: (m) => m.command === 'engine' ? window.__engineSend(JSON.stringify(m.req)) : window.__posted.push(m) });
            </script><script type="module" src="http://host/dist/schematic.js"></script></head><body><div id="paper"></div></body></html>`;
        await page.route('http://host/**', (r) => {
            const p = new URL(r.request().url()).pathname;
            return p === '/' ? r.fulfill({ body: html, contentType: 'text/html' }) : r.fulfill({ path: path.join(root, p) });
        });
        await page.goto('http://host/');
    });
    after(async function () {
        await browser?.close();
        engine?.kill();
    });
    afterEach(function () {
        assert.deepStrictEqual(errors.splice(0), []);
    });

    const post = (m) => page.evaluate((m) => window.postMessage(m, '*'), m);
    const posted = (cmd) => page.evaluate((cmd) => window.__posted.filter((m) => m.command === cmd), cmd);
    const lastPosted = async (cmd) => (await posted(cmd)).pop();
    const show = async (name) => {
        const circuit = JSON.parse(convert(synthesize(designs.find((d) => d.name === name))));
        await page.evaluate(() => { window.__posted = []; });
        await post({ command: 'showcircuit', circuit, opts: { speed: null } });
        await page.waitForFunction(() => window.__posted.some((m) => m.command === 'iopanel:view'));
        return (await lastPosted('iopanel:view')).view;
    };
    const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 20000 });

    it('runs the board: the matrix lights up, subcircuits open, reset goes back to tick 0', async function () {
        const view = await show('soc board');
        const io = (label) => view.find((r) => r.label === label).id;
        const matrix = view.find((r) => r.type === 'LEDMatrix').id;
        await post({ command: 'iopanel:update', id: io('rst'), value: '1' });
        await post({ command: 'startsim' });
        await page.waitForTimeout(200);
        await post({ command: 'iopanel:update', id: io('rst'), value: '0' });
        // the matrix in the panel and on the canvas
        await until((id) => window.__posted.some((m) => m.command === 'iopanel:update' && m.id === id && m.value.includes('1')), matrix);
        await until(() => [...document.querySelectorAll('circle')].some((c) => c.getAttribute('fill') === '#ff3b30'));
        await page.evaluate(() => [...document.querySelectorAll('.cell')].find((g) => g.querySelector('.open'))
            .dispatchEvent(new MouseEvent('dblclick', { bubbles: true })));
        await until(() => document.querySelectorAll('.dialog svg .cell').length > 5);
        const n = await page.evaluate(() => window.__posted.length);
        await post({ command: 'resetsim' });
        await until((n) => window.__posted.slice(n).some((m) => m.command === 'tick' && m.tick === 0), n);
        assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.dialog').length), 1);
    });

    it('moves a cell without restarting the simulation', async function () {
        await show('04_counter');
        await post({ command: 'startsim' });
        const id = await page.evaluate(() => [...document.querySelectorAll('.cell')].find((g) => g.querySelector('.numvalue'))?.dataset.id);
        const r = await page.evaluate((id) => document.querySelector(`.cell[data-id="${id}"] rect`).getBoundingClientRect().toJSON(), id);
        await page.mouse.move(r.x + 5, r.y + 5);
        await page.mouse.down();
        await page.mouse.move(r.x + 45, r.y + 65, { steps: 4 });
        await page.mouse.up();
        const edit = await lastPosted('updatecircuit');
        assert.strictEqual(edit.type, 'pos');
        // the host sends the edited document back (undo/redo do the same)
        const tick = (await lastPosted('tick')).tick;
        await post({ command: 'showcircuit', circuit: edit.circuit, opts: { keep: true } });
        await until((t) => window.__posted.some((m) => m.command === 'tick' && m.tick > t), tick);
    });

    it('exports the drawing as SVG and PNG', async function () {
        await show('09_bcd_to_7seg');
        for (const type of ['image/svg+xml', 'image/png'])
            await post({ command: 'exportimage', type, uri: 'file:///img' });
        await until(() => window.__posted.filter((m) => m.command === 'saveimg').length === 2);
        const [svg, png] = await posted('saveimg');
        assert.match(svg.data, /^<svg/);
        assert.strictEqual(png.base64, true);
    });

    it('runs a Lua script in the engine', async function () {
        await show('04_counter');
        const script = fs.readFileSync(path.join(root, 'test/verilog/04_counter/counter_sim.lua'), 'utf8');
        await post({ command: 'runlua', name: 'counter_sim.lua', label: 'counter_sim.lua', script });
        await until(() => window.__posted.some((m) => m.command === 'luastop'));
        const out = (await posted('luaprint')).map((m) => m.messages.join('\t')).join('');
        assert.match(out, /ciclo 20: count=3/);
    });
});
