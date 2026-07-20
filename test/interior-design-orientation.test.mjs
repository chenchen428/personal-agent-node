import assert from 'node:assert/strict';
import test from 'node:test';
import { startOrientationGate } from '../skills/interior-design/scripts/orientation-gate.mjs';

test('orientation gate handles portrait, rotation, lock failure and session fallback', async () => {
  const environment = setup({ portrait: true, phone: true, lock: () => Promise.reject(new Error('denied')) });
  const gate = startOrientationGate();
  assert.equal(gate.isVisible(), true);
  assert.equal(environment.document.activeElement.id, 'request-landscape');
  await environment.requestButton.click();
  assert.match(environment.status.textContent, /未允许锁定/);
  assert.equal(gate.isVisible(), true);

  environment.portrait.set(false);
  assert.equal(gate.isVisible(), false);
  environment.portrait.set(true);
  assert.equal(gate.isVisible(), true);
  await environment.continueButton.click();
  assert.equal(gate.isVisible(), false);
  assert.equal(environment.storage.getItem('interior-design:allow-portrait'), '1');
  environment.portrait.set(false); environment.portrait.set(true);
  assert.equal(gate.isVisible(), false, 'portrait override lasts for the session');
});

test('orientation gate starts hidden in landscape and reappears on landscape-to-portrait', () => {
  const environment = setup({ portrait: false, phone: true });
  const gate = startOrientationGate();
  assert.equal(gate.isVisible(), false);
  environment.portrait.set(true);
  assert.equal(gate.isVisible(), true);
  environment.gate.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(gate.isVisible(), false, 'Escape selects the accessible portrait fallback');
});

function setup({ portrait: portraitInitial, phone: phoneInitial, lock } = {}) {
  class Element {
    constructor(id = '') { this.id = id; this.hidden = true; this.textContent = ''; this.attributes = new Map(); this.listeners = new Map(); this.classList = classes(); }
    addEventListener(type, listener) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(listener); }
    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    toggleAttribute(name, enabled) { if (enabled) this.attributes.set(name, ''); else this.attributes.delete(name); }
    focus() { document.activeElement = this; }
    async click() { for (const listener of this.listeners.get('click') || []) await listener({ currentTarget: this }); }
    keydown(event) { for (const listener of this.listeners.get('keydown') || []) listener(event); }
  }
  globalThis.HTMLElement = Element;
  const gate = new Element('orientation-gate'); const shell = new Element('viewer-shell'); const requestButton = new Element('request-landscape'); const continueButton = new Element('continue-portrait'); const status = new Element('orientation-status');
  const elements = new Map([['#orientation-gate', gate], ['#viewer-shell', shell], ['#request-landscape', requestButton], ['#continue-portrait', continueButton], ['#orientation-status', status]]);
  const body = new Element('body');
  const documentValue = { activeElement: body, body, querySelector: (selector) => elements.get(selector), contains: () => true };
  globalThis.document = documentValue;
  globalThis.window = new Element('window');
  const portrait = media(portraitInitial); const phone = media(phoneInitial);
  globalThis.matchMedia = (query) => query.includes('orientation') ? portrait : phone;
  const values = new Map(); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) };
  globalThis.sessionStorage = storage;
  globalThis.screen = { orientation: lock ? { lock } : {} };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 1; };
  return { document: documentValue, gate, requestButton, continueButton, status, portrait, phone, storage };
}

function media(initial) {
  let matches = initial; const listeners = [];
  return { get matches() { return matches; }, addEventListener(type, listener) { if (type === 'change') listeners.push(listener); }, set(value) { matches = value; listeners.forEach((listener) => listener({ matches })); } };
}
function classes() { const values = new Set(); return { toggle(name, force) { if (force) values.add(name); else values.delete(name); }, contains: (name) => values.has(name) }; }
