// digitaljs's ESM sources (src/, what the extension's webpack bundles ship)
// loaded in plain Node. Their named imports from CommonJS packages
// (@joint/core, fengari-web) aren't statically detectable, so a module hook
// re-exports each package's keys. Temporary: goes away with digitaljs.
import { createRequire, registerHooks } from 'node:module';

const pkg = new URL('../../package.json', import.meta.url).href;
const require = createRequire(pkg);
const SHIMMED = new Set(['@joint/core', 'fengari-web']);

registerHooks({
    resolve(specifier, context, next) {
        // only imports: the shim itself require()s the real package
        if (SHIMMED.has(specifier) && !context.conditions.includes('require'))
            return { url: 'shim:' + specifier, shortCircuit: true };
        return next(specifier, context);
    },
    load(url, context, next) {
        if (!url.startsWith('shim:'))
            return next(url, context);
        const spec = url.slice('shim:'.length);
        const keys = Object.keys(require(spec)).filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
        const source = `import { createRequire } from 'node:module';
const m = createRequire(${JSON.stringify(pkg)})(${JSON.stringify(spec)});
export default m;
${keys.map((k) => `export const ${k} = m.${k};`).join('\n')}`;
        return { format: 'module', source, shortCircuit: true };
    },
});

const src = new URL('../../node_modules/digitaljs/src/', import.meta.url);
export const { HeadlessCircuit } = await import(new URL('circuit.mjs', src));
export const { Vector4vl } = await import('@twint/4vl');
