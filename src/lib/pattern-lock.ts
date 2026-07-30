/* lib/pattern-lock.ts — an Android-style "connect the dots" pattern lock
 * gating access to the app on load. This is a static, unauthenticated site
 * (GitHub Pages, no server), so this is a client-side privacy screen that
 * deters casual snooping (someone picking up the phone, or opening a shared
 * link) — not real security against anyone who opens dev tools. Only a hash
 * of the pattern is ever stored, never the pattern itself. */

const STORAGE_KEY = 'birds-pattern-lock-hash';
const MIN_DOTS = 4;
const GRID = 3;
const SIZE = 280;
const PAD = 45;

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function isPatternLockEnabled(): boolean {
  return !!localStorage.getItem(STORAGE_KEY);
}

export async function setPatternLock(seq: number[]): Promise<void> {
  localStorage.setItem(STORAGE_KEY, await sha256Hex(seq.join('-')));
}

export function clearPatternLock(): void {
  localStorage.removeItem(STORAGE_KEY);
}

async function matchesStoredPattern(seq: number[]): Promise<boolean> {
  const stored = localStorage.getItem(STORAGE_KEY);
  return !!stored && stored === await sha256Hex(seq.join('-'));
}

function dotPos(i: number): { x: number; y: number } {
  const col = i % GRID;
  const row = Math.floor(i / GRID);
  const step = (SIZE - PAD * 2) / (GRID - 1);
  return { x: PAD + col * step, y: PAD + row * step };
}

function arraysEqual(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

interface PatternGridOptions {
  title: string;
  subtitle: string;
  error?: boolean;
  onComplete: (seq: number[]) => void;
}

/** Renders a fresh pattern grid into `root` and wires its own pointer events.
 * Calls `onComplete` once the user lifts their finger/mouse after connecting
 * at least MIN_DOTS dots; too-short attempts just shake and reset in place. */
function renderPatternGrid(root: HTMLElement, opts: PatternGridOptions): void {
  root.innerHTML = `
    <div class="pattern-lock-card${opts.error ? ' shake' : ''}">
      <h2>${opts.title}</h2>
      <p class="pattern-lock-subtitle${opts.error ? ' error' : ''}">${opts.subtitle}</p>
      <svg class="pattern-lock-svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">
        <g class="pattern-lines"></g>
        <line class="pattern-drag-line" hidden></line>
        ${Array.from({ length: 9 }, (_, i) => {
          const { x, y } = dotPos(i);
          return `<circle class="pattern-dot" data-idx="${i}" cx="${x}" cy="${y}" r="15"></circle>`;
        }).join('')}
      </svg>
      <div class="pattern-lock-footer"></div>
    </div>
  `;
  const svg = root.querySelector<SVGSVGElement>('.pattern-lock-svg')!;
  const linesGroup = root.querySelector<SVGGElement>('.pattern-lines')!;
  const dragLine = root.querySelector<SVGLineElement>('.pattern-drag-line')!;
  const dots = Array.from(root.querySelectorAll<SVGCircleElement>('.pattern-dot'));
  let seq: number[] = [];
  let dragging = false;

  const svgPoint = (clientX: number, clientY: number): { x: number; y: number } => {
    const rect = svg.getBoundingClientRect();
    return { x: ((clientX - rect.left) / rect.width) * SIZE, y: ((clientY - rect.top) / rect.height) * SIZE };
  };

  const hitTest = (x: number, y: number): number | null => {
    for (let i = 0; i < 9; i++) {
      const { x: dx, y: dy } = dotPos(i);
      if (Math.hypot(x - dx, y - dy) <= 22) return i;
    }
    return null;
  };

  const addLine = (a: number, b: number): void => {
    const pa = dotPos(a);
    const pb = dotPos(b);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(pa.x));
    line.setAttribute('y1', String(pa.y));
    line.setAttribute('x2', String(pb.x));
    line.setAttribute('y2', String(pb.y));
    line.setAttribute('class', 'pattern-line-seg');
    linesGroup.appendChild(line);
  };

  const resetDrawing = (): void => {
    seq = [];
    linesGroup.innerHTML = '';
    dragLine.setAttribute('hidden', '');
    dots.forEach((d) => d.classList.remove('active'));
  };

  const onMove = (clientX: number, clientY: number): void => {
    if (!dragging) return;
    const p = svgPoint(clientX, clientY);
    if (seq.length) {
      const last = dotPos(seq[seq.length - 1]!);
      dragLine.removeAttribute('hidden');
      dragLine.setAttribute('x1', String(last.x));
      dragLine.setAttribute('y1', String(last.y));
      dragLine.setAttribute('x2', String(p.x));
      dragLine.setAttribute('y2', String(p.y));
    }
    const hit = hitTest(p.x, p.y);
    if (hit != null && !seq.includes(hit)) {
      if (seq.length) addLine(seq[seq.length - 1]!, hit);
      seq.push(hit);
      dots[hit]!.classList.add('active');
    }
  };

  svg.addEventListener('pointerdown', (e) => {
    svg.setPointerCapture(e.pointerId);
    resetDrawing();
    dragging = true;
    onMove(e.clientX, e.clientY);
  });
  svg.addEventListener('pointermove', (e) => onMove(e.clientX, e.clientY));
  const onUp = (): void => {
    if (!dragging) return;
    dragging = false;
    dragLine.setAttribute('hidden', '');
    if (seq.length >= MIN_DOTS) opts.onComplete([...seq]);
    else resetDrawing();
  };
  svg.addEventListener('pointerup', onUp);
  svg.addEventListener('pointercancel', onUp);
}

