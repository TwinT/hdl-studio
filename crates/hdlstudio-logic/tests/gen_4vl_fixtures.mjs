// Golden cases for hdlstudio-logic, computed by @twint/4vl itself.
// Regenerate from the repo root (needs node_modules):
//   node crates/hdlstudio-logic/tests/gen_4vl_fixtures.mjs > crates/hdlstudio-logic/tests/4vl_fixtures.json
// The output is committed, so `cargo test` needs neither Node nor 4vl.
import { Vector4vl, Mem4vl } from '@twint/4vl/dist/index.mjs';

// mulberry32: fixed seed, so the file only changes when this script does.
let seed = 0x4f1;
function rand() {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = n => Math.floor(rand() * n);
const pick = xs => xs[int(xs.length)];
const str = (len, alphabet) => Array.from({ length: len }, () => pick(alphabet)).join('');

// Word boundaries of both 4vl (32) and hdlstudio-logic (64), plus odd widths.
const widths = [0, 1, 2, 3, 4, 5, 7, 8, 9, 16, 31, 32, 33, 63, 64, 65, 96, 127, 128, 129, 130];

function randBin(bits) {
    switch (int(7)) {
        case 0: return str(bits, '01xz');
        case 1: case 2: return str(bits, '01');
        case 3: return Array.from({ length: bits }, () => rand() < 0.1 ? pick('xz') : pick('01')).join('');
        case 4: return str(bits, '01z');
        case 5: return pick('01xz').repeat(bits);
        default: return str(bits, 'xz');
    }
}

// JS throws where hdlstudio-logic returns None.
function attempt(f) {
    try { return f(); } catch { return null; }
}

const cases = [];

for (const bits of widths) {
    for (let r = 0; r < 8; r++) {
        const a = randBin(bits);
        const v = Vector4vl.fromBin(a);
        const out = {};
        for (const op of ['not', 'xmask', 'reduceAnd', 'reduceOr', 'reduceNand', 'reduceNor', 'reduceXor', 'reduceXnor'])
            out[op] = v[op]().toBin();
        for (const p of ['isHigh', 'isLow', 'isZ', 'isDefined', 'isFullyDefined'])
            out[p] = v[p];
        out.msb = v.msb;
        out.lsb = v.lsb;
        out.get = [0, 1, bits - 1, int(bits + 2), bits].filter(n => n >= 0).map(n => [n, v.get(n)]);
        out.toArray = v.toArray();
        out.toHex = v.toHex();
        out.toOct = v.toOct();
        if (bits <= 64) {
            out.toU64 = attempt(() => v.toBigInt().toString());
            out.toI64 = attempt(() => v.toBigIntSigned().toString());
        }
        cases.push({ op: 'unary', a, out });

        const b = randBin(bits);
        const w = Vector4vl.fromBin(b);
        const bout = {};
        for (const op of ['and', 'or', 'xor', 'nand', 'nor', 'xnor'])
            bout[op] = v[op](w).toBin();
        cases.push({ op: 'binary', a, b, out: bout });
    }
}

for (let i = 0; i < 120; i++) {
    const parts = Array.from({ length: 1 + int(4) }, () => randBin(pick(widths)));
    cases.push({ op: 'concat', args: parts,
                 out: Vector4vl.concat(...parts.map(p => Vector4vl.fromBin(p))).toBin() });
}

for (let i = 0; i < 150; i++) {
    const a = randBin(pick(widths));
    const start = int(a.length + 3), end = int(a.length + 3);
    cases.push({ op: 'slice', a, start, end, out: Vector4vl.fromBin(a).slice(start, end).toBin() });
}

const parsers = [['fromBin', '01xz', 1], ['fromOct', '01234567xz', 3], ['fromHex', '0123456789abcdefxz', 4]];
for (const [op, alphabet, per] of parsers) {
    for (let i = 0; i < 120; i++) {
        let s = str(int(140 / per), alphabet);
        if (rand() < 0.3) s = pick('xz01') + s.slice(1); // exercise the x/z/0 fill
        const nbits = rand() < 0.3 ? null : pick(widths);
        cases.push({ op, s, nbits, out: Vector4vl[op](s, nbits ?? undefined).toBin() });
    }
}

const literals = ["8'hff", "4'b1x0z", "b101", "'o17", "16'd65535", "12'hx", "3'b1", "8'hz", "hdead", "d0",
                  "130'd1361129467683753853853498429727072845823", "7'o177", "1'bz", "0'b", "d", "64'hffffffffffffffff"];
for (const s of literals)
    cases.push({ op: 'parse', s, out: Vector4vl.fromString(s).toBin() });

for (let i = 0; i < 150; i++) {
    let digits = String(1 + int(9)) + str(int(45), '0123456789');
    if (rand() < 0.2) digits = String(int(4));
    const s = (rand() < 0.5 ? '-' : '') + digits;
    const nbits = rand() < 0.4 ? null : pick(widths);
    cases.push({ op: 'fromDec', s, nbits, out: Vector4vl.fromNumber(BigInt(s), nbits ?? undefined).toBin() });
}

// Memories: 4vl's own toJSON output (binary strings and run lengths), plus
// hand-made hex reps (single words, runs, several words in one string).
for (let i = 0; i < 40; i++) {
    // hex reps skip 1 and 3 bits: there a hex string can be as long as `bits`
    // and 4vl would decode it as binary
    const bits = pick(widths.filter(w => i % 2 ? w > 0 && w != 1 && w != 3 : w > 0));
    const data = [];
    for (let k = 0, n = 1 + int(6); k < n; k++)
        data.push(k > 0 && rand() < 0.5 ? data[k - 1] : Vector4vl.fromBin(randBin(bits)));
    let rep = Mem4vl.fromData(data).toJSON();
    if (i % 2) {
        const hexlen = Math.ceil(bits / 4);
        const hex = () => str(hexlen, '0123456789abcdef');
        rep = [hex(), 3, hex(), hex() + hex() + hex(), str(hexlen, 'x'), 2, str(hexlen, 'z')];
    }
    const mem = Mem4vl.fromJSON(bits, rep);
    cases.push({ op: 'mem', bits, rep, out: mem.toArray().map(v => v.toBin()), json: mem.toJSON() });
}

process.stdout.write(JSON.stringify(cases) + '\n');
