import { touch } from "./touch";
import { useEffect, useRef } from "react";
import {
  applyEvent,
  lastSeq,
  rareOf,
  rollsIn,
  type DiceSet,
  type GameState,
  type RareOutcome,
  type TrayRoll,
} from "../core";
import { useStore } from "../store";
import { diceLook } from "./diceSets";
import { useHold, watchForRolls } from "./hold";
import { useLiveGame } from "./hooks";
import { chime, click, duckVoices, legendSting, scoop, sting, thump, useSound, womp } from "./sound";
import { stakesOf, type Stakes } from "./stakes";
import { t } from "../i18n";

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
  // The real table, not the held one: the tray is what the hold waits for.
  const shown = useLiveGame();
  const record = useStore((s) => s.record);
  const scrub = useStore((s) => s.scrub);
  const pos = scrub ?? lastSeq(record);
  const prev = useRef<{ pos: number; state: GameState; initial: unknown } | null>(null);
  // Actions that already had their rare moment (one per action).
  const called = useRef(new Set<string>());

  useEffect(() => {
    if (!ref.current) return;
    stage.current = current = new Stage(
      ref.current,
      () => useHold.setState({ held: null, busy: false }),
      // A roll settled: show the table up to the next roll still to come.
      (next) => {
        const held = useHold.getState().held;
        if (held !== null && next > held) useHold.setState({ held: next });
      },
    );
    const unwatch = watchForRolls();
    return () => {
      unwatch();
      stage.current?.clear();
      current = null;
      useHold.setState({ held: null, busy: false });
    };
  }, []);

  // Never hold the screen for long, whatever the tray is doing.
  const held = useHold((s) => s.held);
  useEffect(() => {
    if (held === null) return;
    const timer = setTimeout(() => useHold.setState({ held: null }), 30_000);
    return () => clearTimeout(timer);
  }, [held]);

  useEffect(() => {
    const p = prev.current;
    prev.current = { pos, state: shown, initial: record.initial };
    // Scrubbed back (a ★ replaying its roll): its moment may show again.
    if (p && pos < p.pos) called.current.clear();
    // Only steps forward a few events at a time: live play, or a replay playing. Not jumps or a new game.
    if (!p || p.initial !== record.initial || pos <= p.pos || pos - p.pos > 8) return;
    // Event by event, so each roll knows which event made it: the hold lets
    // the table catch up one stage at a time as the tray settles each roll.
    const staged: { roll: TrayRoll; seq: number }[] = [];
    const fresh = record.events.filter((e) => e.seq > p.pos && e.seq <= pos);
    // An undo shows nothing (and the states in between can't be rebuilt one event at a time).
    if (fresh.some((e) => e.event.type === "undo")) return;
    let state = p.state;
    for (const { seq, event } of fresh) {
      const next = seq === pos ? shown : applyEvent(state, event);
      for (const roll of rollsIn(state, next, [event], seq)) staged.push({ roll, seq });
      state = next;
    }
    const rolls = staged.map((r) => r.roll);
    let rare = rareOf(rolls, shown, pos);
    const action = rare && `${rare.chain ?? rare.rollId}@${rare.round}`;
    if (action && called.current.has(action)) rare = null;
    else if (action) called.current.add(action);
    for (const { roll, seq } of staged) {
      // Each roller's own dice (PX-5b); saves come in the defender's.
      const look = diceLook(
        roll.by ? shown.players[roll.by] : undefined,
        roll.defender ? "#d9584e" : "#7fb0df",
      );
      stage.current?.play(
        roll,
        seq,
        look,
        stakesOf(roll, p.state, shown),
        rare?.rollId === roll.id ? rare : null,
        scrub === null,
      );
    }
  }, [pos, shown, record, scrub]);

  return <div ref={ref} className="dice-tray" aria-hidden="true" />;
}

let current: Stage | null = null;

/** Put the dice tray away, if it has finished rolling. */
export function clearTray(): void {
  current?.reset();
}

