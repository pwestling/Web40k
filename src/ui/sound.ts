import { create } from "zustand";

/**
 * The dice tray's sounds, all synthesised with WebAudio (no samples): bounce
 * clicks, the scoop, crit chimes, a thump for the slain and stings for
 * decisive rolls. One mute switch, remembered on this device; audio starts on
 * the first click, as browsers require.
 */
const KEY = "open-battle:sound";
const FAST = "open-battle:fast-dice";
const AMBIENCE = "open-battle:ambience";

function stored(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function keep(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the switch still works until the page closes.
  }
}

/** Sound on or off, fast dice (half-length rolls) and the room's ambience (PX-5c), per device. */
export const useSound = create<{
  on: boolean;
  fast: boolean;
  ambience: boolean;
  toggle(): void;
  toggleFast(): void;
  toggleAmbience(): void;
}>((set, get) => ({
  on: stored(KEY, "on") !== "off",
  fast: stored(FAST, "off") === "on",
  ambience: stored(AMBIENCE, "on") !== "off",
  toggleAmbience() {
    const ambience = !get().ambience;
    keep(AMBIENCE, ambience ? "on" : "off");
    set({ ambience });
  },
  toggle() {
    const on = !get().on;
    keep(KEY, on ? "on" : "off");
    set({ on });
    if (on) void audio();
  },
  toggleFast() {
    const fast = !get().fast;
    keep(FAST, fast ? "on" : "off");
    set({ fast });
  },
}));

/**
 * Voices at the table dip under the tray's decisive moments (src/voice): the
 * time until which they stay down. Set whatever the sound switch says, since
 * voices aren't game sounds.
 */
export const useDuck = create<{ until: number }>(() => ({ until: 0 }));
export function duckVoices(ms: number): void {
  const until = performance.now() + ms;
  if (until > useDuck.getState().until) useDuck.setState({ until });
}

let ac: AudioContext | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

function audio(): AudioContext | null {
  if (!useSound.getState().on || typeof AudioContext === "undefined") return null;
  if (!ac) {
    ac = new AudioContext();
    master = ac.createGain();
    master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 6;
    master.connect(comp).connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ac.state === "suspended") void ac.resume();
  // Until the page has had a click the context stays suspended; sounds are skipped, not queued.
  return ac.state === "running" ? ac : null;
}

/** The shared context and master bus, for the room's ambience (src/ui/ambience.ts); null while muted or asleep. */
export function audioOut(): { ac: AudioContext; master: GainNode; noise: AudioBuffer } | null {
  const a = audio();
  return a && master && noise ? { ac: a, master, noise } : null;
}

// Browsers only allow audio after a gesture: wake it on the first one.
if (typeof addEventListener !== "undefined")
  addEventListener("pointerdown", () => void audio(), { once: true, capture: true });

function burst(
  a: AudioContext,
  t: number,
  {
    freq,
    q = 4,
    dur = 0.03,
    gain = 0.3,
    type = "bandpass",
  }: { freq: number; q?: number; dur?: number; gain?: number; type?: BiquadFilterType },
) {
  const src = a.createBufferSource();
  src.buffer = noise;
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = a.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  src.connect(f).connect(g).connect(master!);
  src.start(t, Math.random() * 0.4, dur + 0.02);
}

function tone(
  a: AudioContext,
  t: number,
  {
    freq,
    dur = 0.05,
    gain = 0.1,
    type = "sine",
    to,
  }: { freq: number; dur?: number; gain?: number; type?: OscillatorType; to?: number },
) {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** A die striking the tray: a hard plastic click over a dull wooden knock. Quieter the more dice are in flight. */
export function click(strength: number, pitch: number, crowd: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + Math.random() * 0.006;
  const v = strength / Math.sqrt(Math.max(1, crowd));
  burst(a, t, { freq: 2600 * pitch, q: 3, dur: 0.018 + 0.02 * strength, gain: 0.5 * v });
  tone(a, t, { freq: 1700 * pitch, dur: 0.025, gain: 0.08 * v, type: "triangle" });
  burst(a, t, { freq: 320 * pitch, q: 1.2, dur: 0.05 + 0.05 * strength, gain: 0.45 * v, type: "lowpass" });
}

/** Dice shaken in a hand. */
export function rattle() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  for (let i = 0; i < 3; i++)
    burst(a, t + i * 0.012, { freq: 2200 + Math.random() * 1800, q: 5, dur: 0.015, gain: 0.12 });
}

/** A critical success glinting; `i` staggers a run of them. */
export function chime(i: number) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + i * 0.045;
  tone(a, t, { freq: 1568, dur: 0.6, gain: 0.05 });
  tone(a, t, { freq: 2349, dur: 0.45, gain: 0.03 });
}

/** Failures swept off the tray. */
export function scoop(n: number) {
  const a = audio();
  if (!a || !n) return;
  burst(a, a.currentTime, { freq: 900, q: 0.7, dur: 0.28, gain: 0.12 + 0.01 * Math.min(n, 12) });
}

/** A low thump: models slain, or a heartbeat under a decisive die. */
export function thump(delay = 0, gain = 0.5) {
  const a = audio();
  if (!a) return;
  tone(a, a.currentTime + delay, { freq: 90, to: 40, dur: 0.22, gain });
}

