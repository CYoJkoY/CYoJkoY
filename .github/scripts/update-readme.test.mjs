import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { test } from 'node:test';

const source = (await fs.readFile(new URL('./update-readme.mjs', import.meta.url), 'utf8'))
  .replace(/^import .*;$/gm, '')
  .replace(/run\(\);\s*$/, 'globalThis.profile = { run, wrapText };');

async function fixture(t, fetcher, config = { categories: [{ name: 'Tools', repos: ['Keep'] }] }) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'profile-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, '.github'));
  await fs.mkdir(path.join(root, 'pins'));
  await fs.writeFile(path.join(root, '.github/profile-pins.json'), JSON.stringify(config));
  await fs.writeFile(path.join(root, 'README.md'), 'Intro\n<!-- REPO_LIST:START -->old<!-- REPO_LIST:END -->\nEnd');
  await fs.writeFile(path.join(root, 'pins/Stale.svg'), 'old');
  await fs.writeFile(path.join(root, 'pins/notes.txt'), 'keep');
  const context = vm.createContext({
    fs, crypto, path: { ...path, resolve: (...parts) => path.resolve(root, ...parts) },
    process: { env: {}, exit: () => { throw new Error('Sync failed'); } },
    fetch: fetcher, console: { log() {}, error() {} },
  });
  vm.runInContext(source, context);
  return { root, ...context.profile };
}

const repo = { name: 'Keep', description: 'A complete short sentence.', html_url: 'https://github.com/CYoJkoY/Keep', language: 'JavaScript' };
const success = async () => ({ ok: true, json: async () => [repo] });

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

test('configured repositories that no longer qualify leave no cards', async (t) => {
  const f = await fixture(t, async () => ({ ok: true, json: async () => [{ ...repo, archived: true }] }));
  await fs.writeFile(path.join(f.root, 'pins/Keep.svg'), 'old');
  await f.run();
  assert.deepEqual(await fs.readdir(path.join(f.root, 'pins')), ['notes.txt']);
});

test('network failure preserves previous cards and README', async (t) => {
  const f = await fixture(t, async () => ({ ok: false, status: 503, statusText: 'Unavailable' }));
  await assert.rejects(f.run(), /Sync failed/);
  assert.equal(await fs.readFile(path.join(f.root, 'pins/Stale.svg'), 'utf8'), 'old');
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /old/);
});

test('repositories beyond the first API page remain listed', async (t) => {
  let calls = 0;
  const f = await fixture(t, async () => {
    calls += 1;
    return { ok: true, json: async () => calls === 1 ? Array.from({ length: 100 }, (_, i) => ({ ...repo, name: `Other${i}` })) : [repo] };
  });
  await f.run();
  assert.equal(calls, 2);
  assert.match(await fs.readFile(path.join(f.root, 'README.md'), 'utf8'), /Keep.svg/);
});
