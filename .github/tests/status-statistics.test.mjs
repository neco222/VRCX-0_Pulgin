import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../plugins/user-status-stats/index.js', import.meta.url), 'utf8');
const hour = 60 * 60 * 1000;
const at = (hourValue, day = '2026-10-01') => Date.parse(`${day}T00:00:00Z`) + hourValue * hour;
const row = (time, type, status, previousStatus, extras = {}) => ({
    created_at: new Date(time).toISOString(), type, status, previousStatus, ...extras
});

async function setup(history, registration = () => async () => {}, defaultPeriod) {
    let plugin;
    let callback;
    let descriptor;
    let query;
    const context = vm.createContext({ registerPlugin(value) { plugin = value; } });
    vm.runInContext(source, context, { timeout: 1000 });
    await plugin.start({
        ui: { async addUserActivitySection(value, compute) { descriptor = value; callback = compute; return registration(); } },
        settings: { async get() { return defaultPeriod; }, async register() { return async () => {}; } },
        vrcx: { async queryFeed(value) { query = value; return history; } }
    });
    return { plugin, descriptor, compute: async (period = 30) => JSON.parse(JSON.stringify(await callback({ userId: 'usr_target', period }))), query: () => query };
}
const totals = (result) => Object.fromEntries(result.data.map((item) => [item.status, item.milliseconds / hour]));

test('requested example measures duration, not number of status events', async () => {
    const subject = await setup({ from: at(9), to: at(16), rows: [
        row(at(9), 'Status', 'active'), row(at(12), 'Status', 'ask me', 'active'),
        row(at(13.5), 'Status', 'busy', 'ask me'), row(at(14), 'Status', 'join me', 'busy'), row(at(16), 'Offline')
    ] });
    const result = await subject.compute();
    assert.deepEqual(totals(result), { active: 3, 'join me': 2, 'ask me': 1.5, busy: 0.5 });
    assert.equal(result.totalMilliseconds, 7 * hour);
    assert.ok(Math.abs(result.data.reduce((sum, item) => sum + item.percentage, 0) - 100) < 1e-9);
    assert.deepEqual(result.data.map((item) => Number(item.percentage.toFixed(1))), [42.9, 28.6, 21.4, 7.1]);
});

test('Activity registration is preferred and receives per-friend duration percentages', async () => {
    let plugin;
    let provider;
    let removed = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    const requested = [];
    const ui = {
        async addUserActivitySection(descriptor, compute) {
            assert.equal(this, ui);
            assert.equal(descriptor.id, 'status-usage');
            assert.equal(descriptor.kind, 'status-statistics');
            provider = compute;
            return async () => { removed += 1; };
        },
        async addUserDialogTab() { assert.fail('Activity-capable loaders must not create a separate statistics tab'); }
    };
    await plugin.start({
        ui,
        settings: { async get() {}, async register() { return async () => {}; } },
        vrcx: { async queryFeed(context) {
            requested.push(context);
            return { from: at(0), to: at(4), rows: [
                row(at(0), 'Status', context.userId === 'usr_first' ? 'active' : 'busy'),
                row(at(3), 'Offline')
            ] };
        } }
    });
    for (const [userId, status, period] of [['usr_first', 'active', 7], ['usr_second', 'busy', 90]]) {
        const result = await provider({ userId, period });
        assert.equal(result.data.find((item) => item.status === status).percentage, 100);
        assert.equal(result.totalMilliseconds, 3 * hour);
        assert.equal(result.offlineMilliseconds, hour);
        assert.equal(result.periodLabel, `Past ${period} days`);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(requested)), [{ userId: 'usr_first', period: 7 }, { userId: 'usr_second', period: 90 }]);
    await plugin.stop();
    assert.equal(removed, 1);
    await assert.rejects(provider({ userId: 'usr_first', period: 30 }), /stopped/);
});

test('older loaders retain user-dialog registration fallback', async () => {
    let plugin;
    let registered = 0;
    let removed = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    await plugin.start({
        settings: { async get() {}, async register() { return async () => {}; } },
        ui: { async addUserDialogTab() { registered += 1; return async () => { removed += 1; }; } }
    });
    await plugin.stop();
    assert.equal(registered, 1);
    assert.equal(removed, 1);
});

