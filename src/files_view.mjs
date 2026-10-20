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
    constructor(doc_dir, uri, document, circuit_view, same_name) {
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
        if (same_name) {
            // A $readmemh by bare name gets only one of them (the one in the
            // project directory, see data_file_paths); two .sv usually means
            // a module defined twice. Up to the user to remove one.
            this.iconPath = new vscode.ThemeIcon(
                'warning', new vscode.ThemeColor('list.warningForeground'));
            this.description = 'same name';
            this.tooltip = `Another source in this circuit is also named ${path.basename(uri.path)}`;
        }
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
    #studio
    #onDidChangeTreeData
    #circuitsChangedListener
    constructor(studio) {
        this.#studio = studio;
        this.#onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this.#onDidChangeTreeData.event;
        vscode.commands.executeCommand('setContext', 'hdl-studio.script_running', []);
        vscode.commands.executeCommand('setContext', 'hdl-studio.script_not_running', []);
        this.#circuitsChangedListener = studio.circuitsChanged(() => {
            const running = [];
            const not_running = [];
            for (const view of studio.circuitViews) {
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
            const active = this.#studio.activeCircuitView;
            return this.#studio.circuitViews.map((view) => new CircuitFile(view, view === active));
        }
        console.assert(element instanceof CircuitFile);
        const document = element.document;
        const doc_dir = document.sources.doc_dir_uri;
        const infos = document.sources.entries().map(([, info]) => info)
                                                .filter((info) => !info.deleted);
        const counts = {};
        for (const info of infos) {
            const base = path.basename(info.uri.path);
            counts[base] = (counts[base] || 0) + 1;
        }
        return infos.map((info) => new SourceFile(doc_dir, info.uri, document,
                                                  element.circuitView,
                                                  counts[path.basename(info.uri.path)] > 1));
    }
}
