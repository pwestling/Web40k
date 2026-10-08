import { useEffect } from "react";
import { create } from "zustand";
import { BROADCAST } from "../broadcast/broadcast";
import type { SideMessage } from "../net/transport";
import { useStore } from "../store";
import { myName } from "../talk/talk";
import { useDuck } from "../ui/sound";
import { t } from "../i18n";

/**
 * Voice at the table (roadmap #19): each peer's mic as a WebRTC audio stream
 * over the game's own peers (and TURN, when set), never through a server.
 * Push-to-talk by default (hold V, or the button), or an open mic. Everyone
 * can mute or turn down anyone, and a ring shows who is talking. Spectators
 * listen unless they choose to speak; the streaming view plays only the
 * commentators. Voices dip under the dice tray's decisive moments.
 */

export type VoiceMode = "ptt" | "open";

export interface VoiceState {
  /** My mic is on (in voice, whether or not I'm talking right now). */
  mic: boolean;
  mode: VoiceMode;
  /** My mic is sending sound right now (push-to-talk held, or open mic). */
  live: boolean;
  /** Couldn't get the mic (no permission, no device). */
  error: string | null;
  /** Peers with their mic on, and what they call themselves. */
  peers: Record<string, { name?: string }>;
  /** Who is making sound now, by peer id (my own id too). */
  speaking: Record<string, boolean>;
  muted: Record<string, boolean>;
  /** 0–1 per peer; 1 when unset. */
  volume: Record<string, number>;
  /** I've had my mic on before, here: the button can drop its word (UX 168). */
  used: boolean;
}

const MODE_KEY = "open-battle:voice-mode";
const storedMode = (): VoiceMode => {
  try {
    return localStorage.getItem(MODE_KEY) === "open" ? "open" : "ptt";
  } catch {
    return "ptt";
  }
};

const USED_KEY = "open-battle:voice-used";
const storedUsed = (): boolean => {
  try {
    return localStorage.getItem(USED_KEY) === "1";
  } catch {
    return false;
  }
};

export const useVoice = create<VoiceState>(() => ({
  mic: false,
  mode: storedMode(),
  live: false,
  error: null,
  peers: {},
  speaking: {},
  muted: {},
  volume: {},
  used: storedUsed(),
}));

/** How far voices dip under a decisive die. */
const DUCK = 0.3;
/** RMS over which someone counts as talking, and how long the ring lingers after. */
const SPEAKING = 0.015;
const HANG_MS = 350;

interface Remote {
  stream: MediaStream;
  el: HTMLAudioElement;
  analyser: AnalyserNode | null;
  loud: number;
}

let local: MediaStream | null = null;
let localAnalyser: AnalyserNode | null = null;
let localLoud = 0;
const remotes = new Map<string, Remote>();
let vctx: AudioContext | null = null;
const buf = new Float32Array(2048);

/** A context for the speaking meters only (playback is through audio elements, which Chrome needs for remote streams). */
function meters(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  vctx ??= new AudioContext();
  if (vctx.state === "suspended") void vctx.resume();
  return vctx;
}

function analyse(stream: MediaStream): AnalyserNode | null {
  const ac = meters();
  if (!ac || !stream.getAudioTracks().length) return null;
  const a = ac.createAnalyser();
  a.fftSize = 2048;
  ac.createMediaStreamSource(stream).connect(a);
  return a;
}

function rms(a: AnalyserNode): number {
  a.getFloatTimeDomainData(buf);
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

const selfId = () => useStore.getState().session?.selfId ?? "";

/** Whether this screen plays a peer at all: the streaming view carries only the commentators (anyone not seated). */
function audible(peer: string): boolean {
  return !BROADCAST || !useStore.getState().game.players[peer];
}

/** Each voice's loudness: its volume, muted or not, and dipped under a decisive die. */
function applyVolumes(now = performance.now()): void {
  const { muted, volume } = useVoice.getState();
  const duck = useDuck.getState().until > now ? DUCK : 1;
  for (const [peer, r] of remotes) {
    const v = muted[peer] || !audible(peer) ? 0 : (volume[peer] ?? 1) * duck;
    r.el.volume = Math.max(0, Math.min(1, v));
  }
}

function attach(stream: MediaStream, peer: string): void {
  detach(peer);
  const el = new Audio();
  el.autoplay = true;
  el.srcObject = stream;
  void el.play().catch(() => {});
  const r: Remote = { stream, el, analyser: analyse(stream), loud: 0 };
  remotes.set(peer, r);
  for (const t of stream.getAudioTracks())
    t.addEventListener("ended", () => remotes.get(peer) === r && detach(peer));
  applyVolumes();
}

function detach(peer: string): void {
  const r = remotes.get(peer);
  if (!r) return;
  r.el.srcObject = null;
  remotes.delete(peer);
  useVoice.setState((s) => {
    const { [peer]: _s, ...speaking } = s.speaking;
    return { speaking };
  });
}

function setLive(live: boolean): void {
  for (const t of local?.getAudioTracks() ?? []) t.enabled = live;
  if (useVoice.getState().live !== live) useVoice.setState({ live });
}

/** Turn my mic on: ask for it, then send it to everyone in the room. */
/** Everyone's voice now (this device's mic, if on, and each peer's), for recording a clip with table talk (#46). */
export function voiceStreams(): MediaStream[] {
  return [...(local ? [local] : []), ...[...remotes.values()].map((r) => r.stream)];
}

export async function micOn(): Promise<void> {
  const session = useStore.getState().session;
  if (!session?.media || local) return;
  try {
    local = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    const denied = e instanceof DOMException && e.name === "NotAllowedError";
    useVoice.setState({
      error: denied
        ? t("Allow the microphone for this site (the icon in the address bar), then press 🎙 again.")
        : t("No microphone was found."),
    });
    return;
  }
  localAnalyser = analyse(local);
  setLive(useVoice.getState().mode === "open");
  session.media.addStream(local);
  useVoice.setState({ mic: true, error: null, used: true });
  try {
    localStorage.setItem(USED_KEY, "1");
  } catch {
    // Private windows: the word just comes back next time.
  }
  session.sendSide({ t: "talk/voice", on: true, ...name() });
}

/** Turn my mic off, and take my stream back from everyone. */
export function micOff(): void {
  const session = useStore.getState().session;
  if (local) {
    try {
      session?.media?.removeStream(local);
    } catch {
      // A peer that has gone already has nothing to remove.
    }
    for (const t of local.getTracks()) t.stop();
  }
  local = null;
  localAnalyser = null;
  useVoice.setState((s) => {
    const { [selfId()]: _me, ...speaking } = s.speaking;
    return { mic: false, live: false, speaking };
  });
  try {
    session?.sendSide({ t: "talk/voice", on: false });
  } catch {
    // Leaving the room: there's no one left to tell.
  }
}

export function setMode(mode: VoiceMode): void {
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // Private mode: the choice lasts until the page closes.
  }
  useVoice.setState({ mode });
  if (local) setLive(mode === "open");
}

