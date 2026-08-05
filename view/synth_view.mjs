//

'use strict';

const vscode = acquireVsCodeApi();

class Synth {
    #options
    #topModules
    #widgets
    #block_update = false
    constructor(options, topModules = []) {
        this.#options = options;
        this.#topModules = topModules;
        window.addEventListener('message', event => this.#processMessage(event));
        window.addEventListener("load", () => this.#initialize());
    }
    #notifyOption() {
        vscode.setState({ ...this.#options, view_id: window.view_id });
        if (this.#block_update)
            return;
        vscode.postMessage({ command: "update-options", options: this.#options });
    }
    #renderTopModules() {
        const ele = document.getElementById('top');
        if (!ele)
            return;
        ele.innerHTML = '';
        const auto = document.createElement('vscode-option');
        auto.value = '';
        auto.textContent = 'Auto';
        ele.appendChild(auto);
        for (const name of this.#topModules) {
            const opt = document.createElement('vscode-option');
            opt.value = name;
            opt.textContent = name;
            ele.appendChild(opt);
        }
        ele.value = this.#options.top || '';
    }
    #initialize() {
        this.#widgets = {};
        for (const opt of ['opt', 'transform', /* 'lint', */ 'fsmexpand', 'techmap', 'defaultcomb']) {
            const ele = document.getElementById(opt);
            this.#widgets[opt] = ele;
            if (!ele) // element missing (e.g. stale panel HTML): stay resilient
                continue;
            ele.checked = this.#options[opt];
            ele.addEventListener('change', () => {
                this.#options[opt] = ele.checked;
                this.#notifyOption();
            });
        }

        this.#renderTopModules();
        const top_ele = document.getElementById('top');
        this.#widgets.top = top_ele;
        if (top_ele) {
            top_ele.addEventListener('change', () => {
                this.#options.top = top_ele.value;
                this.#notifyOption();
            });
        }

        for (const opt of ['fsm', 'layout']) {
            const ele = document.getElementById(opt);
            this.#widgets[opt] = ele;
            if (!ele)
                continue;
            ele.value = this.#options[opt];
            ele.addEventListener('change', () => {
                this.#options[opt] = ele.value;
                this.#notifyOption();
            });
        }

        const synth = document.getElementById("do-synth");
        synth.addEventListener("click", () => {
            vscode.postMessage({ command: "do-synth" });
        });

        vscode.postMessage({ command: 'initialized' });
        this.#notifyOption();
    }
    #setOptions(options, topModules) {
        this.#block_update = true;
        this.#options = options;
        if (topModules)
            this.#topModules = topModules;
        try {
            for (const opt of ['opt', 'transform', /* 'lint', */ 'fsmexpand', 'techmap', 'defaultcomb'])
                if (this.#widgets[opt]) this.#widgets[opt].checked = this.#options[opt];
            this.#renderTopModules();
            for (const opt of ['fsm', 'layout'])
                if (this.#widgets[opt]) this.#widgets[opt].value = this.#options[opt];
        }
        finally {
            this.#block_update = false;
        }
    }
    #processMessage(event) {
        const message = event.data;
        switch (message.command) {
            case 'update-options':
                this.#setOptions(message.options, message.topModules);
                return;
        }
    }
}

{
    // When a new webview is recreated (i.e. a new run of resolveWebviewView)
    // it seems to inherit the state from the previous one,
    // and in this case the `window.init_state` is actually the more up-to-date one.
    // Distinguish this by keeping the view id in the state
    // and only accept states for the current view.
    // This still won't garantee we get the latest state since when the view is redrawn
    // without being destroyed there doesn't seem to be a way to recreate the state.
    // In that case, we'll use the saved state, which should be more up-to-date,
    // and there'll be another message with the lated info from the host as the reply
    // to the init message from the view.
    const state = vscode.getState();
    if (state && state.view_id == window.view_id) {
        delete state.view_id;
        new Synth(state);
    }
    else {
        new Synth(window.init_state.options, window.init_state.topModules);
    }
}