/** Marbled dice: turbulence veins, one of a few seeds each, so no two dice in a roll match. */
const MARBLES = 16;
const marbles = new Map<number, string>();
function marble(seed: number): string {
  let url = marbles.get(seed);
  if (!url) {
    const svg =
      `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'>` +
      `<filter id='m'><feTurbulence type='turbulence' baseFrequency='0.022 0.045' numOctaves='3' seed='${seed + 1}'/>` +
      // Greys from the noise, then light veins along its ridges with a darker edge: overlaid on the body colour.
      `<feColorMatrix values='0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0 0 1'/>` +
      `<feComponentTransfer><feFuncR type='table' tableValues='0.95 0.3 0.45 0.55 0.5'/>` +
      `<feFuncG type='table' tableValues='0.95 0.3 0.45 0.55 0.5'/>` +
      `<feFuncB type='table' tableValues='0.95 0.3 0.45 0.55 0.5'/></feComponentTransfer>` +
      `</filter><rect width='100%' height='100%' filter='url(#m)' transform='rotate(${(seed * 47) % 360} 48 48)'/></svg>`;
    url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    marbles.set(seed, url);
  }
  return url;
}

/** One die's DOM in a set's colours and finish (PX-5b); a marbled die gets its own swirl. */
export function makeDie(look: DiceSet, size: number): HTMLDivElement {
  const el = div(`die finish-${look.finish}`);
  el.style.setProperty("--c", look.body);
  el.style.setProperty("--p", look.pip);
  el.style.setProperty("--s", `${size}px`);
  if (look.finish === "marbled")
    el.style.setProperty("--marble", marble(Math.floor(Math.random() * MARBLES)));
  el.innerHTML = `<div class="shadow"></div><div class="body">${'<i class="pip"></i>'.repeat(9)}</div>`;
  return el;
}

