import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { feedbackKinds, feedbackAssets, motionLevel, createInteractionSound, readFeedbackPcm } from '../../src/lib/portfolio/interaction-sound.ts';

const clip = kind => {
  const bytes = readFileSync(new URL(`../../public${feedbackAssets[kind]}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

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
  globalThis.fetch = async url => ({ok: true, arrayBuffer: async () => clip(url.split('/').at(-1).split('.')[0])});
  globalThis.AudioContext = class {
    state = 'suspended'; currentTime = 1; destination = {};
    constructor() { contexts++; }
    decodeAudioData() { return Promise.resolve({}); }
    createBuffer(channels, frames) { return {silent: frames === 1, copyToChannel() {}}; }
    createBufferSource() {
      const source = {playbackRate: {setTargetAtTime() {}}, connect() {return this;}, disconnect() {}, start() {this.started = true; if (this.buffer?.silent) sources.splice(sources.indexOf(this), 1);}, stop() {this.stopped = true;}};
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
    await settle(); engine.unlock();
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

test('the first touch click survives asynchronous hardware resume and does not wait for the movement file', async () => {
  const previous = {document:globalThis.document,AudioContext:globalThis.AudioContext,fetch:globalThis.fetch};
  const reports = [];
  let finishMovement;
  globalThis.document = {hidden:false};
  globalThis.fetch = async url => ({ok:true,arrayBuffer:() => url.endsWith('scroll.wav')
    ? new Promise(resolve => {finishMovement=resolve;}) : Promise.resolve(clip(url.split('/').at(-1).split('.')[0]))});
  globalThis.AudioContext = class {
    state='suspended'; currentTime=0; sampleRate=24000; destination={};
    decodeAudioData() {return Promise.resolve({});}
    createBuffer() {return {copyToChannel() {}};}
    createBufferSource() {return {connect(){return this;},disconnect(){},start(){},stop(){}};}
    createGain() {return {gain:{value:0},connect(){return this;},disconnect(){}};}
    async resume() {await settle(); this.state='running';}
    close() {return Promise.resolve();}
  };
  try {
    const engine=createInteractionSound(kind => reports.push(kind));
    await settle();
    engine.unlock(); engine.play('click');
    assert.deepEqual(reports,[]);
    await settle(); await settle();
    assert.deepEqual(reports,['click']);
    finishMovement(clip('scroll')); await settle();
    assert.deepEqual(reports,['click']);
    engine.destroy();
  } finally {Object.assign(globalThis,previous);}
});

test('preloaded PCM is ready on the first gesture without async browser decoding', async () => {
  const previous = {document:globalThis.document,AudioContext:globalThis.AudioContext,fetch:globalThis.fetch};
  const previousSession = Object.getOwnPropertyDescriptor(navigator, 'audioSession');
  const session = {type:'auto'};
  Object.defineProperty(navigator, 'audioSession', {value:session,configurable:true});
  const reports = [];
  globalThis.document = {hidden:false};
  globalThis.fetch = async url => ({ok:true,arrayBuffer:async () => clip(url.split('/').at(-1).split('.')[0])});
  globalThis.AudioContext = class {
    constructor() {assert.equal(session.type,'playback','select the media audio session before starting Web Audio');}
    state='running'; currentTime=0; destination={};
    decodeAudioData() {throw new Error('First click must not wait for decoding');}
    createBuffer(channels,frames,rate) {assert.equal(rate,24000);return {copyToChannel(samples) {assert.equal(samples.length,frames);}};}
    createBufferSource() {return {connect(){return this;},disconnect(){},start(){},stop(){}};}
    createGain() {return {gain:{value:0},connect(){return this;},disconnect(){}};}
    close() {return Promise.resolve();}
  };
  try {
    const engine=createInteractionSound(kind => reports.push(kind));
    await settle();
    engine.unlock(); engine.play('click');
    assert.deepEqual(reports,['click']);
    engine.play('hover'); assert.deepEqual(reports,['click','hover']);
    engine.destroy();
    const pcm=readFeedbackPcm(clip('click'));
    assert.equal(pcm.frames,3048); assert.equal(pcm.samples.length,1);
    assert.throws(()=>readFeedbackPcm(new ArrayBuffer(8)));
  } finally {
    Object.assign(globalThis,previous);
    if(previousSession)Object.defineProperty(navigator,'audioSession',previousSession);
    else delete navigator.audioSession;
  }
});