/** Push-to-talk: down while held. */
export function pushToTalk(down: boolean): void {
  if (!local || useVoice.getState().mode !== "ptt") return;
  setLive(down);
}

export function setMuted(peer: string, muted: boolean): void {
  useVoice.setState((s) => ({ muted: { ...s.muted, [peer]: muted } }));
  applyVolumes();
}

export function setVolume(peer: string, volume: number): void {
  useVoice.setState((s) => ({ volume: { ...s.volume, [peer]: volume } }));
  applyVolumes();
}

/** What a spectator calls themselves (players go by their seat). */
function name(): { name?: string } {
  const me = selfId();
  if (useStore.getState().game.players[me]) return {};
  const n = myName()?.trim().slice(0, 24);
  return n ? { name: n } : {};
}

function receive(message: SideMessage, from: string): void {
  if (message.t !== "talk/voice") return;
  useVoice.setState((s) => {
    const { [from]: _gone, ...peers } = s.peers;
    if (!message.on) return { peers };
    const n = typeof message.name === "string" ? message.name.trim().slice(0, 24) : undefined;
    return { peers: { ...peers, [from]: n ? { name: n } : {} } };
  });
  if (!message.on) detach(from);
}

/** A newcomer gets my stream and hears that my mic is on. */
function meet(peer: string): void {
  const session = useStore.getState().session;
  if (!local || !session?.media) return;
  session.media.addStream(local, peer);
  session.sendSide({ t: "talk/voice", on: true, ...name() }, peer);
}

/** Who is talking, ten times a second. */
function meter(): void {
  const now = performance.now();
  const me = selfId();
  const speaking: Record<string, boolean> = {};
  const live = useVoice.getState().live;
  if (localAnalyser && live && rms(localAnalyser) > SPEAKING) localLoud = now;
  if (live && now - localLoud < HANG_MS) speaking[me] = true;
  for (const [peer, r] of remotes) {
    if (r.analyser && rms(r.analyser) > SPEAKING) r.loud = now;
    if (now - r.loud < HANG_MS && audible(peer)) speaking[peer] = true;
  }
  const was = useVoice.getState().speaking;
  const same =
    Object.keys(was).length === Object.keys(speaking).length && Object.keys(speaking).every((k) => was[k]);
  if (!same) useVoice.setState({ speaking });
  applyVolumes(now);
}

const typing = (t: EventTarget | null) =>
  t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

/** Voice for the room this screen is in: streams in and out, the meters and the push-to-talk key. */
export function useVoiceRoom(): void {
  const session = useStore((s) => s.session);
  useEffect(() => {
    const media = session?.media;
    if (!session || !media) return;
    media.onStream((stream, peer) => attach(stream, peer));
    session.listenSide(receive, meet, "voice");
    const timer = setInterval(meter, 100);
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v" && !e.repeat && !typing(e.target)) pushToTalk(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "v") pushToTalk(false);
    };
    const blur = () => pushToTalk(false);
    addEventListener("keydown", down);
    addEventListener("keyup", up);
    addEventListener("blur", blur);
    // Playback waits for a gesture in some browsers: retry on the first click.
    const wake = () => {
      void meters();
      for (const r of remotes.values()) void r.el.play().catch(() => {});
    };
    addEventListener("pointerdown", wake, { capture: true });
    return () => {
      micOff();
      for (const peer of [...remotes.keys()]) detach(peer);
      media.onStream(() => {});
      session.listenSide(null, null, "voice");
      clearInterval(timer);
      removeEventListener("keydown", down);
      removeEventListener("keyup", up);
      removeEventListener("blur", blur);
      removeEventListener("pointerdown", wake, { capture: true });
      useVoice.setState({ peers: {}, speaking: {} });
    };
  }, [session]);
}

// Browser tests read the live audio elements.
if (import.meta.env.DEV) Object.assign(globalThis, { openBattleVoice: { remotes, useVoice } });
