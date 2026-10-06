import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, cp, mkdtemp, mkdir, appendFile, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url));
test('catalog hashes include manifest, executable entry and packaged icon', async () => {
    const catalog = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8'));
    assert.equal(catalog.schemaVersion, 1);
    assert.equal(catalog.plugins.length, 1);
    for (const plugin of catalog.plugins) {
        assert.equal(plugin.sha256, plugin.files[plugin.entry]);
        assert.ok(plugin.files[plugin.manifest]);
        assert.ok(plugin.files[plugin.icon]);
        for (const [relative, expected] of Object.entries(plugin.files)) {
            assert.ok(relative.startsWith(`plugins/${plugin.id}/`));
            assert.equal(createHash('sha256').update(await readFile(path.join(root, relative))).digest('hex'), expected);
        }
    }
});

test('publishing validator rejects a payload changed without updating its catalog', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'vrcx-store-validation-'));
    try {
        await cp(path.join(root, 'plugins'), path.join(fixture, 'plugins'), { recursive: true });
        await mkdir(path.join(fixture, '.github'), { recursive: true });
        await cp(path.join(root, '.github/scripts'), path.join(fixture, '.github/scripts'), { recursive: true });
        await cp(path.join(root, 'index.json'), path.join(fixture, 'index.json'));
        const original = spawnSync(process.execPath, [path.join(fixture, '.github/scripts/store-index.mjs'), '--check'], { encoding: 'utf8' });
        assert.equal(original.status, 0, original.stderr);
        await appendFile(path.join(fixture, 'plugins/user-status-stats/index.js'), '\n// altered payload\n');
        const altered = spawnSync(process.execPath, [path.join(fixture, '.github/scripts/store-index.mjs'), '--check'], { encoding: 'utf8' });
        assert.notEqual(altered.status, 0);
        assert.match(altered.stderr, /differs from plugin metadata\/content|changed without a version bump/);
    } finally {
        const absolute = path.resolve(fixture);
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(absolute).startsWith('vrcx-store-validation-'));
        await rm(absolute, { recursive: true, force: true });
    }
});

test('version bumps keep approved old hashes, and explicit releases list can revoke them', async () => {
    const fixture = await mkdtemp(path.join(os.tmpdir(), 'vrcx-store-validation-'));
    try {
        await cp(path.join(root, 'plugins'), path.join(fixture, 'plugins'), { recursive: true });
        await mkdir(path.join(fixture, '.github'), { recursive: true });
        await cp(path.join(root, '.github/scripts'), path.join(fixture, '.github/scripts'), { recursive: true });
        await cp(path.join(root, 'index.json'), path.join(fixture, 'index.json'));
        const indexPath = path.join(fixture, 'index.json');
        const manifestPath = path.join(fixture, 'plugins/user-status-stats/manifest.json');
        const before = JSON.parse(await readFile(indexPath, 'utf8')).plugins[0];
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        const version = manifest.version.split('.').map(Number);
        version[2] += 1;
        manifest.version = version.join('.');
        await writeFile(manifestPath, JSON.stringify(manifest));
        await appendFile(path.join(fixture, 'plugins/user-status-stats/index.js'), '\n// reviewed new release\n');
        const generate = () => spawnSync(process.execPath, [path.join(fixture, '.github/scripts/store-index.mjs')], { encoding: 'utf8' });
        const updated = generate();
        assert.equal(updated.status, 0, updated.stderr);
        const after = JSON.parse(await readFile(indexPath, 'utf8')).plugins[0];
        assert.deepEqual(after.releases, [
            ...(before.releases ?? []).filter((release) => release.version !== before.version),
            { version: before.version, entry: before.entry, sha256: before.sha256, permissions: before.permissions }
        ]);
        assert.notEqual(after.sha256, before.sha256);
        manifest.releases = [];
        await writeFile(manifestPath, JSON.stringify(manifest));
        const revoked = generate();
        assert.equal(revoked.status, 0, revoked.stderr);
        assert.equal(JSON.parse(await readFile(indexPath, 'utf8')).plugins[0].releases, undefined);
    } finally {
        const absolute = path.resolve(fixture);
        assert.ok(absolute.startsWith(path.resolve(os.tmpdir()) + path.sep));
        assert.ok(path.basename(absolute).startsWith('vrcx-store-validation-'));
        await rm(absolute, { recursive: true, force: true });
    }
});
