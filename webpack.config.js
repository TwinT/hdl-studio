//

'use strict';

const path = require("path");

const outputDirectory = "dist";

// TypeScript is only transpiled here; `tsc` (npm run lint) checks the types.
const tsRule = { test: /\.ts$/, loader: 'esbuild-loader', options: { target: 'es2022' } };

// The circuit view (TypeScript).
function schematic_view_config() {
    return {
        name: 'schematic-view',
        entry: "./view/schematic/main.ts",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "schematic.js"
        },
        resolve: { extensions: ['.ts', '.mjs', '.js'] },
        module: {
            rules: [
                tsRule,
                {
                    test: /\.css$/,
                    use: ["style-loader", "css-loader"]
                },
            ]
        },
    };
}

function status_view_config() {
    return {
        name: 'status-view',
        entry: "./view/status_view.ts",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "status_view.js"
        },
        resolve: { extensions: ['.ts', '.mjs', '.js'] },
        module: { rules: [tsRule] },
    };
}

function synth_view_config() {
    return {
        name: 'synth-view',
        entry: "./view/synth_view.mjs",
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "synth_view.js"
        },
        plugins: [
        ],
    };
}

function local_ext_config() {
    return {
        name: 'local-ext',
        target: 'node',
        entry: {
            extension: "./src/extension.mjs",
        },
        output: {
            path: path.join(__dirname, outputDirectory),
            filename: "local-extension.js",
            libraryTarget: 'commonjs',
            devtoolModuleFilenameTemplate: '../../[resource-path]'
        },
        module: {
            rules: [
            ]
        },
        plugins: [
        ],
        externals: {
            vscode: 'commonjs vscode' // ignored because it doesn't exist
        },
    };
}

module.exports = [schematic_view_config, status_view_config, synth_view_config, local_ext_config];
