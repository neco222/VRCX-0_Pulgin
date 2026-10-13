import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../plugins/sukikira-vrc/index.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(new URL('../../plugins/sukikira-vrc/manifest.json', import.meta.url), 'utf8'));

function loadPlugin() {
    let plugin;
    let registrations = 0;
    vm.runInNewContext(source, {
        registerPlugin(value) {
            plugin = value;
            registrations++;
        },
    }, { filename: 'sukikira-vrc/index.js' });
    assert.equal(registrations, 1);
    assert.equal(typeof plugin.start, 'function');
    assert.equal(typeof plugin.stop, 'function');
    return plugin;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

const tick = () => Promise.resolve();
const api = (register) => ({ ui: { addUserReviewTab: register } });

test('registers only the host Review tab and supports OFF and re-enable', async () => {
    const plugin = loadPlugin();
    const descriptors = [];
    const removed = [];
    const host = api(async (descriptor) => {
        descriptors.push(JSON.parse(JSON.stringify(descriptor)));
        const index = descriptors.length;
        return () => removed.push(index);
    });
    await plugin.start(host);
    assert.deepEqual(descriptors, [{
        id: 'review', title: 'レビュー', localizedTitle: { ja: 'レビュー', en: 'Review' },
    }]);
    await plugin.stop();
    await plugin.stop();
    assert.deepEqual(removed, [1]);
    await plugin.start(host);
    assert.equal(descriptors.length, 2);
    await plugin.stop();
    assert.deepEqual(removed, [1, 2]);
    assert.deepEqual(manifest.permissions, ['userDialog.modify']);
});

test('unsupported loader reports the required version and can recover after update', async () => {
    const plugin = loadPlugin();
    for (const host of [undefined, {}, { ui: {} }, api(null)]) {
        await assert.rejects(plugin.start(host), /BetterDiscord v0\.4\.0/);
    }
    let removed = 0;
    await plugin.start(api(async () => () => { removed++; }));
    await plugin.stop();
    assert.equal(removed, 1);
});

test('OFF during registration removes the late Review tab instead of reviving it', async () => {
    const plugin = loadPlugin();
    const pending = deferred();
    let removed = 0;
    const starting = plugin.start(api(() => pending.promise));
    await tick();
    await plugin.stop();
    pending.resolve(() => { removed++; });
    await starting;
    assert.equal(removed, 1);
    await plugin.stop();
    assert.equal(removed, 1);
});

test('older registration resolving after re-enable cannot replace its new disposer', async () => {
    const plugin = loadPlugin();
    const old = deferred();
    const removed = [];
    const starting = plugin.start(api(() => old.promise));
    await tick();
    await plugin.stop();
    await plugin.start(api(async () => () => removed.push('new')));
    old.resolve(() => removed.push('old'));
    await starting;
    assert.deepEqual(removed, ['old']);
    await plugin.stop();
    assert.deepEqual(removed, ['old', 'new']);
});

test('registration failure propagates while active and leaves re-enable usable', async () => {
    const plugin = loadPlugin();
    const failure = new Error('Host registration failed');
    await assert.rejects(plugin.start(api(async () => { throw failure; })), (error) => error === failure);
    await plugin.stop();
    let removed = 0;
    await plugin.start(api(async () => () => { removed++; }));
    await plugin.stop();
    assert.equal(removed, 1);
});

test('late registration rejection after OFF does not fail a newer start', async () => {
    const plugin = loadPlugin();
    const old = deferred();
    const starting = plugin.start(api(() => old.promise));
    await tick();
    await plugin.stop();
    let removed = 0;
    await plugin.start(api(async () => () => { removed++; }));
    old.reject(new Error('Old host stopped'));
    await starting;
    await plugin.stop();
    assert.equal(removed, 1);
});

test('a replacement start disposes the previous registration once', async () => {
    const plugin = loadPlugin();
    const removed = [];
    await plugin.start(api(async () => () => removed.push('old')));
    await plugin.start(api(async () => () => removed.push('new')));
    assert.deepEqual(removed, ['old']);
    await plugin.stop();
    assert.deepEqual(removed, ['old', 'new']);
});

test('OFF while awaiting previous cleanup cancels replacement registration', async () => {
    const plugin = loadPlugin();
    const cleanup = deferred();
    await plugin.start(api(async () => () => cleanup.promise));
    let calls = 0;
    const replacing = plugin.start(api(async () => {
        calls++;
        return () => {};
    }));
    await tick();
    await plugin.stop();
    cleanup.resolve();
    await replacing;
    assert.equal(calls, 0);
});
