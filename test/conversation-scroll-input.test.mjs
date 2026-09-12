import assert from 'node:assert/strict';
import test from 'node:test';
import { bindConversationScrollInput } from '../core/app/src/lib/conversation-scroll-input.ts';
import { announceImagePreview } from '../core/app/src/lib/chat-image-preview.ts';

class Surface extends EventTarget {
  constructor(parent = null) { super(); this.parent = parent; }
  dispatchEvent(event) {
    const result = super.dispatchEvent(event);
    if (event.bubbles && this.parent) this.parent.dispatchEvent(new Event(event.type, { bubbles: true }));
    return result;
  }
}
function clock() {
  let time = 0; let next = 0; const timers = new Map();
  return {
    setTimer(callback, delay) { const id = ++next; timers.set(id, { callback, at: time + delay }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(delay) {
      const end = time + delay;
      while (true) {
        const first = [...timers.entries()].filter(([, task]) => task.at <= end).sort((left, right) => left[1].at - right[1].at)[0];
        if (!first) break;
        timers.delete(first[0]); time = first[1].at; first[1].callback();
      }
      time = end;
    },
    count: () => timers.size,
  };
}
function emit(target, type, properties = {}) {
  const event = new Event(type); Object.assign(event, properties); target.dispatchEvent(event);
}
function setup(root = new Surface()) {
  const timers = clock(); const thread = new Surface(root); const windowTarget = new Surface();
  const observations = { scrolls: [], releases: 0, towardLatest: 0 };
  const dispose = bindConversationScrollInput(thread, {
    scrolled: (user) => observations.scrolls.push(user),
    release: () => observations.releases++, towardLatest: () => observations.towardLatest++,
  }, { windowTarget, previewRoot: root, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  return { root, thread, windowTarget, timers, observations, dispose };
}

test('wheel and keyboard intent expires without browser scrollend support', () => {
  const f = setup();
  emit(f.thread, 'wheel', { deltaY: -30 }); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), true); assert.equal(f.observations.releases, 1);
  f.timers.advance(181); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), false, 'late image/layout scroll is not user intent');
  emit(f.thread, 'keydown', { key: 'PageDown' }); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), true);
  f.timers.advance(181); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), false);
  f.dispose();
});

test('inertial scroll events cannot extend the hard user-input deadline indefinitely', () => {
  const f = setup();
  emit(f.thread, 'touchstart', { touches: [{ clientY: 300 }] });
  emit(f.thread, 'touchend');
  for (let index = 0; index < 14; index++) { f.timers.advance(100); emit(f.thread, 'scroll'); }
  assert.equal(f.observations.scrolls.at(-1), true, 'finite momentum is still treated as user scrolling');
  f.timers.advance(101); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), false, 'scroll events alone do not renew the input deadline');
  emit(f.thread, 'wheel', { deltaY: 20 }); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), true, 'new physical input starts a new bounded window');
  f.dispose();
});

test('scrollend, blur, and unmount end input state and remove event timers/listeners', () => {
  const f = setup();
  emit(f.thread, 'keydown', { key: 'End' }); emit(f.thread, 'scrollend'); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), false);
  emit(f.thread, 'pointerdown'); emit(f.windowTarget, 'blur'); emit(f.thread, 'scroll');
  assert.equal(f.observations.scrolls.at(-1), false);
  emit(f.thread, 'wheel', { deltaY: -40 }); f.dispose();
  assert.equal(f.timers.count(), 0);
  const before = structuredClone(f.observations);
  emit(f.thread, 'wheel', { deltaY: -40 }); emit(f.thread, 'scroll'); emit(f.windowTarget, 'pointermove');
  assert.deepEqual(f.observations, before);
});

test('pending composer preview freezes only its owning conversation outside the scroll viewport', () => {
  const f = setup(); const other = setup();
  const composer = new Surface(f.root); const thumbnail = new Surface(composer);
  emit(f.thread, 'wheel', { deltaY: 30 });
  announceImagePreview(thumbnail);
  assert.equal(f.observations.releases, 1);
  assert.equal(other.observations.releases, 0);
  emit(f.thread, 'scroll'); assert.equal(f.observations.scrolls.at(-1), false);
  assert.equal(f.timers.count(), 0);
  f.dispose(); other.dispose();
});
