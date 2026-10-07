import { useEffect, useRef } from "react";
import { lastSeq, rollsIn, type GameState, type TrayRoll } from "../core";
import { useStore } from "../store";
import { useGame } from "./hooks";
import { chime, click, scoop, sting, thump, useSound } from "./sound";
import { stakesOf, type Stakes } from "./stakes";

/**
 * Every roll, staged: the known results tumble onto a felt tray from the
 * roller's side, failures are scooped away and successes line up (6s glint),
 * and the survivors are picked up for the next step of the same attack.
 * Presentation only: the values come from the log, so every peer (and a
 * replay) sees the same dice. Click the tray to skip; it never takes input
 * once a roll is over.
 */
export function DiceTray() {
  const ref = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const shown = useGame();
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const pos = scrub ?? lastSeq(record);
  const prev = useRef<{ pos: number; state: GameState; initial: unknown } | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    stage.current = new Stage(ref.current);
    return () => stage.current?.clear();
  }, []);

  useEffect(() => {
    const p = prev.current;
    prev.current = { pos, state: shown, initial: record.initial };
    // Only steps forward a few events at a time: live play, or a replay playing. Not jumps or a new game.
    if (!p || p.initial !== record.initial || pos <= p.pos || pos - p.pos > 8) return;
    const events = record.events.filter((e) => e.seq > p.pos && e.seq <= pos).map((e) => e.event);
    for (const roll of rollsIn(p.state, shown, events, pos)) {
      const color = (roll.by && shown.players[roll.by]?.color) || (roll.defender ? "#d9584e" : "#7fb0df");
      stage.current?.play(roll, color, stakesOf(roll, p.state, shown));
    }
  }, [pos, shown, record]);

  return <div ref={ref} className="dice-tray" aria-hidden="true" />;
}

const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};
/** Above this many dice the tray shows counts per face instead of each die. */
const MAX_DICE = 60;
const LINGER_MS = 1800;

interface Die {
  el: HTMLDivElement;
  v: number;
  ok?: boolean;
  crit?: boolean;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ease = (p: number) => 1 - Math.pow(1 - p, 3);
const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The tray's DOM, driven by hand: one roll at a time, queued. */
class Stage {
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  private dice: Die[] = [];
  private chain: string | undefined;
  private skip = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private caption: HTMLDivElement;
  private banner: HTMLDivElement;
  private felt: HTMLDivElement;

  constructor(private root: HTMLDivElement) {
    root.innerHTML = "";
    this.felt = div("felt");
    this.caption = div("tray-caption");
    this.banner = div("tray-banner");
    root.append(this.felt, this.caption, this.banner);
    root.addEventListener("click", () => (this.skip = true));
  }

  clear() {
    clearTimeout(this.hideTimer);
    this.root.innerHTML = "";
  }

  play(roll: TrayRoll, color: string, stakes: Stakes | null) {
    this.waiting++;
    this.queue = this.queue.then(async () => {
      this.waiting--;
      // A backlog (a whole attack rolled at once) plays fast.
      const fast = this.waiting > 0 || useSound.getState().fast;
      try {
        await this.roll(roll, color, stakes, fast);
      } catch {
        // A roll that can't be staged is still in the panel and the log.
      }
    });
  }

  private show() {
    clearTimeout(this.hideTimer);
    this.root.classList.add("on");
  }