/** The end of a decisive roll: a rising fanfare when it went the roller's way, a fall when it didn't. */
export function sting(good: boolean) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  if (good)
    [523, 659, 784, 1047].forEach((f, i) =>
      tone(a, t + i * 0.06, { freq: f, dur: 0.5, gain: 0.07, type: "triangle" }),
    );
  else {
    tone(a, t, { freq: 220, to: 110, dur: 0.6, gain: 0.12, type: "sawtooth" });
    thump(0, 0.4);
  }
}

/** The rare-outcome callout: a low boom, then a slow swelling chord with a shimmer on top. */
export function legendSting() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  tone(a, t, { freq: 70, to: 32, dur: 1.1, gain: 0.7 });
  burst(a, t, { freq: 180, q: 0.8, dur: 0.6, gain: 0.35, type: "lowpass" });
  [262, 330, 392, 523, 659].forEach((f, i) =>
    tone(a, t + 0.25 + i * 0.09, { freq: f, dur: 2.2, gain: 0.06, type: "triangle" }),
  );
  burst(a, t + 0.5, { freq: 7000, q: 1, dur: 1.4, gain: 0.05 });
}

/** Cursed dice: a soft, comic descending "womp womp", never a boom. */
export function womp() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  [392, 370, 349, 262].forEach((f, i) =>
    tone(a, t + i * 0.32, { freq: f, to: f * 0.94, dur: i === 3 ? 0.9 : 0.3, gain: 0.09, type: "triangle" }),
  );
}

/** A model picked up: a soft felt brush and a tiny click. */
export function pick() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(a, t, { freq: 1400, q: 0.6, dur: 0.07, gain: 0.05 });
  burst(a, t + 0.03, { freq: 3200, q: 4, dur: 0.012, gain: 0.08 });
}

/**
 * Models set down: a low wooden knock each, staggered like setting them down
 * one by one (at most six voices). An over-limit drop knocks duller.
 */
export function thunk(n = 1, dull = false) {
  const a = audio();
  if (!a) return;
  const voices = Math.max(1, Math.min(6, n));
  let t = a.currentTime;
  for (let i = 0; i < voices; i++) {
    const gain = (dull ? 0.22 : 0.32) / Math.sqrt(voices) + 0.08;
    burst(a, t, { freq: dull ? 180 : 250, q: 0.9, dur: 0.06, gain, type: "lowpass" });
    tone(a, t, { freq: dull ? 95 : 120, to: dull ? 70 : 90, dur: 0.06, gain: gain * 0.5 });
    t += 0.015 + Math.random() * 0.015;
  }
}

/** A charge striking home: the low thump with a short crack on top. */
export function clash() {
  const a = audio();
  if (!a) return;
  thump(0, 0.55);
  burst(a, a.currentTime, { freq: 1200, q: 2.5, dur: 0.05, gain: 0.25 });
}

/** A slain model tipping over: two soft clicks a few ms apart. */
export function topple(delay = 0) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + delay;
  burst(a, t, { freq: 1800, q: 3, dur: 0.015, gain: 0.1 });
  burst(a, t + 0.035, { freq: 900, q: 1.5, dur: 0.03, gain: 0.12, type: "lowpass" });
}

/** A tape measure ticking past a tenth of an inch: barely there. */
export function tick() {
  const a = audio();
  if (!a) return;
  burst(a, a.currentTime, { freq: 4200, q: 6, dur: 0.008, gain: 0.03 });
}

/** A soft whoosh between moment cards. */
export function whoosh() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  burst(a, t, { freq: 500, q: 0.6, dur: 0.35, gain: 0.08 });
  burst(a, t + 0.08, { freq: 1400, q: 0.8, dur: 0.25, gain: 0.05 });
}

/** The turn passing (PX-5c): a soft two-note chime. */
export function turnBell() {
  const a = audio();
  if (!a) return;
  const t = a.currentTime;
  tone(a, t, { freq: 659, dur: 0.9, gain: 0.05 });
  tone(a, t, { freq: 1318, dur: 0.5, gain: 0.012 });
  tone(a, t + 0.22, { freq: 880, dur: 1.2, gain: 0.05 });
  tone(a, t + 0.22, { freq: 1760, dur: 0.6, gain: 0.012 });
}

/** A low drum hit: a new round (twice), an army's card in the showcase (once). */
export function drum(times = 1) {
  const a = audio();
  if (!a) return;
  for (let i = 0; i < times; i++) {
    const t = a.currentTime + i * 0.28;
    tone(a, t, { freq: 75, to: 42, dur: 0.45, gain: 0.45 });
    burst(a, t, { freq: 140, q: 0.8, dur: 0.18, gain: 0.25, type: "lowpass" });
  }
}

/** A horn-like swell for "Round 1": two detuned sawtooths through a lowpass that opens. */
export function horn() {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime;
  const f = a.createBiquadFilter();
  f.type = "lowpass";
  f.frequency.setValueAtTime(220, t);
  f.frequency.exponentialRampToValueAtTime(1800, t + 1.2);
  f.frequency.exponentialRampToValueAtTime(400, t + 2.4);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.12, t + 0.6);
  g.gain.setTargetAtTime(0, t + 1.6, 0.35);
  f.connect(g).connect(master);
  for (const [freq, detune] of [
    [110, -7],
    [110, 7],
    [165, 0],
  ] as const) {
    const o = a.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = freq;
    o.detune.value = detune;
    o.connect(f);
    o.start(t);
    o.stop(t + 3);
  }
}
