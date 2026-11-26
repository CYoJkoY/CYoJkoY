import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

const source = (await fs.readFile(new URL('./update-readme.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '')
  .replace(/run\(\);\s*$/, 'globalThis.profile = { run, wrapText, generateCardSvg };');

async function fixture(t, fetcher, config = { categories: [{ name: 'Tools', repos: ['Keep'] }] }, env = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.github'));
  await fs.mkdir(path.join(root, 'pins'));
  await fs.writeFile(path.join(root, '.github/profile-pins.json'), JSON.stringify(config));
  await fs.writeFile(path.join(root, 'README.md'), 'Intro\n<!-- REPO_LIST:START -->old<!-- REPO_LIST:END -->\nEnd');
  await fs.writeFile(path.join(root, 'pins/Stale.svg'), 'old');
  await fs.writeFile(path.join(root, 'pins/notes.txt'), 'keep');
  const errors = [];
  const warnings = [];
  const context = vm.createContext({
    fs, crypto, path: { ...path, resolve: (...parts) => path.resolve(root, ...parts) },
    process: { env: { ...env }, exit: () => { throw new Error('Sync failed'); } },
    fetch: fetcher,
    console: {
      log() {},
      warn: (...args) => warnings.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
    },
  });
  vm.runInContext(source, context);
  return { root, errors, warnings, ...context.profile };
}

const repo = { name: 'Keep', description: 'A complete short sentence.', html_url: 'https://github.com/CYoJkoY/Keep', language: 'JavaScript' };
const success = async () => ({ ok: true, json: async () => [repo] });
const reply = (body) => ({ ok: true, json: async () => body });
const notFound = { ok: false, status: 404, statusText: 'Not Found' };

// Mirrors the three endpoints the generator may call: the owned listing, the
// collaboration/organization listing, and a single "owner/name" lookup.
function github({ owned = [], shared = [], lookups = {} } = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.includes('type=owner')) return reply(owned);
    if (url.includes('type=member')) return reply(shared);
    const slug = url.slice(url.indexOf('/repos/') + '/repos/'.length).toLowerCase();
    if (Object.hasOwn(lookups, slug)) {
      return lookups[slug] === null ? notFound : reply(lookups[slug]);
    }
    return notFound;
  };
  return { fetcher, calls };
}

// GitHub resolves repository paths case-insensitively, so compare the requests
// against the path only, ignoring the casing used in a pin.
function lookupCalls(api, slug) {
  const expected = `/repos/${slug.toLowerCase()}`;
  return api.calls.filter((url) => new URL(url).pathname.toLowerCase() === expected);
}

const collaboration = {
  name: 'SharedProject',
  description: 'A project maintained with another account.',
  html_url: 'https://github.com/partner/SharedProject',
  language: 'GDScript',
  owner: { login: 'partner' },
};

test('sync replaces stale SVGs while preserving other files and README prose', async (t) => {
  const f = await fixture(t, success);
  await f.run();
  assert.deepEqual((await fs.readdir(path.join(f.root, 'pins'))).sort(), ['Keep.svg', 'notes.txt']);
  const readme = await fs.readFile(path.join(f.root, 'README.md'), 'utf8');
  assert.match(readme, /^Intro/);
  assert.match(readme, /End$/);
  assert.match(readme, /Keep.svg\?v=/);
  const svg = await fs.readFile(path.join(f.root, 'pins/Keep.svg'), 'utf8');
  assert.match(svg, /A complete short sentence\.<\/text>/);
  assert.match(svg, /#1B1C20/);
});

test('explicit pins generate cards for public forks and archived repositories', async (t) => {
  for (const flags of [{ fork: true }, { archived: true }, { fork: true, archived: true }]) {
    await t.test(JSON.stringify(flags), async (t) => {
      const f = await fixture(t, async () => ({ ok: true, json: async () => [{ ...repo, ...flags }] }),
        { categories: [{ name: 'Tools', repos: [{ name: 'keep', desc: 'Explicit description.' }] }] });
      await f.run();
      assert.match(await fs.readFile(path.join(f.root, 'pins/Keep.svg'), 'utf8'), /Explicit description/);
      assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /Keep.svg\?v=/);
    });
  }
});

test('unavailable configured pins fail with names and preserve all published files', async (t) => {
  for (const unavailable of [[], [{ ...repo, name: 'Missing', private: true }]]) {
    await t.test(JSON.stringify(unavailable), async (t) => {
      const f = await fixture(t, async () => ({ ok: true, json: async () => [repo, ...unavailable] }),
        { categories: [{ name: 'Tools', repos: ['Keep', { name: 'Missing' }] }] });
      await assert.rejects(f.run(), /Sync failed/);
      assert.match(f.errors.join('\n'), /Configured repositories.*Missing/);
      assert.equal(await fs.readFile(path.join(f.root, 'pins/Stale.svg'), 'utf8'), 'old');
      assert.deepEqual((await fs.readdir(path.join(f.root, 'pins'))).sort(), ['Stale.svg', 'notes.txt']);
      assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /START -->old<!-- REPO_LIST:END/);
    });
  }
});

test('network failure preserves previous cards and README', async (t) => {
  const f = await fixture(t, async () => ({ ok: false, status: 503, statusText: 'Unavailable' }));
  await assert.rejects(f.run(), /Sync failed/);
  assert.equal(await fs.readFile(path.join(f.root, 'pins/Stale.svg'), 'utf8'), 'old');
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /old/);
});

