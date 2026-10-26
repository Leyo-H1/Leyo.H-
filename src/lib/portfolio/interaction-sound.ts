export type FeedbackKind = "click" | "scroll" | "hover" | "transition";
export const feedbackKinds: FeedbackKind[] = ["click", "scroll", "hover", "transition"];
export const feedbackAssets: Record<FeedbackKind, string> = Object.fromEntries(
  feedbackKinds.map(kind => [kind, `/portfolio/audio/${kind}.wav`]),
) as Record<FeedbackKind, string>;

// These four bundled clips are PCM WAV. Read them while preloading so the
// first gesture can start a ready buffer without waiting on decodeAudioData.
export function readFeedbackPcm(data: ArrayBuffer) {
  const view = new DataView(data);
  const tag = (offset: number) => String.fromCharCode(...new Uint8Array(data, offset, 4));
  if (data.byteLength < 44 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Invalid feedback WAV');
  let channels = 0, sampleRate = 0;
  for (let offset = 12; offset + 8 <= data.byteLength;) {
    const length = view.getUint32(offset + 4, true), start = offset + 8;
    if (start + length > data.byteLength) throw new Error('Truncated feedback WAV');
    if (tag(offset) === 'fmt ') {
      if (length < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 14, true) !== 16) throw new Error('Unsupported feedback PCM');
      channels = view.getUint16(start + 2, true);
      sampleRate = view.getUint32(start + 4, true);
    } else if (tag(offset) === 'data') {
      if (!channels || !sampleRate || length % (channels * 2)) throw new Error('Invalid feedback PCM format');
      const frames = length / (channels * 2);
      const samples = Array.from({ length: channels }, (_, channel) => {
        const values = new Float32Array(frames);
        for (let i = 0; i < frames; i++) values[i] = view.getInt16(start + (i * channels + channel) * 2, true) / 32768;
        return values;
      });
      return { samples, sampleRate, frames };
    }
    offset = start + length + length % 2;
  }
  throw new Error('Missing feedback PCM');
}

// Work units are gallery cards per second, measured after visual damping/inertia.
export function motionLevel(velocity: number): number {
  const speed = Math.abs(velocity);
  return Number.isFinite(speed) && speed > .025 ? .425 * Math.sqrt(speed / (speed + 2)) : 0;
}

export function createInteractionSound(report: (kind: FeedbackKind, state: AudioContextState) => void) {
  let context: AudioContext | null = null;
  let muted = false, quiet = false, destroyed = false;
  let scroll: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
  const buffers = new Map<FeedbackKind, AudioBuffer>();
  const prepared = new Map<FeedbackKind, ReturnType<typeof readFeedbackPcm>>();
  const voices = new Set<AudioBufferSourceNode>();
  const last: Record<FeedbackKind, number> = { click: -1e9, hover: -1e9, scroll: -1e9, transition: -1e9 };
  const cooldown: Record<FeedbackKind, number> = { click: 85, hover: 180, scroll: 0, transition: 350 };
  const pending = new Map<FeedbackKind, number>();
  const abort = new AbortController();
  let unlocked = false;
  const fillBuffer = (kind: FeedbackKind) => {
    const pcm = prepared.get(kind);
    if (!context || !pcm || buffers.has(kind)) return;
    const buffer = context.createBuffer(pcm.samples.length, pcm.frames, pcm.sampleRate);
    pcm.samples.forEach((samples, channel) => buffer.copyToChannel(samples, channel));
    buffers.set(kind, buffer);
    prepared.delete(kind);
  };
  const flush = () => {
    if (!available()) return;
    for (const [kind, time] of pending) {
      if (performance.now() - time > 1200) pending.delete(kind);
      else if (buffers.has(kind)) { pending.delete(kind); play(kind); }
    }
  };
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
    if (kind === "scroll" || destroyed || muted || document.hidden || !unlocked) return;
    if (!available() || !context) { pending.set(kind, performance.now()); return; }
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
  const prepare = () => {
    if (destroyed) return;
    try {
      if (!context) {
        // WebKit's default ambient session can stay silent until a video has
        // activated media playback. Select that session on the first gesture.
        const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
        try { if (session) session.type = 'playback'; } catch { /* Optional API. */ }
        context = new AudioContext({ latencyHint: "interactive" });
        context.onstatechange = flush;
      }
      feedbackKinds.forEach(fillBuffer);
    } catch { /* Visual interactions remain available without audio. */ }
  };
  feedbackKinds.forEach(kind => {
    void fetch(feedbackAssets[kind], { signal: abort.signal })
      .then(response => { if (!response.ok) throw new Error(`Audio ${response.status}`); return response.arrayBuffer(); })
      .then(data => {
        if (destroyed) return;
        prepared.set(kind, readFeedbackPcm(data));
        fillBuffer(kind);
        flush();
      }).catch(() => {});
  });
  const unlock = () => {
    if (destroyed || muted) return;
    unlocked = true;
    prepare();
    if (!context) return;
    // Run resume and a silent hardware wake-up synchronously inside the trusted
    // gesture, including touchend/click on iOS and WeChat's WebKit container.
    if (context.state !== "running") {
      void context.resume().then(flush).catch(() => {});
      const wake = context.createBufferSource();
      wake.buffer = context.createBuffer(1, 1, context.sampleRate);
      wake.connect(context.destination);
      wake.onended = () => wake.disconnect();
      wake.start();
    }
    flush();
  };
  // Files preload immediately, but create the live AudioContext inside the
  // first trusted gesture so WebKit can activate its output on that gesture.
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
    resume() { if (context && unlocked && !muted && context.state !== "running") void context.resume().then(flush).catch(() => {}); },
    destroy() {
      destroyed = true; abort.abort(); stopScroll(); pending.clear();
      for (const voice of voices) { try { voice.stop(); } catch {} }
      if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
      buffers.clear(); prepared.clear();
    },
  };
}
