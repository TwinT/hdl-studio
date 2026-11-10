//
'use strict';

// Lua tests in VS Code's Testing view: each open project, its `*_test.lua`
// scripts, their `test(name, fn)` calls (src/lua_tests.mjs). A run
// synthesizes the project first if its sources changed, then runs each
// script on its circuit with `hdlstudio lua --tests`.

import * as vscode from 'vscode';
import * as path from 'path';
import { isLuaTest, lua_test_names, error_line, run_lua_tests } from './lua_tests.mjs';
import { read_txt_file } from './utils.mjs';

export class TestExplorer {
    #studio
    #controller
    #files = new Map(); // file item id -> { document, uri }
    #timer
    constructor(studio, context) {
        this.#studio = studio;
        const c = this.#controller = vscode.tests.createTestController('hdl-studio', 'HDL Studio');
        context.subscriptions.push(c);
        this.profile = c.createRunProfile('Run', vscode.TestRunProfileKind.Run, (request, token) => this.#run(request, token), true);
        c.refreshHandler = () => this.refresh();
        context.subscriptions.push(studio.circuitsChanged(() => this.refresh()));
        // a test added or renamed in an open script
        context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((e) => {
            if (!isLuaTest(e.document.uri.path))
                return;
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => this.refresh(), 300);
        }));
        this.refresh();
    }
    get controller() {
        return this.#controller;
    }

    async #text(uri) {
        const doc = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
        return doc ? doc.getText() : read_txt_file(uri);
    }

    // The tree: the open projects that have test scripts.
    async refresh() {
        const c = this.#controller;
        const documents = [...new Set(this.#studio.circuitViews.map((v) => v.document))];
        const roots = [];
        this.#files.clear();
        for (const document of documents) {
            const scripts = document.sources.entries().map(([, info]) => info.uri)
                .filter((uri) => isLuaTest(uri.path))
                .sort((a, b) => a.path.localeCompare(b.path));
            if (!scripts.length)
                continue;
            const root = c.createTestItem(document.uri.toString(), path.basename(document.uri.path), document.uri);
            for (const uri of scripts) {
                const id = `${root.id}|${uri.toString()}`;
                const file = c.createTestItem(id, path.basename(uri.path), uri);
                this.#files.set(id, { document, uri });
                let names = [];
                try {
                    names = lua_test_names(await this.#text(uri));
                } catch {
                    // a missing file: no tests to show
                }
                for (const { name, line } of names) {
                    const item = c.createTestItem(`${id}|${name}`, name, uri);
                    item.range = new vscode.Range(line, 0, line, 0);
                    file.children.add(item);
                }
                root.children.add(file);
            }
            roots.push(root);
        }
        c.items.replace(roots);
    }

    // The scripts to run, each with the tests asked for (null: all).
    #requested(request) {
        const excluded = new Set((request.exclude ?? []).map((i) => i.id));
        const want = new Map(); // file id -> Set of test ids, or null
        const add = (item) => {
            if (excluded.has(item.id))
                return;
            if (this.#files.has(item.id)) {
                want.set(item.id, null); // a script
            } else if (this.#files.has(item.parent?.id)) {
                const tests = want.get(item.parent.id); // a test
                if (tests !== null)
                    want.set(item.parent.id, new Set([...(tests ?? []), item.id]));
            } else {
                item.children.forEach(add); // a project
            }
        };
        const items = request.include ?? [];
        if (items.length) items.forEach(add);
        else this.#controller.items.forEach(add);
        return want;
    }

    async #run(request, token) {
        const run = this.#controller.createTestRun(request);
        const abort = new AbortController();
        token.onCancellationRequested(() => abort.abort());
        const fresh = new Map(); // document -> whether its circuit is up to date
        for (const [fileId, only] of this.#requested(request)) {
            if (token.isCancellationRequested)
                break;
            const { document, uri } = this.#files.get(fileId);
            const file = this.#controller.items.get(document.uri.toString())?.children.get(fileId);
            if (!file)
                continue;
            const tests = [];
            file.children.forEach((t) => { if (!only || only.has(t.id)) tests.push(t); });
            const all = tests.length ? tests : [file];
            all.forEach((t) => run.started(t));
            if (!fresh.has(document)) {
                run.appendOutput(`Synthesizing ${path.basename(document.uri.path)} if its sources changed…\r\n`);
                fresh.set(document, await document.freshCircuit());
            }
            if (!fresh.get(document)) {
                const message = new vscode.TestMessage('The circuit couldn\'t be synthesized: see the Problems panel.');
                all.forEach((t) => run.errored(t, message));
                continue;
            }
            const label = path.basename(uri.path);
            const seen = new Set();
            const report = (item, r) => {
                seen.add(item.id);
                for (const p of r.prints ?? [])
                    run.appendOutput(`${r.test ? `[${r.test}] ` : ''}${p.replace(/\r?\n/g, '\r\n')}\r\n`, undefined, item);
                if (r.ok)
                    return run.passed(item);
                const message = new vscode.TestMessage(r.error);
                const line = error_line(r.error, label);
                if (line)
                    message.location = new vscode.Location(uri, new vscode.Position(line - 1, 0));
                run.failed(item, message);
            };
            try {
                const script = await this.#text(uri);
                await run_lua_tests({ circuit: document.circuit, script, label, signal: abort.signal,
                                      defaultcomb: !!document.synth_options.defaultcomb }, (r) => {
                    if (r.test === null) {
                        // the whole script: it has no tests, or failed outside them
                        if (!r.ok || !file.children.size)
                            all.forEach((t) => report(t, r));
                        return;
                    }
                    let item = file.children.get(`${fileId}|${r.test}`);
                    if (!item) {
                        // a name built at run time
                        item = this.#controller.createTestItem(`${fileId}|${r.test}`, r.test, uri);
                        file.children.add(item);
                    }
                    if (!only || only.has(item.id))
                        report(item, r);
                });
                // a test gone from the script since
                for (const t of all)
                    if (!seen.has(t.id))
                        run.skipped(t);
            } catch (e) {
                if (!token.isCancellationRequested)
                    all.forEach((t) => run.errored(t, new vscode.TestMessage(String(e.message ?? e))));
            }
        }
        run.end();
    }
}
