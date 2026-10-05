import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const safePath = (value) => typeof value === 'string' && /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_.-]+$/.test(value)
    && !value.split('/').some((part) => part === '.' || part === '..');
const permissions = new Set(['feed.read', 'friends.read', 'user.read', 'userDialog.modify', 'settings.create', 'storage', 'notifications']);
const validPermissions = (value) => Array.isArray(value) && new Set(value).size === value.length && value.every((permission) => permissions.has(permission));
const versionParts = (value) => /^\d+\.\d+\.\d+$/.test(value) ? value.split('.').map(BigInt) : null;
const compareVersion = (a, b) => {
    const left = versionParts(a);
    const right = versionParts(b);
    if (!left || !right) throw new Error('Invalid release version');
    for (let part = 0; part < 3; part += 1) {
        if (left[part] !== right[part]) return left[part] > right[part] ? 1 : -1;
    }
    return 0;
};

function validateReleases(value, id) {
    if (!Array.isArray(value) || value.length > 20) throw new Error('Historical release limit is 20');
    const seen = new Set();
    return value.map((release) => {
        if (!release || !versionParts(release.version) || !safePath(release.entry)
            || !release.entry.startsWith(`plugins/${id}/`) || !release.entry.endsWith('.js')
            || !/^[a-f0-9]{64}$/.test(release.sha256) || !validPermissions(release.permissions)
            || seen.has(release.version)) throw new Error(`Invalid historical release: ${id}`);
        seen.add(release.version);
        return { version: release.version, entry: release.entry, sha256: release.sha256, permissions: release.permissions };
    });
}

async function filesUnder(directory) {
    const result = [];
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) throw new Error(`Symlinks are not store files: ${entry.name}`);
        if (entry.isDirectory()) result.push(...await filesUnder(path.join(directory, entry.name)));
        else if (entry.isFile()) result.push(path.join(directory, entry.name));
    }
    return result;
}

async function build() {
    const plugins = [];
    let previous = { plugins: [] };
    try {
        previous = JSON.parse(await readFile(path.join(root, 'index.json'), 'utf8'));
        if (previous.schemaVersion !== 1 || !Array.isArray(previous.plugins)) throw new Error('Invalid previous catalog');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    for (const folder of (await readdir(path.join(root, 'plugins'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
        if (!folder.isDirectory()) continue;
        const prefix = `plugins/${folder.name}/`;
        const manifest = JSON.parse(await readFile(path.join(root, prefix, 'manifest.json'), 'utf8'));
        if (manifest.id !== folder.name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) throw new Error('Invalid plugin ID');
        if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error(`Invalid version: ${manifest.id}`);
        if (!safePath(manifest.entry) || !safePath(manifest.icon)) throw new Error(`Invalid path: ${manifest.id}`);
        if (!validPermissions(manifest.permissions)) throw new Error('Unknown or duplicate permission');
        for (const key of ['name', 'author', 'description', 'updatedAt']) if (typeof manifest[key] !== 'string' || !manifest[key].trim()) throw new Error(`Missing ${key}`);
        const files = {};
        for (const filename of await filesUnder(path.join(root, prefix))) {
            files[path.relative(root, filename).replaceAll('\\', '/')] = hash(await readFile(filename));
        }
        const entry = prefix + manifest.entry;
        const icon = prefix + manifest.icon;
        if (!files[entry] || !files[icon]) throw new Error(`Missing entry/icon: ${manifest.id}`);
        const prior = previous.plugins.find((plugin) => plugin.id === manifest.id);
        let releases;
        if (Object.hasOwn(manifest, 'releases')) {
            // An explicit maintainer list permits revocation, including [].
            releases = validateReleases(manifest.releases, manifest.id);
        } else {
            releases = validateReleases(prior?.releases ?? [], manifest.id);
            if (prior && compareVersion(manifest.version, prior.version) > 0) {
                releases = validateReleases([...releases.filter((release) => release.version !== prior.version), {
                    version: prior.version, entry: prior.entry, sha256: prior.sha256, permissions: prior.permissions
                }], manifest.id);
            }
        }
        if (prior && compareVersion(manifest.version, prior.version) === 0
            && (prior.sha256 !== files[entry] || prior.entry !== entry
                || JSON.stringify(prior.permissions) !== JSON.stringify(manifest.permissions))) {
            throw new Error(`Plugin content/permissions changed without a version bump: ${manifest.id}`);
        }
        plugins.push({
            id: manifest.id,
            name: manifest.name,
            version: manifest.version,
            author: manifest.author,
            description: manifest.description,
            updatedAt: manifest.updatedAt,
            apiVersion: manifest.apiVersion,
            entry,
            manifest: prefix + 'manifest.json',
            sha256: files[entry],
            icon,
            permissions: manifest.permissions,
            files,
            ...(releases.length ? { releases } : {})
        });
    }
    return JSON.stringify({ schemaVersion: 1, plugins }, null, 2) + '\n';
}

const expected = await build();
if (process.argv.includes('--check')) {
    const actual = await readFile(path.join(root, 'index.json'), 'utf8');
    if (actual !== expected) throw new Error('index.json differs from plugin metadata/content. Run npm run index and review the diff.');
    console.log('Official store index and SHA-256 hashes validated.');
} else {
    await writeFile(path.join(root, 'index.json'), expected);
    console.log('Generated official store index with SHA-256 hashes for every file.');
}
