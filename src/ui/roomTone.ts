import { audioOut, useSound } from "./sound";
import { useHold } from "./hold";

/**
 * The room (PX-5c): a very quiet bed of brown noise under the game, with a
 * distant table now and then (dice, a chair, a murmur), panned and at the edge
 * of hearing. It ducks 6 dB under the dice tray and goes quiet while the tab
 * is hidden. Synthesised like the other sounds; nothing to download.
 */

const BED_GAIN = 0.035;
const DUCKED = 0.5; // -6 dB

let bed: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
let brown: AudioBuffer | null = null;
let drift: ReturnType<typeof setTimeout> | undefined;
let distant: ReturnType<typeof setTimeout> | undefined;
let running = false;

function brownNoise(ac: AudioContext): AudioBuffer {
  const len = ac.sampleRate * 6;
  const b = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    // Fade the loop's seam.
    for (let i = 0; i < 2000; i++) {
      const k = i / 2000;
      d[len - 1 - i] = d[len - 1 - i]! * k + d[i]! * (1 - k);
    }
  }
  return b;
}

const level = () => (useHold.getState().busy ? BED_GAIN * DUCKED : BED_GAIN);

function startBed(): void {
  const out = audioOut();
  if (!out || bed) return;
  const { ac, master } = out;
  brown ??= brownNoise(ac);
  const src = ac.createBufferSource();
  src.buffer = brown;
  src.loop = true;
  const lp = ac.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 400;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, ac.currentTime);
  gain.gain.setTargetAtTime(level(), ac.currentTime, 1.5);
  src.connect(lp).connect(gain).connect(master);
  src.start();
  bed = { src, gain };
  // A slow drift in level, so it breathes like a room rather than hissing like a fan.
  const breathe = () => {
    if (!bed) return;
    const a = audioOut()?.ac;
    if (a) bed.gain.gain.setTargetAtTime(level() * (0.75 + Math.random() * 0.5), a.currentTime, 2.5);
    drift = setTimeout(breathe, 4000 + Math.random() * 4000);
  };
  breathe();
  scheduleDistant();
}

function stopBed(): void {
  clearTimeout(drift);
  clearTimeout(distant);
  const out = audioOut();
  if (bed) {
    const { src, gain } = bed;
    if (out) {
      gain.gain.setTargetAtTime(0, out.ac.currentTime, 0.3);
      src.stop(out.ac.currentTime + 1.5);
    } else src.stop();
  }
  bed = null;
}

/** Another table, somewhere across the room. */
function scheduleDistant(): void {
  clearTimeout(distant);
  distant = setTimeout(
    () => {
      playDistant();
      scheduleDistant();
    },
    20_000 + Math.random() * 40_000,
  );
}

function playDistant(): void {
  const out = audioOut();
  if (!out || !bed) return;
  const { ac, master, noise } = out;
  const t = ac.currentTime;
  const pan = ac.createStereoPanner();
  pan.pan.value = (Math.random() * 2 - 1) * 0.8;
  const far = ac.createBiquadFilter();
  far.type = "lowpass";
  far.frequency.value = 1500;
  const g = ac.createGain();
  g.gain.value = useHold.getState().busy ? DUCKED : 1;
  far.connect(pan).connect(g).connect(master);
  const hit = (at: number, freq: number, dur: number, gain: number, q = 2) => {
    const src = ac.createBufferSource();
    src.buffer = noise;
    const f = ac.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const e = ac.createGain();
    e.gain.setValueAtTime(0, at);
    e.gain.linearRampToValueAtTime(gain, at + Math.min(0.01, dur / 3));
    e.gain.exponentialRampToValueAtTime(0.0005, at + dur);
    src.connect(f).connect(e).connect(far);
    src.start(at, Math.random() * 0.3, dur + 0.05);
  };
  const kind = Math.floor(Math.random() * 3);
  if (kind === 0)
    // Far-off dice: a scatter of small clicks.
    for (let i = 0; i < 6 + Math.random() * 6; i++)
      hit(t + i * (0.04 + Math.random() * 0.06), 1800 + Math.random() * 1200, 0.02, 0.025, 5);
  else if (kind === 1) {
    // A chair scraping: a short rising rasp.
    hit(t, 260, 0.35, 0.02, 1.5);
    hit(t + 0.15, 340, 0.3, 0.015, 1.5);
  } else
    // A murmur: a soft swell of voices' worth of noise.
    for (let i = 0; i < 3; i++) hit(t + i * 0.25, 400 + Math.random() * 400, 0.9, 0.012, 1);
}

/** Keep the room playing while sound and ambience are on and the tab is visible. */
export function ambience(want: boolean): void {
  const on = want && useSound.getState().on && useSound.getState().ambience && !document.hidden;
  if (on === running && (!on || bed)) return;
  running = on;
  if (on) startBed();
  else stopBed();
}

// Duck under the dice tray.
useHold.subscribe((s, prev) => {
  if (s.busy === prev.busy || !bed) return;
  const a = audioOut()?.ac;
  if (a) bed.gain.gain.setTargetAtTime(level(), a.currentTime, 0.15);
});
