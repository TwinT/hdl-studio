//

'use strict';

import $ from 'jquery';
import { Vector4vl, Display4vlWithRegex, Display4vl } from '@twint/4vl';
import { parseTime, formatTime, formatFreq } from '../src/time_units.mjs';

const vscode = acquireVsCodeApi();

const controlCodes20 = [
    'NUL', 'SOH', 'STX', 'ETX', 'EOT', 'ENQ', 'ACK', 'BEL',
    'BS',  'HT',  'LF',  'VT',  'FF',  'CR',  'SO',  'SI',
    'DLE', 'DC1', 'DC2', 'DC3', 'DC4', 'NAK', 'SYN', 'ETB',
    'CAN', 'EM',  'SUB', 'ESC', 'FS',  'GS',  'RS',  'US',
    'SP',  'DEL'];

// Copied from digitaljs since it wasn't exported.
class Display4vlASCII extends Display4vlWithRegex {
    constructor() {
        super('[\x20-\x7e\xa0-\xff\ufffd\u2400-\u2421]|' + controlCodes20.join('|'))
    }
    get name() {
        return "ascii";
    }
    get sort() {
        return 1;
    }
    can(kind, bits) {
        return bits == 7 || bits == 8;
    }
    read(data, bits) {
        if (data.length == 1) {
            const code = data.charCodeAt(0);
            if (code == 0xfffd) return Vector4vl.xes(bits);
            if (code == 0x2421) return Vector4vl.fromHex("7f", bits);
            if (code >= 0x2400 && code <= 0x2420)
                return Vector4vl.fromHex((code - 0x2400).toString(16), bits);
            return Vector4vl.fromHex(code.toString(16), bits);
        } else {
            const code = controlCodes20.indexOf(data);
            if (code < 0) return Vector4vl.xes(bits);
            if (code == 0x21) return Vector4vl.fromHex("7f", bits);
            return Vector4vl.fromHex(code.toString(16), bits);
        }
    }
    show(data) {
        if (!data.isFullyDefined) return "\ufffd";
        const code = parseInt(data.toHex(), 16);
        if (code <= 0x20) {
            return String.fromCharCode(0x2400 + code);
        }
        if (code == 0x7f) return "\u2421";
        if (code > 0x7f && code < 0xa0) {
            return "\ufffd";
        }
        return String.fromCharCode(code);
    }
    size(bits) {
        return 1;
    }
}

const MAX_POS = 37;
const LED_ON = '#ff3b30'; // the LEDMatrix cell's colour
const LED_OFF = 'rgba(128, 128, 128, 0.22)'; // readable on light and dark themes
const pos_to_speed = (pos) => Number(pos) >= MAX_POS ? null : 10 ** (Number(pos) / 4);
const speed_to_pos = (speed) => speed === null ? MAX_POS :
    Math.min(MAX_POS - 1, Math.max(0, Math.round(4 * Math.log10(speed))));

