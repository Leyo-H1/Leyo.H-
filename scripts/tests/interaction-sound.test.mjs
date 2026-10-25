import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { feedbackKinds, feedbackAssets, motionLevel, createInteractionSound } from '../../src/lib/portfolio/interaction-sound.ts';

const settle = () => new Promise(resolve => setImmediate(resolve));
test('reference WAV clips are finite PCM, quiet, and the movement loop joins smoothly', () => {
  for (const kind of feedbackKinds) {
    const wav = readFileSync(new URL(`../../public${feedbackAssets[kind]}`, import.meta.url));
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt32LE(24), 24000);
    const values = [];
    for (let i = 44; i < wav.length; i += 2) values.push(wav.readInt16LE(i) / 32768);
    const rms = Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length);
    assert.ok(rms > .003 && rms < .04, `${kind}: ${rms}`);
    assert.ok(Math.max(...values.map(Math.abs)) <= .161);
    if (kind !== 'scroll') { assert.equal(values[0], 0); assert.equal(values.at(-1), 0); }
    else assert.ok(Math.abs(values[0] - values.at(-1)) < .025, 'loop seam');
  }
});

test('motion strength follows actual speed in either direction, without a fixed cue length', () => {
  assert.equal(motionLevel(0), 0); assert.equal(motionLevel(.01), 0);
  assert.equal(motionLevel(NaN), 0);
  assert.ok(motionLevel(.2) < motionLevel(1) && motionLevel(1) < motionLevel(5));
  assert.equal(motionLevel(-2), motionLevel(2));
});

test('two movement waves reuse one voice, decay at rest, and obey mute/player/visibility/cleanup', async () => {
  const previous = {document: globalThis.document, AudioContext: globalThis.AudioContext, fetch: globalThis.fetch};
  const sources = [], gains = []; let contexts = 0, closed = 0;
  globalThis.document = {hidden: false};
  globalThis.fetch = async () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(8)});
  globalThis.AudioContext = class {
    state = 'suspended'; currentTime = 1; destination = {};
    constructor() { contexts++; }
    decodeAudioData() { return Promise.resolve({}); }
    createBufferSource() {
      const source = {playbackRate: {setTargetAtTime() {}}, connect() {return this;}, disconnect() {}, start() {this.started = true;}, stop() {this.stopped = true;}};
      sources.push(source); return source;
    }
    createGain() {
      const gain = {gain: {value: 0, targets: [], setTargetAtTime(v) {this.targets.push(v);}, cancelScheduledValues() {}}, connect() {return this;}, disconnect() {}};
      gains.push(gain); return gain;
    }
    resume() {this.state = 'running'; return Promise.resolve();}
    suspend() {this.state = 'suspended'; return Promise.resolve();}
    close() {closed++; return Promise.resolve();}
  };
  try {
    const reports = [], engine = createInteractionSound(kind => reports.push(kind));
    engine.motion(2); engine.play('click'); assert.equal(contexts, 0);
    engine.unlock(); await settle();
    engine.play('click'); engine.play('click'); assert.equal(sources.length, 1);
    engine.motion(1); const loop = sources.at(-1), gain = gains.at(-1);
    engine.motion(3); engine.motion(.2); engine.motion(0); engine.motion(-4); engine.motion(.1); engine.motion(0);
    assert.equal(sources.length, 2); assert.equal(loop.loop, true);
    assert.equal(reports.filter(k => k === 'scroll').length, 1);
    assert.equal(gain.gain.targets.at(-1), 0);
    assert.ok(gain.gain.targets[1] > gain.gain.targets[0]);
    engine.play('scroll'); assert.equal(sources.length, 2);
    engine.configure(false, true); assert.equal(loop.stopped, true); engine.motion(2); assert.equal(sources.length, 2);
    engine.configure(false, false); engine.motion(2); assert.equal(sources.length, 3);
    engine.configure(true, false); engine.motion(3); engine.play('hover'); assert.equal(sources.length, 3);
    engine.configure(false, false); engine.motion(2); engine.suspend(); assert.equal(sources.at(-1).stopped, true);
    engine.resume(); globalThis.document.hidden = true; engine.motion(3); assert.equal(sources.length, 4);
    globalThis.document.hidden = false; engine.motion(3); engine.endMotion(); assert.equal(sources.at(-1).stopped, true);
    engine.destroy(); engine.motion(2); engine.play('transition'); assert.equal(closed, 1); assert.equal(sources.length, 5);
  } finally { Object.assign(globalThis, previous); }
});