/** Full-viewport lock screen. Resolves once the correct pattern is drawn, or
 * the user confirms "forgot pattern" (which disables the lock — it can't
 * recover the original pattern since only its hash was ever stored). Caller
 * is responsible for appending/removing `root` from the DOM. */
export function renderLockScreen(root: HTMLElement): Promise<void> {
  return new Promise((resolve) => {
    let wrongAttempt = false;
    const draw = (): void => {
      renderPatternGrid(root, {
        title: 'האפליקציה נעולה',
        subtitle: wrongAttempt ? 'דפוס שגוי — נסו שוב' : 'ציירו את דפוס הנעילה כדי להיכנס',
        error: wrongAttempt,
        onComplete: (seq) => {
          void matchesStoredPattern(seq).then((ok) => {
            if (ok) resolve();
            else { wrongAttempt = true; draw(); }
          });
        },
      });
      const footer = root.querySelector<HTMLElement>('.pattern-lock-footer')!;
      const forgotBtn = document.createElement('button');
      forgotBtn.type = 'button';
      forgotBtn.className = 'pattern-lock-link';
      forgotBtn.textContent = 'שכחתי את הדפוס';
      // Built inline (not via the app's shared modal system) since this
      // screen renders in its own top-level stacking context, above
      // everything else — a normal modal would end up visually underneath it.
      forgotBtn.addEventListener('click', () => {
        footer.innerHTML = `
          <p class="pattern-lock-confirm-text">פעולה זו תבטל את נעילת הדפוס (הנתונים שלכם לא יימחקו). להמשיך?</p>
          <div class="pattern-lock-confirm-actions">
            <button type="button" class="btn btn-danger btn-sm" id="pattern-forgot-yes">ביטול נעילה</button>
            <button type="button" class="btn btn-sm" id="pattern-forgot-no">ביטול</button>
          </div>`;
        footer.querySelector('#pattern-forgot-yes')!.addEventListener('click', () => { clearPatternLock(); resolve(); });
        footer.querySelector('#pattern-forgot-no')!.addEventListener('click', () => draw());
      });
      footer.appendChild(forgotBtn);
    };
    draw();
  });
}

/** Draw-twice setup flow for enabling/changing the pattern lock, rendered
 * into `root` (e.g. inside a Settings modal). Resolves true once saved,
 * false if the user cancels. */
export function renderPatternSetup(root: HTMLElement, onCancel: () => void): Promise<boolean> {
  return new Promise((resolve) => {
    let first: number[] | null = null;
    let mismatch = false;
    const draw = (): void => {
      renderPatternGrid(root, {
        title: first ? 'ציירו שוב לאישור' : 'הגדרת דפוס נעילה',
        subtitle: mismatch
          ? 'הדפוסים לא תאמו — נסו שוב מההתחלה'
          : first
            ? 'ציירו את אותו הדפוס שוב'
            : `חברו לפחות ${MIN_DOTS} נקודות`,
        error: mismatch,
        onComplete: (seq) => {
          mismatch = false;
          if (!first) { first = seq; draw(); }
          else if (arraysEqual(first, seq)) {
            void setPatternLock(seq).then(() => resolve(true));
          } else {
            first = null;
            mismatch = true;
            draw();
          }
        },
      });
      const footer = root.querySelector<HTMLElement>('.pattern-lock-footer')!;
      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'pattern-lock-link';
      cancelBtn.textContent = 'ביטול';
      cancelBtn.addEventListener('click', () => { onCancel(); resolve(false); });
      footer.appendChild(cancelBtn);
    };
    draw();
  });
}
