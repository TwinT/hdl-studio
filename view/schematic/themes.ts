// Colour themes of the circuit view (the `hdl-studio.theme` setting). The
// circuit's colours are CSS variables (`--sch-<key>`) the drawing refers to;
// the waveforms are drawn on canvases, so they get the colours themselves.

import { defaultColors, type WaveColors } from './waves.ts';

interface Palette {
    paper: string; fill: string; ink: string; lead: string; // background, cell bodies, lines and text, port leads
    high: string; low: string; def: string; highz: string; undef: string; // wire values
    lamp: string; hl: string; // an unlit lamp, the FSM's current state
}

const wave = (background: string, altBackground: string, foreground: string, grid: string,
              signal: string, undef: string, highImpedance: string, cursor: string): WaveColors =>
    ({ background, altBackground, foreground, grid, signal, undefined: undef, highImpedance, cursor, fillOpacity: 0.2 });

const v = (name: string, fallback: string) => `var(--vscode-${name}, ${fallback})`;

export const themes: Record<string, { label: string, circuit: Palette, wave: WaveColors }> = {
    classic: {
        label: 'Classic',
        circuit: { paper: '#ffffff', fill: '#ffffff', ink: '#000000', lead: '#4B4F6A', high: '#03c03c', low: '#fc7c68',
                   def: '#779ecb', highz: '#f39c12', undef: '#999999', lamp: '#bfc5c6', hl: 'yellow' },
        wave: defaultColors,
    },
    vscode: {
        label: 'VS Code',
        circuit: { paper: v('editor-background', '#1e1e1e'), fill: v('editor-background', '#1e1e1e'), ink: v('editor-foreground', '#d4d4d4'),
                   lead: v('editorLineNumber-foreground', '#858585'), high: v('terminal-ansiGreen', '#0dbc79'), low: v('terminal-ansiRed', '#cd3131'),
                   def: v('terminal-ansiBlue', '#2472c8'), highz: v('terminal-ansiYellow', '#e5e510'), undef: v('disabledForeground', '#858585'),
                   lamp: v('disabledForeground', '#858585'), hl: v('editor-findMatchHighlightBackground', '#ea5c0055') },
        wave: wave(v('editor-background', '#1e1e1e'), v('sideBar-background', '#252526'), v('editor-foreground', '#d4d4d4'),
                   v('editorIndentGuide-background1', '#404040'), v('terminal-ansiGreen', '#0dbc79'), v('terminal-ansiRed', '#cd3131'),
                   v('terminal-ansiYellow', '#e5e510'), v('editorCursor-foreground', '#aeafad')),
    },
    'solarized-light': {
        label: 'Solarized Light',
        circuit: { paper: '#fdf6e3', fill: '#eee8d5', ink: '#586e75', lead: '#93a1a1', high: '#859900', low: '#dc322f',
                   def: '#268bd2', highz: '#cb4b16', undef: '#93a1a1', lamp: '#93a1a1', hl: '#b58900' },
        wave: wave('#fdf6e3', '#eee8d5', '#586e75', '#eee8d5', '#859900', '#dc322f', '#b58900', '#d33682'),
    },
    'solarized-dark': {
        label: 'Solarized Dark',
        circuit: { paper: '#002b36', fill: '#073642', ink: '#93a1a1', lead: '#586e75', high: '#859900', low: '#dc322f',
                   def: '#268bd2', highz: '#cb4b16', undef: '#657b83', lamp: '#586e75', hl: '#b58900' },
        wave: wave('#002b36', '#073642', '#93a1a1', '#073642', '#859900', '#dc322f', '#b58900', '#d33682'),
    },
    dracula: {
        label: 'Dracula',
        circuit: { paper: '#282a36', fill: '#44475a', ink: '#f8f8f2', lead: '#6272a4', high: '#50fa7b', low: '#ff5555',
                   def: '#8be9fd', highz: '#ffb86c', undef: '#6272a4', lamp: '#6272a4', hl: '#bd93f9' },
        wave: wave('#282a36', '#343746', '#f8f8f2', '#44475a', '#50fa7b', '#ff5555', '#f1fa8c', '#ff79c6'),
    },
    nord: {
        label: 'Nord',
        circuit: { paper: '#2e3440', fill: '#3b4252', ink: '#eceff4', lead: '#616e88', high: '#a3be8c', low: '#bf616a',
                   def: '#88c0d0', highz: '#d08770', undef: '#616e88', lamp: '#4c566a', hl: '#b48ead' },
        wave: wave('#2e3440', '#3b4252', '#d8dee9', '#3b4252', '#a3be8c', '#bf616a', '#ebcb8b', '#b48ead'),
    },
    'night-owl': {
        label: 'Night Owl',
        circuit: { paper: '#011627', fill: '#0b2942', ink: '#d6deeb', lead: '#5f7e97', high: '#addb67', low: '#ef5350',
                   def: '#82aaff', highz: '#f78c6c', undef: '#637777', lamp: '#637777', hl: '#c792ea' },
        wave: wave('#011627', '#0b2942', '#d6deeb', '#0b2942', '#addb67', '#ef5350', '#ffcb8b', '#c792ea'),
    },
    'gruvbox-dark': {
        label: 'Gruvbox Dark',
        circuit: { paper: '#282828', fill: '#3c3836', ink: '#ebdbb2', lead: '#928374', high: '#b8bb26', low: '#fb4934',
                   def: '#83a598', highz: '#fe8019', undef: '#928374', lamp: '#665c54', hl: '#d3869b' },
        wave: wave('#282828', '#32302f', '#ebdbb2', '#3c3836', '#b8bb26', '#fb4934', '#fabd2f', '#d3869b'),
    },
};

// A `var(--x, fallback)` as the colour it stands for now (a canvas can't use variables).
function resolve(c: string) {
    const m = /^var\((--[\w-]+),\s*(.+)\)$/.exec(c);
    return m ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || m[2] : c;
}

// Sets the circuit's colours; returns the waveforms' (`overrides`: the user's
// `hdl-studio.waveform.colors`).
export function applyTheme(name: string | undefined, overrides: Partial<WaveColors> = {}): WaveColors {
    const t = themes[name ?? ''] ?? themes.classic;
    const s = document.documentElement.style;
    for (const [k, c] of Object.entries(t.circuit)) s.setProperty(`--sch-${k}`, c);
    const w = Object.fromEntries(Object.entries(t.wave).map(([k, c]) => [k, typeof c === 'string' ? resolve(c) : c]));
    return { ...w, ...overrides } as WaveColors;
}