test('repositories beyond the first API page remain listed', async (t) => {
  const calls = [];
  const f = await fixture(t, async (url) => {
    calls.push(url);
    if (url.includes('type=owner') && new URL(url).searchParams.get('page') === '1') {
      return reply(Array.from({ length: 100 }, (_, i) => ({ ...repo, name: `Other${i}` })));
    }
    return reply([repo]);
  });
  await f.run();
  assert.equal(calls.filter((url) => url.includes('type=owner')).length, 2);
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /Keep.svg/);
});

test('collaboration repositories resolve by bare name with an owner-scoped card file', async (t) => {
  const api = github({ owned: [repo], shared: [collaboration] });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: [{ name: 'sharedproject', desc: 'Pinned by name.' }] }] });
  await f.run();

  assert.deepEqual((await fs.readdir(path.join(f.root, 'pins'))).sort(), ['notes.txt', 'partner--SharedProject.svg']);
  const readme = await fs.readFile(path.join(f.root, 'README.md'), 'utf8');
  assert.match(readme, /href="https:\/\/github\.com\/partner\/SharedProject"/);
  assert.match(readme, /src="\.\/pins\/partner--SharedProject\.svg\?v=/);
  assert.match(readme, /alt="SharedProject"/);
  const svg = await fs.readFile(path.join(f.root, 'pins/partner--SharedProject.svg'), 'utf8');
  assert.match(svg, /Pinned by name\.<\/text>/);
});

test('pins written as owner/name resolve through the repository API', async (t) => {
  const api = github({ owned: [repo], lookups: { 'partner/sharedproject': collaboration } });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['Keep', 'Partner/SharedProject'] }] });
  await f.run();

  assert.equal(lookupCalls(api, 'partner/sharedproject').length, 1);
  const readme = await fs.readFile(path.join(f.root, 'README.md'), 'utf8');
  assert.match(readme, /partner--SharedProject\.svg\?v=/);
  assert.match(readme, /Keep\.svg\?v=/);
});

test('pins already present in the listings never hit the single-repository API', async (t) => {
  const api = github({ owned: [repo], shared: [collaboration] });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['Keep', 'partner/SharedProject'] }] });
  await f.run();
  assert.deepEqual(lookupCalls(api, 'partner/sharedproject'), []);
});

test('an owned repository wins over a namesake from another account', async (t) => {
  const api = github({ owned: [repo], shared: [{ ...collaboration, name: 'Keep', html_url: 'https://github.com/partner/Keep' }] });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['Keep'] }] });
  await f.run();

  assert.deepEqual((await fs.readdir(path.join(f.root, 'pins'))).sort(), ['Keep.svg', 'notes.txt']);
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /href="https:\/\/github\.com\/CYoJkoY\/Keep"/);
});

test('a bare name shared by several unowned repositories fails with both candidates', async (t) => {
  const api = github({
    shared: [
      { ...collaboration, name: 'Twin' },
      { ...collaboration, name: 'Twin', owner: { login: 'other' }, html_url: 'https://github.com/other/Twin' },
    ],
  });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['Twin'] }] });
  await assert.rejects(f.run(), /Sync failed/);
  assert.match(f.errors.join('\n'), /ambiguous.*partner\/Twin.*other\/Twin/);
  assert.equal(await fs.readFile(path.join(f.root, 'pins/Stale.svg'), 'utf8'), 'old');
});

test('an unowned bare name that is not discoverable asks for owner/name', async (t) => {
  const api = github({ owned: [repo] });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['NotMine'] }] });
  await assert.rejects(f.run(), /Sync failed/);
  assert.match(f.errors.join('\n'), /NotMine \(not found in the public repositories of CYoJkoY, pin it as "owner\/name"\)/);
});

test('unreachable owner/name pins keep published files and explain the failure', async (t) => {
  const api = github({ owned: [repo], lookups: { 'partner/missing': null } });
  const f = await fixture(t, api.fetcher, { categories: [{ name: 'Tools', repos: ['Partner/Missing'] }] });
  await assert.rejects(f.run(), /Sync failed/);
  assert.match(f.errors.join('\n'), /Partner\/Missing \(not found or not reachable\)/);
  assert.deepEqual((await fs.readdir(path.join(f.root, 'pins'))).sort(), ['Stale.svg', 'notes.txt']);
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /START -->old<!-- REPO_LIST:END/);
});

test('an unreachable collaboration listing degrades to owned repositories', async (t) => {
  const f = await fixture(t, async (url) => {
    if (url.includes('type=member')) return { ok: false, status: 403, statusText: 'Forbidden' };
    return reply([repo]);
  });
  await f.run();
  assert.match(f.warnings.join('\n'), /collaboration and organization repositories/);
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /Keep\.svg\?v=/);
});

test('language dots use distinct brand colors for common repository languages', async (t) => {
  const f = await fixture(t, success);
  const typescript = f.generateCardSvg({ ...repo, language: 'TypeScript' });
  const javascript = f.generateCardSvg({ ...repo, language: 'JavaScript' });
  const dotColor = (svg) => svg.match(/<circle cx="5" cy="8" r="5" fill="(#[0-9a-f]+)"/)[1];
  assert.equal(dotColor(typescript), '#5b9ce6');
  assert.equal(dotColor(javascript), '#f1e05a');
  assert.notEqual(dotColor(typescript), dotColor(javascript));
});
