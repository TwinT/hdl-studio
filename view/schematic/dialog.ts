// A floating window over the schematic: drag it by its title, resize it
// from its corner, close it with its button. It opens in `area` (the
// schematic's, above the waveforms) and can be dragged anywhere in the
// window; `onGeometry` hears where the user left it.

let zTop = 10;

// The window's place and its content's size, in pixels.
export interface Geometry { left: number; top: number; width: number; height: number }

export interface DialogOptions {
    area?: () => DOMRect;
    onGeometry?: (g: Geometry) => void;
}

export class Dialog {
    readonly root: HTMLDivElement;
    readonly body: HTMLDivElement;
    #onClose: () => void;
    #area: () => DOMRect;
    #size?: { width: number, height: number }; // the content's, as last set or reported
    #timer?: ReturnType<typeof setTimeout>;
    constructor(title: string, onClose: () => void, opts: DialogOptions = {}) {
        this.#onClose = onClose;
        this.#area = opts.area ?? (() => new DOMRect(0, 0, innerWidth, innerHeight));
        const report = () => {
            clearTimeout(this.#timer);
            this.#timer = setTimeout(() => opts.onGeometry?.(this.geometry), 300);
        };
        this.root = document.createElement('div');
        this.root.className = 'dialog';
        this.root.style.zIndex = String(++zTop);
        const bar = document.createElement('div');
        bar.className = 'titlebar';
        const span = document.createElement('span');
        span.textContent = title;
        const close = document.createElement('button');
        close.className = 'codicon codicon-close';
        close.title = 'Close';
        close.addEventListener('click', () => this.close());
        bar.append(span, close);
        this.body = document.createElement('div');
        this.body.className = 'content';
        this.root.append(bar, this.body);
        document.body.appendChild(this.root);
        this.root.addEventListener('pointerdown', () => { this.root.style.zIndex = String(++zTop); });
        bar.addEventListener('pointerdown', (e) => {
            if (e.target === close) return;
            const r = this.root.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
            bar.setPointerCapture(e.pointerId);
            let moved = false;
            const move = (ev: PointerEvent) => {
                moved = true;
                this.#moveTo(ev.clientX - x0, ev.clientY - y0);
            };
            const up = () => {
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
                if (moved) report();
            };
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
        });
        // a resize by its corner (the content sized by itself, or by
        // fit/place, isn't one)
        new ResizeObserver(() => {
            if (!this.body.style.width && !this.body.style.height) return;
            const now = this.#contentSize();
            if (this.#size && Math.abs(now.width - this.#size.width) < 1 && Math.abs(now.height - this.#size.height) < 1) return;
            this.#size = now;
            report();
        }).observe(this.body);
    }
    get title() {
        return this.root.querySelector('.titlebar span')!.textContent!;
    }
    get geometry(): Geometry {
        return { left: parseFloat(this.root.style.left) || 0, top: parseFloat(this.root.style.top) || 0, ...this.#contentSize() };
    }
    #contentSize() {
        const cs = getComputedStyle(this.body);
        return { width: parseFloat(cs.width), height: parseFloat(cs.height) };
    }
    #setSize(w: number, h: number) {
        this.body.style.width = `${w}px`;
        this.body.style.height = `${h}px`;
        this.#size = this.#contentSize();
    }
    // within the window, its title bar reachable
    #moveTo(x: number, y: number) {
        this.root.style.left = `${Math.min(innerWidth - 40, Math.max(0, x))}px`;
        this.root.style.top = `${Math.min(innerHeight - 20, Math.max(0, y))}px`;
    }
    // Content of this size (in pixels), up to 90% of the area, centred there.
    fit(w: number, h: number) {
        const a = this.#area();
        this.#setSize(Math.min(w, a.width * 0.9), Math.min(h, a.height * 0.9 - 30));
        this.center();
    }
    center() {
        const a = this.#area(), r = this.root.getBoundingClientRect();
        this.#moveTo(a.left + Math.max(0, (a.width - r.width) / 2), a.top + Math.max(0, (a.height - r.height) / 2));
    }
    // Where it was left, made to fit the window as it is now.
    place(g: Geometry) {
        this.#setSize(Math.min(g.width, innerWidth * 0.95), Math.min(g.height, innerHeight * 0.95 - 30));
        this.#moveTo(g.left, g.top);
    }
    close() {
        this.root.remove();
        this.#onClose();
    }
}

export interface PopupMenu {
    menu: HTMLDivElement;
    item(label: string, on: boolean, fn: () => void): void;
    head(text: string): void;
    close(): void;
}

// A context menu at (x, y), filled by `fill`; a choice, Escape or a click
// outside closes it.
export function popupMenu(x: number, y: number, fill: (m: PopupMenu) => void) {
    document.querySelector('.wavemenu')?.remove();
    const menu = document.createElement('div');
    menu.className = 'wavemenu';
    const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    const close = () => {
        menu.remove();
        document.removeEventListener('pointerdown', outside, true);
        document.removeEventListener('keydown', key, true);
    };
    const item = (label: string, on: boolean, fn: () => void) => {
        const b = document.createElement('button');
        b.textContent = (on ? '✓ ' : ' ') + label;
        b.addEventListener('click', () => { fn(); close(); });
        menu.append(b);
    };
    const head = (text: string) => menu.append(Object.assign(document.createElement('div'), { className: 'head', textContent: text }));
    fill({ menu, item, head, close });
    document.body.append(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, innerWidth - r.width - 4)}px`;
    menu.style.top = `${Math.max(0, Math.min(y, innerHeight - r.height - 4))}px`;
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
}
