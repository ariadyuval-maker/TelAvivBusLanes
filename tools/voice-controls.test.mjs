import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function harness(voices = [], preferred = '') {
    const events = new Map();
    const timers = new Map();
    let id = 0;
    const clock = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); } };
    const window = { ...clock, speechSynthesis: { getVoices: () => voices } };
    const context = vm.createContext({ window, localStorage: { getItem: () => preferred } });
    vm.runInContext(readFileSync(new URL('../voice-controls.js', import.meta.url), 'utf8'), context);
    let toggles = 0, opens = 0;
    const button = { addEventListener(name, fn) { events.set(name, fn); }, setPointerCapture() {} };
    window.BusLaneVoices.bindButton(button, () => toggles++, () => opens++, clock);
    return {
        api: window.BusLaneVoices,
        emit(name, extra = {}) { events.get(name)?.({ button: 0, pointerId: 1, clientX: 0, clientY: 0, detail: 1, preventDefault() {}, ...extra }); },
        hold() { for (const [i, fn] of timers) { timers.delete(i); fn(); } },
        get toggles() { return toggles; }, get opens() { return opens; }
    };
}

test('short click toggles once and never opens picker', () => {
    const h = harness();
    h.emit('pointerdown'); h.emit('pointerup'); h.emit('click'); h.hold();
    assert.equal(h.toggles, 1); assert.equal(h.opens, 0);
});
test('long press opens once and suppresses the following click', () => {
    const h = harness();
    h.emit('pointerdown'); h.hold(); h.emit('contextmenu'); h.emit('pointerup'); h.emit('click');
    assert.equal(h.opens, 1); assert.equal(h.toggles, 0);
    h.emit('pointerdown'); h.emit('pointerup'); h.emit('click');
    assert.equal(h.toggles, 1);
});
test('drag and pointer cancellation do not toggle or open', () => {
    for (const event of ['pointermove', 'pointercancel']) {
        const h = harness();
        h.emit('pointerdown'); h.emit(event, { clientX: 25 }); h.hold(); h.emit('pointerup'); h.emit('click');
        assert.equal(h.toggles, 0); assert.equal(h.opens, 0);
    }
});
test('keyboard click toggles; alternate keyboard shortcut opens picker', () => {
    const h = harness();
    h.emit('click', { detail: 0 }); h.emit('keydown', { shiftKey: true, key: 'F10' });
    assert.equal(h.toggles, 1); assert.equal(h.opens, 1);
});
test('saved voice is used and included in at most three distinct choices', () => {
    const voices = [1,2,3,4].map(i => ({ name: `Voice ${i}`, lang: 'he-IL', voiceURI: String(i) }));
    const h = harness(voices, '4');
    assert.equal(h.api.getVoice(), voices[3]);
    const choices = h.api.optionsFor([...voices, voices[0]], '4');
    assert.equal(choices.length, 3); assert.equal(choices[0], voices[3]);
    assert.equal(new Set(choices.map(v => v.name)).size, 3);
});
test('missing saved voice falls back to a Hebrew voice; no voices is safe', () => {
    const hebrew = { name: 'Hebrew', lang: 'he-IL', voiceURI: 'he' };
    assert.equal(harness([{name: 'English', lang: 'en-US'}, hebrew], 'unavailable').api.getVoice(), hebrew);
    assert.equal(harness().api.getVoice(), undefined);
});
