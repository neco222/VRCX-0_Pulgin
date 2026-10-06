import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../plugins/better-friend-log/index.js', import.meta.url), 'utf8');
const id = (number) => `usr_00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
const target = id(1);
const alice = id(2);
const bob = id(3);
const charlie = id(4);
const owner = id(999);
const world = 'wrld_00000000-0000-0000-0000-000000000001:12345~region(jp)';
const addedAt = '2026-10-06T10:00:00.000Z';
const before = '2026-10-06T09:30:00.000Z';
const old = '2026-10-01T10:00:00.000Z';
const after = '2026-10-06T10:02:00.000Z';
const person = (userId, displayName, friendNumber = 1) => ({ user_id: userId, display_name: displayName, friend_number: friendNumber });
const friend = (userId, createdAt = old, type = 'Friend') => ({ user_id: userId, created_at: createdAt, type });
const feed = (userId, type = 'GPS', createdAt = before, location = world) => ({ user_id: userId, created_at: createdAt, type, location });
const encounter = (events) => ({
    location: world,
    worldName: 'The meeting world',
    createdAt: '2026-10-06T09:00:00.000Z',
    durationMs: 2 * 60 * 60 * 1000,
    events,
});
const player = (userId, type = 'OnPlayerJoined', createdAt = before) => ({ user_id: userId, created_at: createdAt, type });
const evidence = (overrides = {}) => ({
    schemaVersion: 1,
    userId: target,
    ownerUserId: owner,
    observedAt: '2026-10-06T12:00:00.000Z',
    addedAt,
    friends: [person(target, 'Target', 50), person(alice, 'Alice', 10)],
    relationships: [friend(target, addedAt), friend(alice)],
    feedRows: [feed(target), feed(alice)],
    hiddenUserIds: [],
    mutualFriends: { available: true, userIds: [] },
    encounter: null,
    ...overrides,
});

function loadPlugin() {
    let plugin;
    vm.runInNewContext(source, { registerPlugin: (value) => { plugin = value; } }, { filename: 'better-friend-log/index.js' });
    assert.equal(typeof plugin.start, 'function');
    assert.equal(typeof plugin.stop, 'function');
    return plugin;
}

async function harness(value) {
    const plugin = loadPlugin();
    let provider;
    let descriptor;
    let disposed = 0;
    let calls = 0;
    await plugin.start({
        ui: { addUserActivitySummarySection: async (section, callback) => {
            descriptor = section;
            provider = callback;
            return () => { disposed++; };
        } },
        vrcx: { getFriendLogEvidence: async (userId) => {
            calls++;
            assert.equal(userId, target);
            return typeof value === 'function' ? await value() : value;
        } },
    });
    assert.equal(descriptor.kind, 'friend-introductions');
    return {
        plugin,
        query: async () => JSON.parse(JSON.stringify(await provider({ userId: target }))),
        disposed: () => disposed,
        calls: () => calls,
    };
}

test('GPS command rows establish online co-presence without an Online seed', async () => {
    const active = await harness(evidence());
    const result = await active.query();
    assert.deepEqual(result.entries[0].introducedBy, [{ userId: alice, displayName: 'Alice', evidence: ['co-presence'], relationshipKnown: true }]);
    assert.equal(result.entries[0].location, world);
    await active.plugin.stop();
    assert.equal(active.disposed(), 1);
});

test('native GameLog session finds introductions when target has no pre-friend GPS', async () => {
    const active = await harness(evidence({
        feedRows: [feed(alice), feed(target, 'GPS', after)],
        encounter: encounter([player(target), player(alice)]),
    }));
    const entry = (await active.query()).entries[0];
    assert.deepEqual(entry.introducedBy.map((row) => row.userId), [alice]);
    assert.equal(entry.worldName, 'The meeting world');
    assert.equal(entry.location, world);
});

test('mutual friends corroborate co-presence and rank before co-presence alone', async () => {
    const active = await harness(evidence({
        friends: [person(target, 'Target', 50), person(alice, 'Alice'), person(bob, 'Bob'), person(charlie, 'Charlie')],
        relationships: [friend(target, addedAt), friend(alice), friend(bob), friend(charlie)],
        feedRows: [feed(target), feed(alice), feed(bob)],
        mutualFriends: { available: true, userIds: [bob, charlie] },
    }));
    const entry = (await active.query()).entries[0];
    assert.deepEqual(entry.introducedBy.map((row) => [row.userId, row.evidence]), [[bob, ['co-presence', 'mutual-friend']], [alice, ['co-presence']]]);
    assert.deepEqual(entry.mutualOnly, [{ userId: charlie, displayName: 'Charlie' }]);
});

test('current common friends without same-instance evidence remain weaker suggestions', async () => {
    const active = await harness(evidence({ feedRows: [], mutualFriends: { available: true, userIds: [alice] } }));
    const result = await active.query();
    assert.equal(result.mutualAvailable, true);
    assert.deepEqual(result.entries[0].introducedBy, []);
    assert.deepEqual(result.entries[0].mutualOnly, [{ userId: alice, displayName: 'Alice' }]);
});

test('common friends still display when original friendship time was never recorded', async () => {
    const active = await harness(evidence({ addedAt: null, relationships: [], mutualFriends: { available: true, userIds: [alice] } }));
    const entry = (await active.query()).entries[0];
    assert.equal(entry.addedAt, null);
    assert.deepEqual(entry.introducedBy, []);
    assert.deepEqual(entry.mutualOnly, [{ userId: alice, displayName: 'Alice' }]);
    assert.equal(entry.location, undefined);
});

test('Unavailable mutual data cannot be mistaken for positive common-friend evidence', async () => {
    const active = await harness(evidence({ mutualFriends: { available: false, userIds: [alice] } }));
    const result = await active.query();
    assert.equal(result.mutualAvailable, false);
    assert.deepEqual(result.entries[0].introducedBy[0].evidence, ['co-presence']);
    assert.deepEqual(result.entries[0].mutualOnly, []);
});

test('Offline wins over GPS at the same timestamp regardless of input row order', async () => {
    for (const feedRows of [[feed(alice, 'Offline'), feed(alice), feed(target)], [feed(alice), feed(target), feed(alice, 'Offline')]]) {
        const active = await harness(evidence({ feedRows }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    }
});

test('private/offline/traveling/invalid world locations and instance mismatches never establish co-presence', async () => {
    for (const invalid of ['private', 'offline', 'traveling', 'wrld_fake:12345', 'wrld_00000000-0000-0000-0000-000000000001', world.replace(':12345', ':54321')]) {
        const active = await harness(evidence({ feedRows: [feed(target), feed(alice, 'GPS', before, invalid)] }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, [], invalid);
    }
    const active = await harness(evidence({ feedRows: [feed(target), feed(alice), feed(alice, 'Location', '2026-10-06T09:45:00.000Z', 'private')] }));
    assert.deepEqual((await active.query()).entries[0].introducedBy, []);
});

test('Offline after joining removes GameLog co-presence but a later rejoin can restore it', async () => {
    const offlineTime = '2026-10-06T09:40:00.000Z';
    const base = { feedRows: [feed(alice, 'Offline', offlineTime)], encounter: encounter([player(target), player(alice)]) };
    const absent = await harness(evidence(base));
    assert.deepEqual((await absent.query()).entries[0].introducedBy, []);
    const returned = await harness(evidence({ ...base, encounter: encounter([player(target), player(alice), player(alice, 'OnPlayerJoined', '2026-10-06T09:50:00.000Z')]) }));
    assert.equal((await returned.query()).entries[0].introducedBy[0].userId, alice);
});

test('friends added later or already unfriended at that time are excluded from introductions', async () => {
    for (const relationships of [[friend(alice, after)], [friend(alice), friend(alice, before, 'Unfriend')], [friend(alice, addedAt)]]) {
        const active = await harness(evidence({ relationships: [friend(target, addedAt), ...relationships], mutualFriends: { available: true, userIds: [alice] } }));
        const entry = (await active.query()).entries[0];
        assert.deepEqual(entry.introducedBy, []);
        assert.equal(entry.mutualOnly[0].userId, alice);
    }
});

test('old positive friend order supports missing historical logs, but later/unknown order cannot', async () => {
    const accepted = await harness(evidence({ relationships: [friend(target, addedAt)] }));
    assert.equal((await accepted.query()).entries[0].introducedBy[0].relationshipKnown, false);
    for (const number of [null, 0, -1, 50, 100]) {
        const denied = await harness(evidence({ relationships: [], friends: [person(target, 'Target', 50), person(alice, 'Alice', number)] }));
        assert.deepEqual((await denied.query()).entries[0].introducedBy, []);
    }
});

test('ended/unknown GameLog sessions and players who left never create false historical presence', async () => {
    for (const visit of [
        { ...encounter([player(target), player(alice)]), durationMs: 60 * 60 * 1000 },
        { ...encounter([player(target), player(alice)]), durationMs: null },
        { ...encounter([player(target), player(alice)]), durationMs: 0 },
        encounter([player(target), player(alice), player(alice, 'OnPlayerLeft', '2026-10-06T09:50:00.000Z')]),
        encounter([player(alice)]),
    ]) {
        const active = await harness(evidence({ feedRows: [], encounter: visit }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    }
});

test('stale GPS and post-add GPS never become exact evidence at the friendship time', async () => {
    for (const time of ['2026-10-06T07:59:59.000Z', after]) {
        const active = await harness(evidence({ feedRows: [feed(target, 'GPS', time), feed(alice)] }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    }
});

test('native departures override older Feed GPS for both the target and candidates', async () => {
    for (const departedId of [target, alice]) {
        const active = await harness(evidence({ encounter: encounter([
            player(target), player(alice), player(departedId, 'OnPlayerLeft', '2026-10-06T09:50:00.000Z'),
        ]) }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    }
});

test('native target presence at another instance prevents stale Feed-only location matches', async () => {
    const currentWorld = world.replace(':12345', ':54321');
    const active = await harness(evidence({ encounter: { ...encounter([player(target)]), location: currentWorld } }));
    const entry = (await active.query()).entries[0];
    assert.deepEqual(entry.introducedBy, []);
    assert.equal(entry.location, currentWorld);
});

test('departures from expired native visits still invalidate matching but older GPS', async () => {
    for (const departedId of [target, alice]) {
        const expiredVisit = {
            ...encounter([player(target), player(alice), player(departedId, 'OnPlayerLeft', '2026-10-06T09:40:00.000Z')]),
            durationMs: 45 * 60 * 1000,
        };
        const active = await harness(evidence({ encounter: expiredVisit }));
        assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    }
});

test('future native joins/departures and out-of-visit events cannot rewrite historical presence', async () => {
    const futureJoin = await harness(evidence({ feedRows: [], encounter: encounter([player(target), player(alice, 'OnPlayerJoined', after)]) }));
    assert.deepEqual((await futureJoin.query()).entries[0].introducedBy, []);

    const futureDeparture = await harness(evidence({ encounter: encounter([player(target), player(alice), player(alice, 'OnPlayerLeft', after)]) }));
    assert.equal((await futureDeparture.query()).entries[0].introducedBy[0].userId, alice);

    const afterVisit = await harness(evidence({ encounter: {
        ...encounter([player(target), player(alice), player(alice, 'OnPlayerLeft', '2026-10-06T09:50:00.000Z')]),
        durationMs: 45 * 60 * 1000,
    } }));
    assert.equal((await afterVisit.query()).entries[0].introducedBy[0].userId, alice);

    const futureFriendship = await harness(evidence({ addedAt: '2026-10-07T10:00:00.000Z', mutualFriends: { available: true, userIds: [alice] } }));
    const entry = (await futureFriendship.query()).entries[0];
    assert.equal(entry.addedAt, null);
    assert.deepEqual(entry.introducedBy, []);
    assert.equal(entry.mutualOnly[0].userId, alice);
});

test('hidden people and owner are excluded from co-presence and common-friend suggestions', async () => {
    const active = await harness(evidence({
        friends: [person(target, 'Target', 50), person(alice, 'Alice'), person(owner, 'Owner')],
        hiddenUserIds: [alice],
        mutualFriends: { available: true, userIds: [alice, owner] },
    }));
    assert.deepEqual((await active.query()).entries[0].introducedBy, []);
    assert.deepEqual((await active.query()).entries[0].mutualOnly, []);
    const hiddenTarget = await harness(evidence({ hiddenUserIds: [target] }));
    assert.deepEqual((await hiddenTarget.query()).entries, []);
});

test('duplicated roster rows cannot create repeated candidate labels', async () => {
    const active = await harness(evidence({ friends: [person(target, 'Target', 50), person(alice, 'Alice'), person(alice, 'Alice')] }));
    assert.equal((await active.query()).entries[0].introducedBy.length, 1);
});

test('schema/user mismatch is rejected and missing host support explains how to recover', async () => {
    for (const value of [evidence({ schemaVersion: 2 }), evidence({ userId: bob })]) {
        const active = await harness(value);
        await assert.rejects(active.query, /incompatible friendship evidence/);
    }
    const plugin = loadPlugin();
    await assert.rejects(plugin.start({ ui: {}, vrcx: {} }), /update BetterDiscord/);
});

test('OFF drops pending query results and disposed callbacks cannot request more evidence', async () => {
    let resolve;
    const active = await harness(() => new Promise((done) => { resolve = done; }));
    const pending = active.query();
    await active.plugin.stop();
    resolve(evidence());
    assert.deepEqual(await pending, { entries: [], mutualAvailable: false });
    assert.deepEqual(await active.query(), { entries: [], mutualAvailable: false });
    assert.equal(active.calls(), 1);
    assert.equal(active.disposed(), 1);
});

test('OFF during initialization then ON disposes late UI registration without affecting the new UI', async () => {
    const plugin = loadPlugin();
    let finishOldRegistration;
    let oldProvider;
    let newProvider;
    let oldDisposed = 0;
    let newDisposed = 0;
    const oldStart = plugin.start({
        ui: { addUserActivitySummarySection: async (_descriptor, provider) => {
            oldProvider = provider;
            return new Promise((done) => { finishOldRegistration = () => done(() => { oldDisposed++; }); });
        } },
        vrcx: { getFriendLogEvidence: async () => evidence() },
    });
    await Promise.resolve();
    await plugin.stop();
    await plugin.start({
        ui: { addUserActivitySummarySection: async (_descriptor, provider) => {
            newProvider = provider;
            return () => { newDisposed++; };
        } },
        vrcx: { getFriendLogEvidence: async () => evidence() },
    });
    finishOldRegistration();
    await oldStart;
    assert.equal(oldDisposed, 1);
    assert.equal(newDisposed, 0);
    assert.equal((await oldProvider({ userId: target })).entries.length, 0);
    assert.equal((await newProvider({ userId: target })).entries[0].introducedBy[0].userId, alice);
    await plugin.stop();
    assert.equal(newDisposed, 1);
});
