//

'use strict';

// The extension in VS Code on a real project: synthesis errors in the Problems
// panel, the circuit going stale on an edit, synthesis on save. Needs yosys.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const vscode = require('vscode');

const until = async (fn, what, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 50));
    }
};
const hasYosys = () => {
    try {
        execFileSync('yosys', ['-V']);
        return true;
    } catch {
        return false;
    }
};
const counter = (width, body) =>
    `module counter(input logic clk, rst, output logic [${width - 1}:0] q);\n${body}\nendmodule\n`;

suite('Synthesis in VS Code', function () {
    this.timeout(120000);
    let dir;
    suiteSetup(function () {
        if (!hasYosys()) this.skip();
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hdl-vscode-'));
    });
    suiteTeardown(async () => {
        await vscode.workspace.getConfiguration('hdl-studio').update('synthesizeOnSave', undefined, vscode.ConfigurationTarget.Global);
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        if (dir) fs.rmSync(dir, { recursive: true, force: true });
    });

    test('errors in Problems; an edit makes the circuit stale; saving synthesizes', async function () {
        const sv = vscode.Uri.file(path.join(dir, 'counter.sv'));
        fs.writeFileSync(sv.fsPath, counter(4, '  always_ff @(posedge clk) q <= rst ? 0 : qq + 1;'));
        const project = path.join(dir, 'counter.hdls');
        fs.writeFileSync(project, JSON.stringify({ sources: [{ relpath: 'counter.sv' }] }));
        await vscode.commands.executeCommand('vscode.openWith', vscode.Uri.file(project), 'hdl-studio.circuitView');
        const ext = vscode.extensions.getExtension('TwinT.hdl-studio');
        const doc = await until(() => ext.exports?.document, 'the project to open');
        const width = () => Object.values(doc.circuit.devices).find((d) => d.type === 'NumDisplay')?.bits;

        // an undeclared name: an error on its line, no circuit
        await vscode.commands.executeCommand('hdl-studio.synthesize');
        const [problem] = await until(() => vscode.languages.getDiagnostics(sv).length && vscode.languages.getDiagnostics(sv), 'a problem');
        assert.strictEqual(problem.severity, vscode.DiagnosticSeverity.Error);
        assert.strictEqual(problem.range.start.line, 1);
        assert.match(problem.message, /qq/);
        assert.strictEqual(width(), undefined);

        // fixed in the editor (not saved): a circuit, no problems, not stale
        const text = await vscode.workspace.openTextDocument(sv);
        const replace = async (content) => {
            const edit = new vscode.WorkspaceEdit();
            edit.replace(sv, new vscode.Range(0, 0, text.lineCount, 0), content);
            assert.ok(await vscode.workspace.applyEdit(edit));
        };
        await replace(counter(4, '  always_ff @(posedge clk) q <= rst ? 0 : q + 1;'));
        await vscode.commands.executeCommand('hdl-studio.synthesize');
        await until(() => width() === 4, 'the circuit');
        assert.deepStrictEqual(vscode.languages.getDiagnostics(sv), []);
        await new Promise((r) => setTimeout(r, 500));
        assert.strictEqual(doc.stale, false);

        // edited again: stale; saved with synthesizeOnSave: synthesized again
        await replace(counter(6, '  always_ff @(posedge clk) q <= rst ? 0 : q + 1;'));
        await until(() => doc.stale, 'the circuit to go stale');
        await vscode.workspace.getConfiguration('hdl-studio').update('synthesizeOnSave', true, vscode.ConfigurationTarget.Global);
        assert.ok(await text.save());
        await until(() => width() === 6 && !doc.stale, 'a synthesis on save');
    });
});