test('Activity registration errors do not silently create another tab and release settings', async () => {
    let plugin;
    let removed = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    await assert.rejects(plugin.start({
        settings: { async get() {}, async register() { return async () => { removed += 1; }; } },
        ui: {
            async addUserActivitySection() { throw new Error('Activity adapter unavailable'); },
            async addUserDialogTab() { assert.fail('A failing Activity adapter must surface its failure'); }
        }
    }), /Activity adapter unavailable/);
    assert.equal(removed, 1);
    await plugin.stop();
    assert.equal(removed, 1);
});

test('missing host UI API reports compatibility failure and cleans settings', async () => {
    let plugin;
    let removed = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    await assert.rejects(plugin.start({
        settings: { async get() {}, async register() { return async () => { removed += 1; }; } },
        ui: {}
    }), /compatible user Activity adapter/);
    assert.equal(removed, 1);
});

test('offline overnight is excluded and next Online previousStatus resolves new session', async () => {
    const subject = await setup({ from: at(23), to: at(13, '2026-10-02'), rows: [
        row(at(23), 'Status', 'active'), row(at(23.5), 'Offline'),
        row(at(10, '2026-10-02'), 'Online'),
        row(at(12, '2026-10-02'), 'Status', 'join me', 'active')
    ] });
    const result = await subject.compute();
    assert.deepEqual(totals(result), { active: 2.5, 'join me': 1, 'ask me': 0, busy: 0 });
    assert.equal(result.offlineMilliseconds, 10.5 * hour);
});

test('does not guess status after a new online session without status evidence', async () => {
    const subject = await setup({ from: at(0), to: at(5), rows: [
        row(at(0), 'Status', 'active'), row(at(1), 'Offline'), row(at(3), 'Online')
    ] });
    const result = await subject.compute();
    assert.equal(totals(result).active, 1);
    assert.equal(result.unknownMilliseconds, 2 * hour);
    assert.equal(result.offlineMilliseconds, 2 * hour);
});

test('before-range seeds and end clipping establish exactly the requested interval', async () => {
    const subject = await setup({ from: at(10), to: at(12), rows: [
        row(at(8), 'Online'), row(at(9), 'Status', 'busy'), row(at(11), 'Status', 'active', 'busy'),
        row(at(13), 'Status', 'ask me', 'active')
    ] });
    assert.deepEqual(totals(await subject.compute()), { active: 1, 'join me': 0, 'ask me': 0, busy: 1 });
});

test('description-only changes and duplicate rows do not affect duration', async () => {
    const a = row(at(1), 'Status', 'active', 'active', { rowId: 2, sourceRank: 40, statusDescription: 'Updated description' });
    const subject = await setup({ from: at(0), to: at(3), rows: [a, row(at(0), 'Status', 'active', undefined, { rowId: 1, sourceRank: 40 }), a, row(at(2), 'Online')] });
    assert.equal(totals(await subject.compute()).active, 3);
});

test('duplicate online rows preserve a segment resolvable by previousStatus', async () => {
    const subject = await setup({ from: at(0), to: at(3), rows: [
        row(at(0), 'Online'), row(at(1), 'Online'), row(at(2), 'Status', 'busy', 'active')
    ] });
    assert.deepEqual(totals(await subject.compute()), { active: 2, 'join me': 0, 'ask me': 0, busy: 1 });
});

test('same-time Status and Offline are deterministic; Offline wins', async () => {
    const first = row(at(1), 'Offline', undefined, undefined, { rowId: 10, sourceRank: 50 });
    const second = row(at(1), 'Status', 'busy', 'active', { rowId: 20, sourceRank: 40 });
    for (const tied of [[first, second], [second, first]]) {
        const subject = await setup({ from: at(0), to: at(2), rows: [row(at(0), 'Status', 'active'), ...tied] });
        const result = await subject.compute();
        assert.equal(totals(result).active, 1);
        assert.equal(totals(result).busy, 0);
        assert.equal(result.offlineMilliseconds, hour);
    }
});

test('unknown initial history and invalid status are excluded from known percentages', async () => {
    const subject = await setup({ from: at(0), to: at(4), rows: [
        row(at(1), 'Status', 'mystery'), row(at(2), 'Status', 'joinme'), row(at(3), 'Status', 'askme', 'joinme'),
        { created_at: 'bad-date', type: 'Status', status: 'busy' }
    ] });
    const result = await subject.compute();
    assert.deepEqual(totals(result), { active: 0, 'join me': 1, 'ask me': 1, busy: 0 });
    assert.equal(result.unknownMilliseconds, 2 * hour);
    assert.equal(result.data.find((item) => item.status === 'join me').percentage, 50);
});