class Status {
    #dp3vl
    #widgets
    #time_main
    #time_ticks
    #speed_min
    #speed_actual
    #running = false
    #samples = [] // [ms, tick] over the last second, for the measured speed
    #iopanel
    #start_btn
    #pause_btn
    #single_step_btn
    #next_event_btn
    #reset_btn
    #runfor_btn
    #speed
    #speed_label
    #timescale
    #tick = 0
    #tick_sec = 1e-9 // seconds per tick, from the project's timescale option
    constructor() {
        window.addEventListener('message', event => this.#processMessage(event));
        window.addEventListener("load", () => this.#initialize());
        this.#dp3vl = new Display4vl();
        this.#dp3vl.addDisplay(new Display4vlASCII());
        this.#widgets = {};
    }
    #initialize() {
        this.#time_main = $('#time-main');
        this.#time_ticks = $('#time-ticks');
        this.#speed_min = $('#speed-min');
        this.#speed_actual = $('#speed-actual');
        $(window).on('resize', () => {
            for (const key in this.#widgets)
                this.#widgets[key].refresh?.();
        });
        this.#iopanel = $('#iopanel');
        this.#start_btn = $('#start-sim');
        this.#pause_btn = $('#pause-sim');
        this.#single_step_btn = $('#single-step-sim');
        this.#next_event_btn = $('#next-event-sim');
        this.#reset_btn = $('#reset-sim');
        this.#runfor_btn = $('#runfor-sim');
        this.#speed = $('#speed');
        this.#speed_label = $('#speed-label');
        this.#timescale = $('#timescale');
        const btn_cmd = (btn, panel_cmd) => {
            btn.click(() => {
                vscode.postMessage({ command: 'panel-cmd', panel_cmd });
            });
        };
        btn_cmd(this.#start_btn, 'startsim');
        btn_cmd(this.#pause_btn, 'pausesim');
        btn_cmd(this.#single_step_btn, 'singlestepsim');
        btn_cmd(this.#next_event_btn, 'nexteventsim');
        btn_cmd(this.#reset_btn, 'resetsim');

        const runfor = $('#runfor');
        this.#runfor_btn.click(() => {
            const sec = parseTime(runfor.val());
            if (sec === undefined)
                return;
            const ticks = Math.max(1, Math.round(sec / this.#tick_sec));
            vscode.postMessage({ command: 'panel-cmd', panel_cmd: 'runfor', ticks });
        });

        // Log scale: position p < MAX_POS is 10^(p/4) ticks/s (1 .. 1G), MAX_POS is
        // "max" (null speed: run flat out, what fast-forward used to do).
        this.#speed.val(speed_to_pos(window.init_speed));
        this.#speed.on('input', () => this.#showSpeed());
        this.#speed.on('change', () => {
            vscode.postMessage({ command: 'setspeed', speed: pos_to_speed(this.#speed.val()) });
        });

        this.#timescale.change((e) => {
            const sec = parseTime(e.target.value);
            if (sec === undefined)
                return;
            vscode.postMessage({ command: 'settimescale', value: formatTime(sec) });
        });
        this.#tick = window.init_tick;
        this.#setTimescale(window.init_timescale);

        // Release the messages from the main extension
        vscode.postMessage({ command: 'initialized' });
        this.#updateWidgets(window.init_view);
    }
    #setTimescale(timescale) {
        this.#tick_sec = parseTime(timescale) || 1e-9;
        this.#timescale.val(formatTime(this.#tick_sec));
        this.#showTick();
        this.#showSpeed();
        for (const key in this.#widgets)
            this.#widgets[key].refresh?.();
    }
    #showTick() {
        this.#time_main.text(formatTime(this.#tick * this.#tick_sec));
        this.#time_ticks.text(`${this.#tick.toLocaleString('en-US').replace(/,/g, '\u2009')} ticks`);
    }
    #showSpeed() {
        const pos = Number(this.#speed.val());
        const speed = pos_to_speed(pos);
        this.#speed[0].style.setProperty('--fill', `${100 * pos / MAX_POS}%`);
        this.#speed_label.text(speed === null ? 'max' : `${formatTime(speed * this.#tick_sec)}/s`);
        this.#speed_min.text(`${formatTime(this.#tick_sec)}/s`);
        this.#speed.prop('title', speed === null ? 'Simulation speed: as fast as possible'
                                                 : `Simulation speed: ${Number(speed.toPrecision(3))} ticks/s`);
        this.#showActualSpeed();
    }
    // Measured from the tick updates (the worker sends one every ~25 ms):
    // shows where the circuit tops out when the requested speed is higher.
    #showActualSpeed() {
        const s = this.#samples;
        if (!this.#running || s.length < 2 || s[s.length - 1][0] - s[0][0] < 200) {
            this.#speed_actual.text('');
            return;
        }
        const rate = (s[s.length - 1][1] - s[0][1]) * 1000 / (s[s.length - 1][0] - s[0][0]);
        this.#speed_actual.text(`actual ≈ ${formatTime(rate * this.#tick_sec)}/s`)
            .attr('title', `Measured: ${Number(rate.toPrecision(3))} ticks/s`);
    }
    #updateWidgets(views) {
        const old_widgets = this.#widgets;
        this.#widgets = {};
        for (const key in old_widgets)
            old_widgets[key].widget.detach();
        for (const view of views) {
            const old_w = old_widgets[view.id];
            if (old_w && old_w.dir == view.dir && old_w.bits == view.bits && old_w.type == view.type) {
                old_w.updater(view.value);
                this.#iopanel.append(old_w.widget);
                this.#widgets[view.id] = old_w;
                continue;
            }
            const w = this.#newWidget(view);
            this.#iopanel.append(w.widget);
            w.refresh?.(); // now that it has a width (LED matrix)
            this.#widgets[view.id] = w;
        }
    }
    #newWidget(view) {
        if (view.dir == 'clock') {
            const w = this.#newClockWidget(view);
            w.dir = view.dir;
            return w;
        }
        const is_input = view.dir == 'input';
        const w = view.type == 'LEDMatrix' && view.rows && view.cols ? this.#newLedMatrixWidget(view) :
                  view.bits == 1 ? this.#newBitWidget(view, is_input) :
                  this.#newNumberWidget(view, is_input);
        w.dir = view.dir;
        w.bits = view.bits;
        w.type = view.type;
        return w;
    }
    #newBitWidget(view, is_input) {
        if (is_input && view.type == 'PushButton')
            return this.#newPushButtonWidget(view);
        const id = view.id;
        const widget = $(`<tr>
  <td class="djs-io-name djs-muted"></td>
  <td class="djs-io-value">
    <vscode-checkbox ${is_input ? '' : 'readonly'} style="vertical-align:middle;"></vscode-checkbox>
  </td>
  <td class="djs-io-extra"></td>
</tr>`);
        widget.find('.djs-io-name').text(view.label).attr('title', view.label);
        const checkbox = widget.find('vscode-checkbox');
        let bin = view.value;
        const updater = (new_bin) => {
            bin = new_bin;
            const value = Vector4vl.fromBin(bin, 1);
            if (!is_input)
                checkbox.prop('indeterminate', !value.isDefined);
            checkbox.prop('checked', value.isHigh);
        };
        updater(view.value);
        if (is_input) {
            checkbox.change(() => {
                const new_bin = checkbox.prop('checked') ? '1' : '0';
                if (new_bin == bin)
                    return;
                bin = new_bin;
                vscode.postMessage({ command: 'iopanel:update', id, value: new_bin });
            });
        }
        return { widget, updater };
    }
    // Momentary pushbutton: high only while held, unlike the checkbox above
    // (click-to-toggle-and-latch). Known gap: <vscode-button> only fires
    // 'click' for Enter/Space, so this widget isn't keyboard-operable.
    #newPushButtonWidget(view) {
        const id = view.id;
        const widget = $(`<tr>
  <td class="djs-io-name djs-muted"></td>
  <td class="djs-io-value">
    <vscode-button style="vertical-align:middle;">Push</vscode-button>
  </td>
  <td class="djs-io-extra"></td>
</tr>`);
        widget.find('.djs-io-name').text(view.label).attr('title', view.label);
        const button = widget.find('vscode-button');
        // Nothing to reflect visually from an incoming value: the widget is
        // just a momentary press trigger, not a state display.
        const updater = () => {};
        let pressed = false;
        const post = (new_bin) => {
            vscode.postMessage({ command: 'iopanel:update', id, value: new_bin });
        };
        button.on('mousedown', () => {
            if (pressed) return;
            pressed = true;
            post('1');
        });
        button.on('mouseup mouseleave', () => {
            if (!pressed) return;
            pressed = false;
            post('0');
        });
        return { widget, updater };
    }
    #newClockWidget(view) {
        const id = view.id;
        const widget = $(`<tr>
  <td class="djs-io-name djs-muted"></td>
  <td class="djs-io-value">
    <vscode-text-field title="Clock period (e.g. 200ns, 1us)"></vscode-text-field>
  </td>
  <td class="djs-io-extra djs-muted"><span class="djs-clock-freq djs-mono"></span></td>
</tr>`);
        widget.find('.djs-io-name').text(view.label).attr('title', view.label);
        const input = widget.find('vscode-text-field');
        const freq = widget.find('span.djs-clock-freq');
        // `value` is the Clock's propagation: ticks per half period.
        let value = view.value;
        const refresh = () => {
            const period = 2 * value * this.#tick_sec;
            input.val(formatTime(period));
            freq.text(formatFreq(1 / period));
        };
        const updater = (new_value) => {
            value = new_value;
            refresh();
        };
        updater(value);
        input.change((e) => {
            const sec = parseTime(e.target.value);
            const new_value = sec === undefined ? value :
                Math.max(1, Math.round(sec / this.#tick_sec / 2));
            refresh(); // show the period actually used (rounded to whole ticks)
            if (new_value == value)
                return;
            updater(new_value);
            vscode.postMessage({ command: 'iopanel:update', id, value });
        });
        return { widget, updater, refresh };
    }
    // A small copy of the circuit's LEDMatrix cell (cells/ledmatrix.mjs): same
    // row-major, LSB-first mapping (bit r*cols+c is row r, column c) and the
    // same lit colour. toBin() is MSB first, so bit i is bin[bits-1-i].
    #newLedMatrixWidget(view) {
        const { rows, cols, bits } = view;
        const widget = $(`<tr>
  <td colspan="3">
    <div><span class="djs-io-name djs-muted"></span> <span class="djs-muted djs-io-dims"></span></div>
    <canvas class="djs-ledmatrix"></canvas>
  </td>
</tr>`);
        widget.find('.djs-io-name').text(view.label).attr('title', view.label);
        widget.find('.djs-io-dims').text(`${rows}×${cols}`);
        const canvas = widget.find('canvas')[0];
        let bin = view.value;
        const draw = () => {
            // before the row is attached there's no width yet; redrawn on append/resize
            const width = canvas.parentElement.clientWidth || 240;
            const pitch = Math.max(2, Math.min(14, Math.floor(width / cols)));
            const dpr = window.devicePixelRatio || 1;
            canvas.style.width = `${pitch * cols}px`;
            canvas.style.height = `${pitch * rows}px`;
            canvas.width = pitch * cols * dpr;
            canvas.height = pitch * rows * dpr;
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                    ctx.fillStyle = bin[bits - 1 - (r * cols + c)] === '1' ? LED_ON : LED_OFF;
                    ctx.beginPath();
                    ctx.arc((c + 0.5) * pitch, (r + 0.5) * pitch, pitch * 0.4, 0, 2 * Math.PI);
                    ctx.fill();
                }
            }
        };
        const updater = (new_bin) => {
            bin = new_bin;
            draw();
        };
        updater(bin);
        return { widget, updater, refresh: draw };
    }
    #newNumberWidget(view, is_input) {
        const id = view.id;
        const widget = $(`<tr>
  <td class="djs-io-name djs-muted"></td>
  <td class="djs-io-value">
    <vscode-text-field ${is_input ? '' : 'readonly'} style="vertical-align:middle;"></vscode-text-field>
  </td>
  <td class="djs-io-extra">
    <vscode-dropdown>
      <vscode-option value="hex">hex</vscode-option>
      <vscode-option value="bin">bin</vscode-option>
      <vscode-option value="oct">oct</vscode-option>
      <vscode-option value="dec">dec</vscode-option>
    </vscode-dropdown>
  </td>
</tr>`);
        widget.find('.djs-io-name').text(view.label).attr('title', view.label);
        const input = widget.find('vscode-text-field');
        const base_sel = widget.find('vscode-dropdown');
        const bits = view.bits;
        let base;
        let bin = view.value;
        const updater = (new_bin) => {
            bin = new_bin;
            // Note that even if the value didn't change, the display value might.
            const value = Vector4vl.fromBin(bin, bits);
            const text = this.#dp3vl.show(base, value);
            input.val(text);
            if (!is_input)
                input.attr('title', text); // wide outputs are cut off with an ellipsis
        };
        const base_updater = (new_base) => {
            if (base === new_base)
                return;
            base = new_base;
            const sz = this.#dp3vl.size(base, bits);
            input.prop('size', Math.min(sz, 16));
            if (is_input)
                input.prop('maxlength', sz)
                     .prop('pattern', this.#dp3vl.pattern(base));
            updater(bin);
        };
        base_updater('hex');
        base_sel.change(() => {
            base_updater(base_sel.val());
        });
        if (is_input) {
            input.change((e) => {
                if (!this.#dp3vl.validate(base, e.target.value, bits))
                    return;
                const value = this.#dp3vl.read(base, e.target.value, bits);
                const new_bin = value.toBin(value);
                if (new_bin == bin)
                    return;
                bin = new_bin;
                vscode.postMessage({ command: 'iopanel:update', id, value: bin });
            });
        }
        return { widget, updater };
    }
    #processMessage(event) {
        const message = event.data;
        switch (message.command) {
            case 'tick': {
                this.#tick = message.tick;
                this.#showTick();
                const now = Date.now();
                this.#samples.push([now, message.tick]);
                while (now - this.#samples[0][0] > 1000)
                    this.#samples.shift();
                this.#showActualSpeed();
                return;
            }
            case 'timescale':
                this.#setTimescale(message.value);
                return;
            case 'runstate': {
                const state = message.state;
                const ele_enabled = (ele, enable) => {
                    ele.attr('disabled', enable ? null : true);
                };
                const active = !state.luaActive;
                this.#running = state.running;
                if (!state.running)
                    this.#samples = [];
                this.#showActualSpeed();
                ele_enabled(this.#start_btn, active && !state.running);
                ele_enabled(this.#pause_btn, active && state.running);
                ele_enabled(this.#single_step_btn, active && !state.running);
                ele_enabled(this.#next_event_btn, active && !state.running && state.pendingEvents);
                ele_enabled(this.#runfor_btn, active && !state.running);
                ele_enabled(this.#reset_btn, state.hascircuit);
                return;
            }
            case 'iopanel:view':
                this.#updateWidgets(message.view);
                return;
            case 'iopanel:update': {
                const w = this.#widgets[message.id];
                if (w)
                    w.updater(message.value);
                return;
            }
        }
    }
}

new Status();