  private lingerThenHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => {
      this.root.classList.remove("on");
      this.dice.forEach((d) => d.el.remove());
      this.dice = [];
      this.chain = undefined;
    }, LINGER_MS);
  }

  private async roll(roll: TrayRoll, color: string, stakes: Stakes | null, fast: boolean) {
    this.skip = reduced();
    this.show();
    this.banner.className = "tray-banner";
    this.caption.textContent = roll.title;
    // The same attack's next step: pick up the survivors first. Anything else: clear the felt.
    if (this.dice.length && roll.chain && roll.chain === this.chain) await this.pickUp(roll.defender, fast);
    else this.removeAll();
    this.chain = roll.chain;

    if (roll.dice.length > MAX_DICE) {
      this.counts(roll, color);
      this.lingerThenHide();
      return;
    }
    const ds = await this.throwDice(roll, color, fast, !!stakes);
    const judged = roll.dice.some((d) => d.ok !== undefined);
    if (roll.sum || !judged) {
      const total = roll.dice.reduce((a, d) => a + d.value, 0);
      if (roll.dice.length > 1) this.caption.textContent = `${roll.title}: ${total}`;
      if (roll.passed !== undefined) ds.forEach((d) => d.el.classList.add(roll.passed ? "crit" : "fail"));
    } else {
      const keep = await this.sift(ds, fast);
      const of = roll.passOn === "failures" ? "saved" : "pass";
      this.caption.textContent = `${roll.title}: ${keep.length} of ${ds.length} ${of}`;
    }
    if (stakes) {
      await wait(this.skip ? 0 : 120);
      this.banner.innerHTML = "";
      const big = div("big");
      big.textContent = stakes.big;
      const small = div("small");
      small.textContent = stakes.small;
      this.banner.append(big, small);
      this.banner.className = `tray-banner on ${stakes.good ? "good" : "bad"}`;
      ds.forEach((d) => d.el.classList.add(stakes.good ? "crit" : "fail"));
      sting(stakes.good);
      if (/slain/i.test(stakes.big)) thump(0, 0.6);
      await wait(this.skip ? 400 : 1400);
    }
    this.lingerThenHide();
  }

  private removeAll() {
    this.dice.forEach((d) => d.el.remove());
    this.dice = [];
  }

  private size(n: number) {
    const W = this.felt.clientWidth;
    const H = this.felt.clientHeight;
    return Math.max(14, Math.min(44, Math.sqrt((W * H * 0.22) / Math.max(n, 2))));
  }

  private makeDie(color: string, size: number): HTMLDivElement {
    const el = div("die");
    el.style.setProperty("--c", color);
    el.style.setProperty("--s", `${size}px`);
    el.innerHTML = `<div class="shadow"></div><div class="body">${'<i class="pip"></i>'.repeat(9)}</div>`;
    this.felt.appendChild(el);
    return el;
  }

  private face(el: HTMLDivElement, v: number, sides: number) {
    const pips = PIPS[v];
    const body = el.lastElementChild as HTMLDivElement;
    if (!pips || sides !== 6) {
      // Not a d6 face: the number itself.
      body.dataset.n = String(v);
      body.classList.add("numeric");
      return;
    }
    body.classList.remove("numeric");
    el.querySelectorAll(".pip").forEach((p, i) => p.classList.toggle("on", pips.includes(i)));
  }

  /** The tumble: eased path, decaying bounces that click, spin, faces flickering then settling. */
  private throwDice(roll: TrayRoll, color: string, fast: boolean, slowLast: boolean): Promise<Die[]> {
    return new Promise((resolve) => {
      const W = this.felt.clientWidth;
      const H = this.felt.clientHeight;
      const n = roll.dice.length;
      const size = this.size(n);
      const cols = Math.ceil(Math.sqrt(n * 1.6));
      const rows = Math.ceil(n / cols);
      const cw = (W * 0.8) / cols;
      const ch = (H * 0.6) / Math.max(rows, 1);
      const spots: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        spots.push([
          W * 0.1 + c * cw + cw / 2 - size / 2 + (Math.random() - 0.5) * cw * 0.35,
          H * 0.2 + r * ch + ch / 2 - size / 2 + (Math.random() - 0.5) * ch * 0.35,
        ]);
      }
      spots.sort(() => Math.random() - 0.5);
      const base = fast ? 420 : 900;
      const ds = roll.dice.map((d, i) => {
        const el = this.makeDie(color, size);
        const last = slowLast && i === n - 1;
        return {
          el,
          v: d.value,
          ok: d.ok,
          crit: d.crit,
          sx: W * (0.3 + Math.random() * 0.4),
          sy: roll.defender ? -size * 2 : H + size,
          ex: spots[i]![0],
          ey: spots[i]![1],
          delay: last
            ? fast
              ? 120
              : 260
            : Math.min(i * (fast ? 8 : 18), fast ? 120 : 260) + Math.random() * 40,
          dur: last ? (fast ? 1100 : 2300) : base + Math.random() * 180,
          bounces: last ? 5 : 3 + (Math.random() < 0.5 ? 1 : 0),
          spin: (Math.random() < 0.5 ? -1 : 1) * (360 + Math.random() * 540),
          rot0: Math.random() * 360,
          rotEnd: (Math.random() - 0.5) * 24,
          pitch: 0.85 + Math.random() * 0.35,
          lastHop: -1,
          flick: 0,
          done: false,
          last,
        };
      });
      // A heartbeat under a decisive die.
      if (slowLast && !this.skip) [0.5, 1.0, 1.5].forEach((t, i) => thump(fast ? t / 2 : t, 0.3 + i * 0.05));
      const t0 = performance.now();
      const frame = (now: number) => {
        let alive = 0;
        for (const d of ds) {
          if (d.done) continue;
          const p = this.skip ? 1 : Math.min(1, Math.max(0, (now - t0 - d.delay) / d.dur));
          if (p <= 0) {
            d.el.style.opacity = "0";
            alive++;
            continue;
          }
          d.el.style.opacity = "1";
          const e = ease(p);
          const x = d.sx + (d.ex - d.sx) * e;
          const y = d.sy + (d.ey - d.sy) * e;
          const hop = Math.floor(p * d.bounces);
          const h = p >= 1 ? 0 : Math.abs(Math.sin(Math.PI * p * d.bounces)) * Math.pow(1 - p, 1.6) * 1.2;
          if (hop !== d.lastHop && hop > 0 && !this.skip)
            click(Math.pow(1 - p, 1.2) + 0.1, d.pitch, Math.min(n, 9));
          d.lastHop = hop;
          const rot = d.rot0 + d.spin * e + d.rotEnd * e;
          if (p > (d.last ? 0.93 : 0.8)) this.face(d.el, d.v, roll.sides);
          else if (now - d.flick > 40 + 260 * p * p) {
            d.flick = now;
            this.face(d.el, 1 + Math.floor(Math.random() * roll.sides), roll.sides);
          }
          place(d.el, x, y, h, rot);
          if (p >= 1) {
            d.done = true;
            this.face(d.el, d.v, roll.sides);
          } else alive++;
        }
        if (alive) requestAnimationFrame(frame);
        else {
          const out = ds.map(({ el, v, ok, crit }) => ({ el, v, ok, crit }));
          this.dice.push(...out);
          resolve(out);
        }
      };
      requestAnimationFrame(frame);
    });
  }

  /** Failures dim and are scooped off; successes line up sorted, criticals glint. */
  private async sift(ds: Die[], fast: boolean): Promise<Die[]> {
    const W = this.felt.clientWidth;
    const H = this.felt.clientHeight;
    const size = this.size(ds.length);
    const keep = ds.filter((d) => d.ok).sort((a, b) => b.v - a.v);
    const fails = ds.filter((d) => !d.ok);
    fails.forEach((d) => d.el.classList.add("fail"));
    await wait(this.skip ? 0 : fast ? 120 : 380);
    scoop(fails.length);
    fails.forEach((d, i) => {
      d.el.classList.add("gone");
      d.el.style.transitionDelay = `${this.skip ? 0 : i * 12}ms`;
      d.el.style.transform = `translate(${-size * 2}px, ${H * 0.5 + (Math.random() - 0.5) * H * 0.4}px) rotate(${Math.random() * 90}deg) scale(.7)`;
    });
    const gap = size * 0.18;
    const perRow = Math.max(1, Math.floor((W * 0.86) / (size + gap)));
    const rowsTotal = Math.ceil(keep.length / perRow);
    keep.forEach((d, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      const rowCount = Math.min(perRow, keep.length - r * perRow);
      const x = W / 2 - (rowCount * (size + gap) - gap) / 2 + c * (size + gap);
      const y = H * 0.5 - size / 2 + (r - (rowsTotal - 1) / 2) * (size + gap);
      d.el.style.transition = this.skip
        ? "none"
        : `transform ${fast ? 180 : 340}ms cubic-bezier(.3,1.4,.5,1) ${i * (fast ? 6 : 14)}ms`;
      d.el.style.transform = `translate(${x}px, ${y}px)`;
      const shadow = d.el.firstElementChild as HTMLDivElement;
      shadow.style.transform = "";
      shadow.style.opacity = ".45";
    });
    await wait(this.skip ? 0 : fast ? 200 : 420);
    keep
      .filter((d) => d.crit)
      .forEach((d, i) => {
        d.el.classList.add("crit");
        if (i < 6) chime(i);
      });
    setTimeout(() => fails.forEach((d) => d.el.remove()), 600);
    this.dice = keep;
    return keep;
  }

  /** The survivors leave towards the next roller before the new dice come in. */
  private async pickUp(towardTop: boolean, fast: boolean) {
    const H = this.felt.clientHeight;
    const old = this.dice;
    this.dice = [];
    old.forEach((d, i) => {
      d.el.style.transition = "";
      d.el.classList.add("gone");
      d.el.style.transitionDelay = `${i * 8}ms`;
      d.el.style.transform += ` translate(0, ${towardTop ? -H : H}px)`;
    });
    setTimeout(() => old.forEach((d) => d.el.remove()), 700);
    await wait(this.skip || fast ? 60 : 220);
  }

  /** A huge pool: how many of each face, failures dimmed. */
  private counts(roll: TrayRoll, color: string) {
    this.removeAll();
    const by = new Map<number, { n: number; ok: boolean }>();
    for (const d of roll.dice) {
      const e = by.get(d.value) ?? { n: 0, ok: !!d.ok };
      e.n++;
      by.set(d.value, e);
    }
    const box = div("tray-counts");
    for (const [v, { n, ok }] of [...by].sort((a, b) => b[0] - a[0])) {
      const c = div(`tray-count ${ok || roll.dice[0]?.ok === undefined ? "" : "fail"}`);
      c.style.setProperty("--c", color);
      c.textContent = `${n} × ${v}`;
      box.append(c);
    }
    const ok = roll.dice.filter((d) => d.ok).length;
    if (roll.dice.some((d) => d.ok !== undefined))
      this.caption.textContent = `${roll.title}: ${ok} of ${roll.dice.length} pass`;
    this.felt.append(box);
    this.dice = [{ el: box, v: 0 }];
  }
}

function div(className: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = className;
  return el;
}

function place(el: HTMLDivElement, x: number, y: number, h: number, rot: number) {
  el.style.transform = `translate(${x}px, ${y - h * 26}px) rotate(${rot}deg) scale(${1 + h * 0.35})`;
  const shadow = el.firstElementChild as HTMLDivElement;
  shadow.style.transform = `translate(${h * 10}px, ${h * 30}px) scale(${1 + h * 0.2})`;
  shadow.style.opacity = String(0.45 - h * 0.25);
}
