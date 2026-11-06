import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./verify-profile-freshness.mjs', import.meta.url));

test('accepts published data at or newer than the generated calendar end date', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-freshness-'));
  const published = join(directory, 'published.svg');
  const generated = join(directory, 'generated.svg');
  const svg = (end) => '<svg><title id="title">1 GitHub contributions from 2025-11-02 to ' + end + '</title></svg>';
  try {
    await writeFile(published, svg('2026-11-07'));
    await writeFile(generated, svg('2026-11-07'));
    await run(process.execPath, [script, published, generated]);
    await writeFile(published, svg('2026-11-08'));
    await run(process.execPath, [script, published, generated]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects stale or malformed published contribution calendars', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-freshness-'));
  const published = join(directory, 'published.svg');
  const generated = join(directory, 'generated.svg');
  try {
    await writeFile(published, '<svg><title id="title">1 GitHub contributions from 2025-11-02 to 2026-11-06</title></svg>');
    await writeFile(generated, '<svg><title id="title">1 GitHub contributions from 2025-11-02 to 2026-11-07</title></svg>');
    await assert.rejects(run(process.execPath, [script, published, generated]), /ends before the latest generated data/);
    await writeFile(published, '<svg>invalid</svg>');
    await assert.rejects(run(process.execPath, [script, published, generated]), /valid contribution date range/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
