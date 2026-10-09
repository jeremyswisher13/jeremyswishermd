import assert from 'node:assert/strict';
import test from 'node:test';
import { blankSet, mountWorkout } from '../../hep-workout.js';

class NodeStub {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = new Map();
    this.handlers = new Map();
  }

  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  addEventListener(name, handler) { this.handlers.set(name, handler); }
  reportValidity() { return true; }
  dispatch(name) { this.handlers.get(name)?.({ preventDefault() {} }); }

  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const matches = node => selector.startsWith('[')
      ? node.attributes.has(selector.slice(1, -1)) : node.tag === selector;
    const nodes = [];
    const visit = node => {
      for (const child of node.children) {
        if (matches(child)) nodes.push(child);
        visit(child);
      }
    };
    visit(this);
    return nodes;
  }
}

function timerHarness(t) {
  let now = 100000;
  let nextId = 0;
  const intervals = new Map();
  const announcements = [];
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const document = {
    createElement: tag => new NodeStub(tag),
    addEventListener() {},
    removeEventListener() {},
  };
  globalThis.document = document;
  globalThis.window = {
    setInterval(callback) { const id = ++nextId; intervals.set(id, callback); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  t.mock.method(Date, 'now', () => now);
  const parent = new NodeStub('article');
  const mounted = mountWorkout(parent, { measure: 'minutes', label: 'Minutes', resistance: false },
    [blankSet()], null, message => announcements.push(message));
  t.after(() => {
    mounted.cleanup();
    if (savedDocument === undefined) delete globalThis.document;
    else globalThis.document = savedDocument;
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
  });
  const timer = parent.querySelector('[data-hep-timer]');
  const control = name => timer.querySelector(`[data-hep-timer-${name}]`);
  return {
    control, announcements, intervals,
    advanceWithoutTick(milliseconds) { now += milliseconds; },
    tick() { for (const callback of [...intervals.values()]) callback(); },
    start(seconds) {
      control('duration').value = String(seconds);
      timer.querySelector('form').dispatch('submit');
    },
  };
}

test('pause immediately refreshes a countdown after a delayed callback and resume uses that remaining time', t => {
  const timer = timerHarness(t);
  timer.start(30);
  assert.equal(timer.control('clock').textContent, '00:30');
  timer.advanceWithoutTick(1050);
  timer.control('pause').dispatch('click');
  assert.equal(timer.control('clock').textContent, '00:29');
  assert.equal(timer.control('pause').textContent, 'Resume');
  assert.equal(timer.intervals.size, 0);
  assert.equal(timer.control('start').disabled, true);
  assert.equal(timer.announcements.at(-1), 'Timer paused.');
  timer.advanceWithoutTick(10000);
  timer.control('pause').dispatch('click');
  assert.equal(timer.control('clock').textContent, '00:29');
  assert.equal(timer.control('pause').textContent, 'Pause');
  timer.advanceWithoutTick(1000);
  timer.tick();
  assert.equal(timer.control('clock').textContent, '00:28');
});

test('pause after the deadline before a delayed callback finishes the timer and restores its controls', t => {
  const timer = timerHarness(t);
  timer.start(1);
  timer.advanceWithoutTick(1000);
  timer.control('pause').dispatch('click');
  assert.equal(timer.control('clock').textContent, '00:00');
  assert.equal(timer.intervals.size, 0);
  assert.match(timer.announcements.at(-1), /^Timer finished\./);
  for (const name of ['pause', 'extend', 'cancel']) assert.equal(timer.control(name).disabled, true, name);
  for (const name of ['start', 'duration']) assert.equal(timer.control(name).disabled, false, name);
  timer.start(5);
  assert.equal(timer.control('clock').textContent, '00:05');
  assert.equal(timer.intervals.size, 1);
});
