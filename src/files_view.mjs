//

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import { rel_compat2 } from './utils.mjs';

class CircuitFile extends vscode.TreeItem {
    constructor(circuit_view, is_active) {
        const document = circuit_view.document;
        const uri = document.uri;
        let name = 'Unnamed circuit';
        if (uri && uri.path) {
            const filename = path.basename(uri.path);
            if (filename) {
                if (uri.scheme === 'untitled') {
                    name = 'untitled:' + filename;
                }
                else {
                    name = filename;
                }
            }
        }
        super(name, is_active ? vscode.TreeItemCollapsibleState.Expanded
                              : vscode.TreeItemCollapsibleState.Collapsed);
        this.iconPath = new vscode.ThemeIcon('circuit-board');
        this.id = uri.toString();
        this.contextValue = 'root-circuit';
        this.resourceUri = uri;
        this.document = document;
        this.circuitView = circuit_view;
        this.command = { title: 'Show', command: 'hdl-studio.revealCircuit',
                         arguments: [uri] };
    }
}

class SourceFile extends vscode.TreeItem {
    constructor(doc_dir, uri, document, circuit_view) {
        let name;
        if (rel_compat2(doc_dir, uri)) {
            name = path.relative(doc_dir.path, uri.path);
        }
        else {
            name = path.basename(uri.path);
        }
        super(name, vscode.TreeItemCollapsibleState.None);
        const uri_str = uri.toString();
        this.iconPath = new vscode.ThemeIcon('file');
        this.id = uri_str;
        this.resourceUri = uri;
        this.contextValue = uri_str;
        this.document = document;
        this.circuitView = circuit_view;
        this.command = { title: 'Open', command: 'vscode.open',
                         arguments: [uri] };
    }
}

export class FilesView {
    #djs
    #onDidChangeTreeData
    #circuitsChangedListener
    constructor(djs) {
        this.#djs = djs;
        this.#onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.#onDidChangeTreeData.event;
        vscode.commands.executeCommand('setContext', 'hdl-studio.script_running', []);
        vscode.commands.executeCommand('setContext', 'hdl-studio.script_not_running', []);
        this.#circuitsChangedListener = djs.circuitsChanged(() => {
            const running = [];
            const not_running = [];
            for (const view of djs.circuitViews) {
                running.push(...view.document.sources.scriptRunning);
                not_running.push(...view.document.sources.scriptNotRunning);
            }
            vscode.commands.executeCommand('setContext', 'hdl-studio.script_running', running);
            vscode.commands.executeCommand('setContext', 'hdl-studio.script_not_running',
                                           not_running);
            this.#onDidChangeTreeData.fire();
        });
    }
    dispose() {
        this.#circuitsChangedListener.dispose();
    }

    getTreeItem(element) {
        return element;
    }
    async getChildren(element) {
        if (!element) {
            const active = this.#djs.activeCircuitView;
            return this.#djs.circuitViews.map((view) => new CircuitFile(view, view === active));
        }
        console.assert(element instanceof CircuitFile);
        const document = element.document;
        const doc_dir = document.sources.doc_dir_uri;
        let res = [];
        for (let [uri_str, info] of document.sources.entries()) {
            if (info.deleted)
                continue;
            res.push(new SourceFile(doc_dir, info.uri, document, element.circuitView));
        }
        return res;
    }
}
