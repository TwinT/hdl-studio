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

    test('Lua tests in the Testing view, run on a circuit synthesized first', async function () {
        // the counter example and its tests, never synthesized
        const example = path.join(__dirname, '..', 'verilog', '04_counter');
        for (const f of ['04_counter.sv', 'counter_test.lua'])
            fs.copyFileSync(path.join(example, f), path.join(dir, f));
        const project = vscode.Uri.file(path.join(dir, 'tests.hdls'));
        fs.writeFileSync(project.fsPath, JSON.stringify({ sources: [{ relpath: '04_counter.sv' }, { relpath: 'counter_test.lua' }] }));
        await vscode.commands.executeCommand('vscode.openWith', project, 'hdl-studio.circuitView');
        const { tests } = vscode.extensions.getExtension('TwinT.hdl-studio').exports;
        const root = await until(() => tests.controller.items.get(project.toString()), 'the project in the Testing view');
        const file = await until(() => { let f; root.children.forEach((c) => { f = c; }); return f?.children.size === 3 && f; }, 'its tests');
        assert.strictEqual(file.label, 'counter_test.lua');
        // run them, recording each outcome
        const outcomes = {};
        const create = tests.controller.createTestRun;
        tests.controller.createTestRun = (request) => {
            const run = create.call(tests.controller, request);
            for (const k of ['passed', 'failed', 'errored', 'skipped']) {
                const report = run[k].bind(run);
                run[k] = (item, ...rest) => { outcomes[item.label] = k; return report(item, ...rest); };
            }
            return run;
        };
        try {
            await tests.profile.runHandler(new vscode.TestRunRequest([root]), new vscode.CancellationTokenSource().token);
        } finally {
            tests.controller.createTestRun = create;
        }
        assert.deepStrictEqual(outcomes, {
            'arranca en 0 despues del reset': 'passed',
            'cuenta cada flanco de subida': 'passed',
            'vuelve a 0 despues de 15': 'passed',
        });
    });

    test('Show in Circuit: behind the editor, after an edit and a new synthesis, on a port', async function () {
        const sv = vscode.Uri.file(path.join(dir, '04_counter.sv'));
        if (!fs.existsSync(sv.fsPath))
            fs.copyFileSync(path.join(__dirname, '..', 'verilog', '04_counter', '04_counter.sv'), sv.fsPath);
        const project = vscode.Uri.file(path.join(dir, 'show.hdls'));
        fs.writeFileSync(project.fsPath, JSON.stringify({ sources: [{ relpath: '04_counter.sv' }] }));
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        await vscode.commands.executeCommand('vscode.openWith', project, 'hdl-studio.circuitView', vscode.ViewColumn.One);
        const ext = vscode.extensions.getExtension('TwinT.hdl-studio');
        const doc = await until(() => ext.exports?.document?.uri.toString() === project.toString() && ext.exports.document, 'the project');
        await vscode.commands.executeCommand('hdl-studio.synthesize');
        await until(() => Object.keys(doc.circuit.devices).length > 0, 'the circuit');
        // the source in the same group: the circuit view is behind it
        const editor = await vscode.window.showTextDocument(sv, { viewColumn: vscode.ViewColumn.One });
        const lines = editor.document.getText().split('\n');
        const at = (re) => lines.findIndex((l) => re.test(l));
        const show = async (line) => {
            await vscode.window.showTextDocument(editor.document, { viewColumn: vscode.ViewColumn.One });
            vscode.window.activeTextEditor.selection = new vscode.Selection(line, 0, line, 0);
            return vscode.commands.executeCommand('hdl-studio.showInCircuit');
        };
        assert.deepStrictEqual(await show(at(/^\s+always_ff/)), { lit: 1 });
        // the circuit came to the front of its group
        assert.strictEqual(vscode.window.tabGroups.all[0].activeTab.label, 'show.hdls');
        assert.deepStrictEqual(await show(at(/^\s+input\s+logic clk/)), { lit: 1 });
        assert.deepStrictEqual(await show(at(/^endmodule/) - 1), { lit: 0 });
        // edited: its lines may have moved
        const edit = new vscode.WorkspaceEdit();
        edit.insert(sv, new vscode.Position(0, 0), '// moved\n');
        assert.ok(await vscode.workspace.applyEdit(edit));
        assert.deepStrictEqual(await show(at(/^\s+always_ff/) + 1), { stale: true });
        // synthesized again from the edited text: found again (it used to stay "changed")
        await vscode.commands.executeCommand('hdl-studio.synthesize');
        await until(async () => !(await doc.sources.changedSinceSynthesis()), 'the new synthesis');
        assert.deepStrictEqual(await show(at(/^\s+always_ff/) + 1), { lit: 1 });
        await vscode.commands.executeCommand('undo');
    });
});
