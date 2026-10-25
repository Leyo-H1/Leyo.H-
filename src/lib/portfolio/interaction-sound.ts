export type FeedbackKind = "click" | "scroll" | "hover" | "transition";
export const feedbackKinds: FeedbackKind[] = ["click", "scroll", "hover", "transition"];
export const feedbackAssets: Record<FeedbackKind, string> = Object.fromEntries(
  feedbackKinds.map(kind => [kind, `/portfolio/audio/${kind}.wav`]),
) as Record<FeedbackKind, string>;

// Work units are gallery cards per second, measured after visual damping/inertia.
export function motionLevel(velocity: number): number {
  const speed = Math.abs(velocity);
  return Number.isFinite(speed) && speed > .025 ? .5 * Math.sqrt(speed / (speed + 2)) : 0;
}

export function createInteractionSound(report: (kind: FeedbackKind, state: AudioContextState) => void) {
  let context: AudioContext | null = null;
  let muted = false, quiet = false, destroyed = false;
  let decoding: Promise<void> | null = null;
  let scroll: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  const buffers = new Map<FeedbackKind, AudioBuffer>();
  const voices = new Set<AudioBufferSourceNode>();
  const last: Record<FeedbackKind, number> = { click: -1e9, hover: -1e9, scroll: -1e9, transition: -1e9 };
  const cooldown: Record<FeedbackKind, number> = { click: 85, hover: 180, scroll: 0, transition: 350 };
  const pending = new Map<FeedbackKind, number>();
  const abort = new AbortController();
  // Fetch ahead of the first gesture. AudioContext itself is gesture-unlocked only.
  const files = Promise.all(feedbackKinds.map(async kind => {
    const response = await fetch(feedbackAssets[kind], { signal: abort.signal });
    if (!response.ok) throw new Error(`Audio ${response.status}`);
    return [kind, await response.arrayBuffer()] as const;
  })).catch(() => []);
  const stopScroll = () => {
    if (!scroll) return;
    const { source, gain } = scroll;
    scroll = null;
    const now = context?.currentTime ?? 0;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setTargetAtTime(0, now, .012);
    try { source.stop(now + .06); } catch { /* Already stopped. */ }
  };
  const available = () => !destroyed && !muted && !document.hidden && context?.state === "running";
  const play = (kind: FeedbackKind) => {
    // Movement has its own continuous voice; never turn wheel events into cues.
    if (kind === "scroll" || !available() || !context) return;
    if (quiet && kind === "hover") return;
    const now = performance.now();
    if (now - last[kind] < cooldown[kind] || voices.size >= 3) return;
    const buffer = buffers.get(kind);
    if (!buffer) { pending.set(kind, now); return; }
    last[kind] = now;
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = quiet ? .12 : kind === "hover" ? .22 : .5;
    source.buffer = buffer;
    source.connect(gain).connect(context.destination);
    voices.add(source);
    source.onended = () => { voices.delete(source); source.disconnect(); gain.disconnect(); };
    source.start();
    report(kind, context.state);
  };
  const unlock = () => {
    if (destroyed || muted) return;
    try {
      if (!context) context = new AudioContext({ latencyHint: "interactive" });
      if (context.state === "suspended") void context.resume().catch(() => {});
      if (!decoding) {
        const audio = context;
        decoding = files.then(async entries => {
          await Promise.all(entries.map(async ([kind, data]) => {
            const buffer = await audio.decodeAudioData(data);
            if (!destroyed) buffers.set(kind, buffer);
          }));
          for (const [kind, time] of pending) if (performance.now() - time < 250) play(kind);
          pending.clear();
        }).catch(() => { pending.clear(); });
      }
    } catch { /* Visual interactions remain available without audio. */ }
  };
  return {
    unlock, play,
    motion(velocity: number) {
      if (!available() || quiet || !context) { stopScroll(); return; }
      const level = motionLevel(velocity);
      if (!scroll && level > 0) {
        const buffer = buffers.get("scroll");
        if (!buffer) return;
        const source = context.createBufferSource(), gain = context.createGain();
        source.buffer = buffer; source.loop = true;
        gain.gain.value = 0;
        source.connect(gain).connect(context.destination);
        source.onended = () => { source.disconnect(); gain.disconnect(); };
        source.start(); scroll = { source, gain };
        report("scroll", context.state);
      }
      if (scroll) {
        // The same source continues across input waves, reversal, and inertia.
        // At rest it is silent, without replaying a transient on the next wheel.
        scroll.gain.gain.setTargetAtTime(level, context.currentTime, level > 0 ? .035 : .055);
        scroll.source.playbackRate.setTargetAtTime(.85 + .35 * Math.min(1, Math.abs(velocity) / 5), context.currentTime, .09);
      }
    },
    endMotion: stopScroll,
    configure(nextMuted: boolean, nextQuiet: boolean) {
      muted = nextMuted; quiet = nextQuiet;
      if (muted || quiet) stopScroll();
      if (muted) {
        pending.clear();
        for (const voice of voices) { try { voice.stop(); } catch {} }
      }
    },
    suspend() { stopScroll(); if (context?.state === "running") void context.suspend().catch(() => {}); },
    resume() { if (context && !muted && context.state === "suspended") void context.resume().catch(() => {}); },
    destroy() {
      destroyed = true; abort.abort(); stopScroll(); pending.clear();
      for (const voice of voices) { try { voice.stop(); } catch {} }
      if (context) void context.close().catch(() => {});
      buffers.clear();
    },
  };
}
