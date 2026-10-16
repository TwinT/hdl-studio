// 4-state values as the engine sends them: binary strings of 0 1 x z, most
// significant bit first. Display rules follow @twint/4vl's (and
// hdlstudio-logic's): a hex/oct digit is 'z' only if all its bits are z,
// 'x' if any bit is x or z.

export type Level = 'high' | 'low' | 'def' | 'highz' | 'undef';

// What a wire, port or lamp is drawn as (digitaljs's colours).
export function level(v: string): Level {
    let ones = 0, zeros = 0, zs = 0;
    for (const c of v) {
        if (c === '1') ones++;
        else if (c === '0') zeros++;
        else if (c === 'z') zs++;
    }
    if (ones + zeros < v.length) return zs === v.length ? 'highz' : 'undef';
    return zeros === 0 ? 'high' : ones === 0 ? 'low' : 'def';
}

export const levelColor: Record<Level, string> = {
    high: '#03c03c', low: '#fc7c68', def: '#779ecb', highz: '#f39c12', undef: '#999',
};

export const xes = (bits: number) => 'x'.repeat(bits);

export const isDefined = (v: string) => !/[xz]/.test(v);

export function toBigInt(v: string, signed = false): bigint {
    const n = v ? BigInt('0b' + v) : 0n;
    return signed && v[0] === '1' ? n - (1n << BigInt(v.length)) : n;
}

export function fromBigInt(n: bigint, bits: number): string {
    if (bits === 0) return '';
    const m = 1n << BigInt(bits);
    return (((n % m) + m) % m).toString(2).padStart(bits, '0');
}

function digits(v: string, g: number): string {
    const out = [];
    for (let end = v.length; end > 0; end -= g) {
        const d = v.slice(Math.max(0, end - g), end);
        if (isDefined(d)) out.push(parseInt(d, 2).toString(16));
        else out.push(d.length === g && /^z+$/.test(d) ? 'z' : 'x');
    }
    return out.reverse().join('');
}

export type Base = 'hex' | 'bin' | 'oct' | 'dec' | 'dec2c';

// digitaljs's order (Display4vl.usableDisplays sorts by name).
export const bases: Base[] = ['bin', 'dec', 'dec2c', 'hex', 'oct'];

export function show(base: string, v: string): string {
    switch (base) {
        case 'bin': return v;
        case 'oct': return digits(v, 3);
        case 'dec':
        case 'dec2c':
            if (v.length && /^z+$/.test(v)) return 'z';
            if (!isDefined(v)) return 'x';
            return toBigInt(v, base === 'dec2c').toString();
        default: return digits(v, 4);
    }
}

// Characters a value takes in `base` (digitaljs's Display4vl size()).
export function size(base: string, bits: number): number {
    switch (base) {
        case 'bin': return bits;
        case 'oct': return Math.ceil(bits / 3);
        case 'dec': return Math.max(1, Math.ceil(bits / Math.log2(10)));
        case 'dec2c': return 1 + Math.ceil(bits / Math.log2(10));
        default: return Math.ceil(bits / 4);
    }
}

const patterns: Record<string, RegExp> = {
    bin: /^[01xz]*$/, oct: /^[0-7xz]*$/, hex: /^[0-9a-fxz]*$/, dec: /^(?:[0-9]*|x|z)$/, dec2c: /^(?:-?[0-9]*|x|z)$/,
};

// Text typed in `base` as a `bits`-wide value, or undefined if invalid.
// Shorter input is extended like 4vl does: with its top bit if that is x or
// z, else with zeros.
export function read(base: string, text: string, bits: number): string | undefined {
    text = text.trim().toLowerCase();
    if (!(patterns[base] ?? patterns.hex).test(text)) return undefined;
    if (base === 'dec' || base === 'dec2c') {
        if (text === 'x' || text === 'z') return text.repeat(bits);
        return fromBigInt(BigInt(text || '0'), bits);
    }
    const g = base === 'bin' ? 1 : base === 'oct' ? 3 : 4;
    let v = '';
    for (const c of text)
        v += c === 'x' || c === 'z' ? c.repeat(g) : parseInt(c, 16).toString(2).padStart(g, '0');
    if (v.length >= bits) return v.slice(v.length - bits);
    const top = v[0];
    return (top === 'x' || top === 'z' ? top : '0').repeat(bits - v.length) + v;
}
