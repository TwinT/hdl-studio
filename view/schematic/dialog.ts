// A floating window over the schematic: drag it by its title, resize it
// from its corner, close it with its button.

let zTop = 10;

export class Dialog {
    readonly root: HTMLDivElement;
    readonly body: HTMLDivElement;
    #onClose: () => void;
    constructor(title: string, onClose: () => void) {
        this.#onClose = onClose;
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
            const move = (ev: PointerEvent) => {
                this.root.style.left = `${Math.min(innerWidth - 40, Math.max(0, ev.clientX - x0))}px`;
                this.root.style.top = `${Math.min(innerHeight - 20, Math.max(0, ev.clientY - y0))}px`;
            };
            const up = () => {
                bar.removeEventListener('pointermove', move);
                bar.removeEventListener('pointerup', up);
            };
            bar.addEventListener('pointermove', move);
            bar.addEventListener('pointerup', up);
        });
    }
    get title() {
        return this.root.querySelector('.titlebar span')!.textContent!;
    }
    // Content of this size (in pixels), up to 90% of the window, centred.
    fit(w: number, h: number) {
        this.body.style.width = `${Math.min(w, innerWidth * 0.9)}px`;
        this.body.style.height = `${Math.min(h, innerHeight * 0.9 - 30)}px`;
        this.center();
    }
    center() {
        const r = this.root.getBoundingClientRect();
        this.root.style.left = `${Math.max(0, (innerWidth - r.width) / 2)}px`;
        this.root.style.top = `${Math.max(0, (innerHeight - r.height) / 2)}px`;
    }
    close() {
        this.root.remove();
        this.#onClose();
    }
}