/** Show a value on a die: pips for a d6, the number for anything else. */
export function showFace(el: HTMLDivElement, v: number, sides: number): void {
  const pips = PIPS[v];
  const body = el.lastElementChild as HTMLDivElement;
  if (!pips || sides !== 6) {
    body.dataset.n = String(v);
    body.classList.add("numeric");
    return;
  }
  body.classList.remove("numeric");
  el.querySelectorAll(".pip").forEach((p, i) => p.classList.toggle("on", pips.includes(i)));
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

/** An animation frame, or a timer in a background tab, where frames never come. */
const nextFrame = (cb: (now: number) => void) =>
  document.hidden ? setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame(cb);
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const ease = (p: number) => 1 - Math.pow(1 - p, 3);
const reduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The tray's DOM, driven by hand: one roll at a time, queued. */
class Stage {
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  /** The event behind each roll still queued or playing, oldest first. */
  private seqs: number[] = [];
  /** The size dice were thrown at, so the lineup matches them. */
  private dieSize = 0;
  private dice: Die[] = [];
  private chain: string | undefined;
  private skip = false;
  private active = false;
  private hideTimer: ReturnType<typeof setTimeout> | undefined;
  private caption: HTMLDivElement;
  private banner: HTMLDivElement;
  private felt: HTMLDivElement;

  constructor(
    private root: HTMLDivElement,
    private onIdle: () => void,
    /** A roll's dice are judged: the table may show everything before `next`, the next roll's event. */
    private onSettled: (next: number) => void,
  ) {
    root.innerHTML = "";
    this.felt = div("felt");
    this.caption = div("tray-caption");
    this.banner = div("tray-banner");
    root.append(this.felt, this.caption, this.banner);
    // Clicking skips to the result; clicking a settled tray puts it away.
    root.addEventListener("click", () => {
      if (this.active) this.skip = true;
      else this.hideNow();
    });
  }

  clear() {
    clearTimeout(this.hideTimer);
    this.root.innerHTML = "";
  }

  play(
    roll: TrayRoll,
    seq: number,
    look: DiceSet,
    stakes: Stakes | null,
    rare: RareOutcome | null,
    live: boolean,
  ) {
    this.waiting++;
    this.seqs.push(seq);
    useHold.setState({ busy: true });
    this.queue = this.queue.then(async () => {
      this.waiting--;
      this.active = true;
      // A backlog (a whole attack rolled at once) plays fast.
      const fast = this.waiting > 0 || useSound.getState().fast;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        this.seqs.shift();
        // Up to the next roll's event, or everything once it's the last.
        const next = this.seqs[0];
        if (next === undefined) this.onIdle();
        else if (next > seq) this.onSettled(next);
      };
      try {
        await this.roll(roll, look, stakes, fast, settle);
        if (rare) await this.moment(rare, live);
      } catch {
        // A roll that can't be staged is still in the panel and the log.
      }
      settle();
      this.active = false;
      if (this.waiting === 0) this.onIdle();
    });
  }

  private show() {
    clearTimeout(this.hideTimer);
    // Sit above the phase's stratagem box, which shares the corner (UX 104).
    const box = document.querySelector(".panel.play")?.getBoundingClientRect();
    this.root.style.bottom = box?.height ? `${Math.max(60, innerHeight - box.top + 8)}px` : "";
    this.root.classList.add("on");
  }

  private lingerThenHide() {
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideNow(), LINGER_MS);
  }

  /** Put the tray away now (the moments reel moving on to its next card). */
  reset() {
    if (!this.active) this.hideNow();
  }

  private hideNow() {
    clearTimeout(this.hideTimer);
    this.root.classList.remove("on");
    this.dice.forEach((d) => d.el.remove());
    this.dice = [];
    this.chain = undefined;
  }

  private async roll(
    roll: TrayRoll,
    look: DiceSet,
    stakes: Stakes | null,
    fast: boolean,
    settle: () => void,
  ) {
    // A background tab paints nothing (and gets no animation frames): just settle the dice.
    this.skip = reduced() || document.hidden;
    this.show();
    this.banner.className = "tray-banner";
    this.caption.textContent = roll.title;
    // A handful of dice gets a smaller tray (UX 101).
    this.root.classList.toggle("few", roll.dice.length <= 6);
    // The same attack's next step: pick up the survivors first. Anything else: clear the felt.
    if (this.dice.length && roll.chain && roll.chain === this.chain) await this.pickUp(roll.defender, fast);
    else this.removeAll();
    this.chain = roll.chain;

    if (roll.dice.length > MAX_DICE) {
      this.counts(roll, look.body);
      settle();
      this.lingerThenHide();
      return;
    }
    const ds = await this.throwDice(roll, look, fast, !!stakes);
    const judged = roll.dice.some((d) => d.ok !== undefined);
    if (roll.sum || !judged) {
      const total = roll.dice.reduce((a, d) => a + d.value, 0);
      if (roll.dice.length > 1) this.caption.textContent = `${roll.title}: ${total}`;
      if (roll.passed !== undefined) ds.forEach((d) => d.el.classList.add(roll.passed ? "crit" : "fail"));
    } else {
      const keep = await this.sift(ds, fast);
      const counts = { title: roll.title, n: keep.length, total: ds.length };
      this.caption.textContent =
        roll.passOn === "failures"
          ? t("{title}: {n} of {total} saved", counts)
          : t("{title}: {n} of {total} pass", counts);
    }
    // The table shows this stage's result now, with the banner, not after it.
    settle();
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
      duckVoices(1600);
      if (stakes.big === t("Slain")) thump(0, 0.6);
      await wait(this.skip ? 400 : 1400);
    }
    this.lingerThenHide();
  }

  /**
   * Against all odds: a beat of silence, the table goes dark around the dice
   * that did it, a boom and a chord (a comic womp for cursed dice), and the
   * title with its one number. The unit's bases pulse on the table too.
   */
  private async moment(rare: RareOutcome, live: boolean) {
    clearTimeout(this.hideTimer);
    this.show();
    duckVoices(this.skip ? 0 : 450);
    await wait(this.skip ? 0 : 450);
    this.root.classList.add("legendary");
    this.dice.forEach((d) => d.el.classList.add("tray-legend"));
    if (rare.lucky) legendSting();
    else womp();
    duckVoices(2200);
    this.banner.innerHTML = "";
    const big = div("big");
    big.textContent = rare.title;
    const small = div("small");
    small.textContent = rare.line;
    this.banner.append(big, small);
    if (live) {
      const hint = div("hint");
      hint.textContent = touch() ? t("Tap to continue") : t("Click to continue");
      this.banner.append(hint);
    }
    this.banner.className = `tray-banner on tray-legend ${rare.lucky ? "" : "cursed"}`;
    if (rare.unitId)
      useStore.getState().set({
        moment: {
          unitId: rare.unitId,
          title: rare.title,
          line: rare.line,
          lucky: rare.lucky,
          at: Date.now(),
        },
      });
    this.skip = false;
    // Live, it stays until it's clicked, holding the next roll behind it (UX 102); never forever.
    // A replay shows it for a few seconds.
    const end = Date.now() + (document.hidden ? 0 : live ? 20_000 : 4_000);
    while (Date.now() < end && !this.skip) await wait(100);
    this.root.classList.remove("legendary");
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

  private makeDie(look: DiceSet, size: number): HTMLDivElement {
    const el = makeDie(look, size);
    this.felt.appendChild(el);
    return el;
  }

  private face(el: HTMLDivElement, v: number, sides: number) {
    showFace(el, v, sides);
  }

  /** The tumble: eased path, decaying bounces that click, spin, faces flickering then settling. */
  private throwDice(roll: TrayRoll, look: DiceSet, fast: boolean, slowLast: boolean): Promise<Die[]> {
    return new Promise((resolve) => {
      const W = this.felt.clientWidth;
      const H = this.felt.clientHeight;
      const n = roll.dice.length;
      const cols = Math.ceil(Math.sqrt(n * 1.6));
      const rows = Math.ceil(n / cols);
      const cw = (W * 0.8) / cols;
      const ch = (H * 0.6) / Math.max(rows, 1);
      // At most half a cell, so neighbours keep at least a die's width between them.
      const size = Math.max(10, Math.min(this.size(n), cw / 2, ch / 2));
      this.dieSize = size;
      // Jitter only within the room that leaves.
      const jx = Math.max(0, cw / 2 - size);
      const jy = Math.max(0, ch / 2 - size);
      const spots: [number, number][] = [];
      for (let i = 0; i < n; i++) {
        const c = i % cols;
        const r = Math.floor(i / cols);
        spots.push([
          W * 0.1 + c * cw + cw / 2 - size / 2 + (Math.random() - 0.5) * 2 * jx,
          H * 0.2 + r * ch + ch / 2 - size / 2 + (Math.random() - 0.5) * 2 * jy,
        ]);
      }
      spots.sort(() => Math.random() - 0.5);
      const base = fast ? 420 : 900;
      const ds = roll.dice.map((d, i) => {
        const el = this.makeDie(look, size);
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
      if (slowLast && !this.skip) {
        [0.5, 1.0, 1.5].forEach((at, i) => thump(fast ? at / 2 : at, 0.3 + i * 0.05));
        // Voices hush for the last die and its verdict.
        duckVoices(fast ? 1800 : 3400);
      }
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
        if (alive) nextFrame(frame);
        else {
          const out = ds.map(({ el, v, ok, crit }) => ({ el, v, ok, crit }));
          this.dice.push(...out);
          resolve(out);
        }
      };
      nextFrame(frame);
    });
  }

  /** Failures dim and are scooped off; successes line up sorted, criticals glint. */
  private async sift(ds: Die[], fast: boolean): Promise<Die[]> {
    const W = this.felt.clientWidth;
    const H = this.felt.clientHeight;
    const size = this.dieSize || this.size(ds.length);
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
      this.caption.textContent = t("{title}: {n} of {total} pass", {
        title: roll.title,
        n: ok,
        total: roll.dice.length,
      });
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