test('inconsistent previousStatus does not attribute an undocumented interval', async () => {
    const subject = await setup({ from: at(0), to: at(2), rows: [
        row(at(0), 'Status', 'active'), row(at(1), 'Status', 'busy', 'ask me')
    ] });
    const result = await subject.compute();
    assert.equal(result.unknownMilliseconds, hour);
    assert.equal(totals(result).active, 0);
    assert.equal(totals(result).busy, 1);
});

test('empty history, zero-length intervals, period selection and permission-limited API', async () => {
    const subject = await setup({ from: at(0), to: at(0), rows: [], coverage: { complete: true } });
    assert.deepEqual([...subject.descriptor.periods], [7, 30, 90, 'all']);
    assert.equal(subject.descriptor.defaultPeriod, 30);
    for (const period of [7, 30, 90, 'all']) {
        const result = await subject.compute(period);
        assert.equal(result.totalMilliseconds, 0);
        assert.equal(subject.query().period, period);
        assert.equal(subject.query().userId, 'usr_target');
        assert.deepEqual(result.coverage, { complete: true });
    }
    await subject.compute('bad');
    assert.equal(subject.query().period, 30);
});

test('start/stop/start cleans up once and callbacks reject when plugin stopped', async () => {
    let cleaned = 0;
    const subject = await setup({ from: at(0), to: at(1), rows: [] }, () => async () => { cleaned += 1; });
    await subject.plugin.stop();
    await subject.plugin.stop();
    assert.equal(cleaned, 1);
    await assert.rejects(subject.compute(), /stopped/);
    let nextCallback;
    await subject.plugin.start({
        settings: { async get() { return 7; }, async register() { return async () => {}; } },
        ui: { async addUserActivitySection(descriptor, callback) {
            assert.equal(descriptor.defaultPeriod, 7);
            nextCallback = callback;
            return async () => { cleaned += 1; };
        } },
        vrcx: { async queryFeed() { return { from: at(0), to: at(1), rows: [row(at(0), 'Status', 'active')] }; } }
    });
    assert.equal((await nextCallback({ userId: 'usr_target' })).totalMilliseconds, hour);
    await subject.plugin.stop();
    assert.equal(cleaned, 2);
});

test('disable during registration disposes late Activity section and prevents stale callback', async () => {
    let plugin;
    let resolveRegistration;
    let cleaned = 0;
    const context = vm.createContext({ registerPlugin(value) { plugin = value; } });
    vm.runInContext(source, context, { timeout: 1000 });
    const starting = plugin.start({
        settings: { async get() {}, async register() { return async () => {}; } },
        ui: { addUserActivitySection: () => new Promise((resolve) => { resolveRegistration = resolve; }) }
    });
    while (!resolveRegistration) await Promise.resolve();
    await plugin.stop();
    resolveRegistration(async () => { cleaned += 1; });
    await starting;
    assert.equal(cleaned, 1);
});

test('invalid period boundaries reject instead of presenting misleading totals', async () => {
    const subject = await setup({ from: at(2), to: at(1), rows: [] });
    await assert.rejects(subject.compute(), /Invalid status-history interval/);
});

test('saved default period is read from namespaced plugin settings; invalid defaults fall back to 30', async () => {
    for (const [saved, expected] of [[7, 7], [90, 90], [365, 30], ['all', 30]]) {
        const subject = await setup({ from: at(0), to: at(1), rows: [] }, undefined, saved);
        assert.equal(subject.descriptor.defaultPeriod, expected);
    }
});

test('failed Activity section registration releases registered settings UI', async () => {
    let plugin;
    let cleaned = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    await assert.rejects(plugin.start({
        settings: { async get() {}, async register() { return async () => { cleaned += 1; }; } },
        ui: { async addUserActivitySection() { throw new Error('Adapter unavailable'); } }
    }), /Adapter unavailable/);
    await plugin.stop();
    assert.equal(cleaned, 1);
});

test('stop attempts both cleanup handlers even if one fails', async () => {
    let plugin;
    let cleanedSettings = 0;
    vm.runInContext(source, vm.createContext({ registerPlugin(value) { plugin = value; } }), { timeout: 1000 });
    await plugin.start({
        settings: { async get() {}, async register() { return async () => { cleanedSettings += 1; }; } },
        ui: { async addUserActivitySection() { return async () => { throw new Error('Section cleanup failed'); }; } }
    });
    await assert.rejects(plugin.stop(), /Section cleanup failed/);
    assert.equal(cleanedSettings, 1);
});
