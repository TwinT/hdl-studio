//

'use strict';

// Flat config for ESLint 9+ (replaces the legacy .eslintrc.json).
// Rules are intentionally all "warn" so linting never blocks the build.

const ro = (names) => Object.fromEntries(names.map((n) => [n, 'readonly']));

const nodeGlobals = ro([
    'process', 'console', 'Buffer', 'URL', 'URLSearchParams',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate',
    'global', 'globalThis', '__dirname', '__filename'
]);

const browserGlobals = ro([
    'window', 'document', 'navigator', 'location', 'fetch',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver',
    'requestIdleCallback', 'cancelIdleCallback', 'Image',
    'SVGElement', 'HTMLElement', 'Element', 'Node', 'CustomEvent', 'Event',
    'console', 'globalThis', 'acquireVsCodeApi'
]);

const mochaGlobals = ro([
    'describe', 'it', 'before', 'after', 'beforeEach', 'afterEach', 'suite', 'test'
]);

const rules = {
    'no-const-assign': 'warn',
    'no-this-before-super': 'warn',
    'no-undef': 'warn',
    'no-unreachable': 'warn',
    'no-unused-vars': 'warn',
    'constructor-super': 'warn',
    'valid-typeof': 'warn'
};

module.exports = [
    { ignores: ['dist/**', 'node_modules/**', '.vscode-test/**', 'out/**'] },
    {
        files: ['**/*.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: { ...nodeGlobals, ...browserGlobals }
        },
        rules
    },
    {
        files: ['**/*.js', '**/*.cjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: { ...nodeGlobals }
        },
        rules
    },
    {
        files: ['test/**'],
        languageOptions: { globals: { ...mochaGlobals } }
    }
];
