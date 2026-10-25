import assert from 'node:assert/strict';
import test from 'node:test';
import {createVerticalSwipe} from '../../src/lib/portfolio/vertical-swipe.ts';

test('vertical swipes preserve incremental travel, pauses, two waves and exact reversal', () => {
  const swipe = createVerticalSwipe(); let travel = 0;
  swipe.begin(1, 150, 600);
  assert.equal(swipe.move(1, 151, 596), null);
  travel += swipe.move(1, 152, 500); assert.equal(travel, 100);
  travel += swipe.move(1, 153, 500); assert.equal(travel, 100);
  travel += swipe.move(1, 154, 300); assert.equal(travel, 300);
  travel += swipe.move(1, 151, 600); assert.equal(travel, 0);
  assert.equal(swipe.end(1), true);
  swipe.begin(2, 150, 600); assert.equal(swipe.move(2, 150, 400), 200);
  assert.equal(swipe.end(2), true);
});
test('horizontal gallery dragging and taps are not claimed; cancellation and other fingers do not move progress', () => {
  const swipe = createVerticalSwipe();
  swipe.begin(1, 100, 300); assert.equal(swipe.move(1, 104, 303), null); assert.equal(swipe.end(1), false);
  swipe.begin(1, 100, 300); assert.equal(swipe.move(1, 150, 301), null); assert.equal(swipe.move(1, 200, 100), null);
  assert.equal(swipe.end(1), false);
  swipe.begin(1, 100, 300); assert.equal(swipe.move(2, 100, 100), null); assert.equal(swipe.end(2), false);
  assert.equal(swipe.move(1, 100, 200), 100); swipe.cancel(); assert.equal(swipe.move(1, 100, 100), null);
});
