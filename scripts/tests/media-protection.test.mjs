import test from 'node:test';
import assert from 'node:assert/strict';
import { protectPortfolioVideo } from '../../src/lib/portfolio/media-protection.ts';

test('every video guard blocks save and drag defaults and remains idempotent', () => {
  class Video extends EventTarget {
    dataset = {}; attrs = {}; draggable = true; attached = 0;
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(...args) { this.attached++; super.addEventListener(...args); }
  }
  const video = new Video();
  protectPortfolioVideo(video);
  protectPortfolioVideo(video);
  assert.equal(video.attrs.controlsList, 'nodownload');
  assert.equal(video.draggable, false);
  assert.equal(video.attached, 2);
  for (const type of ['contextmenu', 'dragstart']) {
    const event = new Event(type, { cancelable: true });
    video.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
  }
  const ordinaryEvent = new Event('play', { cancelable: true });
  video.dispatchEvent(ordinaryEvent);
  assert.equal(ordinaryEvent.defaultPrevented, false);
  protectPortfolioVideo(null);
});
