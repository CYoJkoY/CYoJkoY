import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fetchRecentCommits, renderActivityDetails, summarizeCalendar, validateCommits } from './generate-activity-details.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./generate-activity-details.mjs', import.meta.url));

function makeCalendar(counts = [0, 2, 3, 0, 5, 1, 0]) {
  const start = new Date('2026-01-01T00:00:00Z');
  const days = counts.map((count, index) => {
    const date = new Date(start.getTime() + index * 86400000).toISOString().slice(0, 10);
    return { count, date };
  });
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const dailyTitles = days.map((day) => '<title>' + day.count + ' contributions on ' + day.date + '</title>').join('');
  return '<title id="title">' + total + ' GitHub contributions from ' + days[0].date + ' to ' + days.at(-1).date +
    '</title>' + dailyTitles;
}

function makeCommit(repository, day, message = 'feat: add feature', sha = 'abcdef1234567') {
  return {
    repository,
    sha,
    commit: { author: { date: '2026-01-' + String(day).padStart(2, '0') + 'T12:00:00Z' }, message }
  };
}

test('summarizes daily contributions and rejects inconsistent calendars', () => {
  const summary = summarizeCalendar(makeCalendar());
  assert.equal(summary.total, 11);
  assert.equal(summary.activeDays, 4);
  assert.equal(summary.longestStreak, 2);
  assert.deepEqual(summary.busiest, { count: 5, date: '2026-01-05' });
  assert.equal(summary.averagePerActiveDay, 2.75);
  assert.throws(() => summarizeCalendar(makeCalendar().replace('<title>0 contributions on 2026-01-07</title>', '')),
    /do not match its date range/);
});

test('renders accessible recent commit rows, safe XML text, and four yearly metrics', () => {
  const calendar = summarizeCalendar(makeCalendar());
  const commits = validateCommits([
    makeCommit('SampleRepo', 7, 'fix: <unsafe> & stable'),
    makeCommit('OlderRepo', 2)
  ]);
  const svg = renderActivityDetails(calendar, commits);
  assert.match(svg, /aria-labelledby="title desc"/);
  assert.match(svg, /fix: &lt;unsafe&gt; &amp; stable/);
  assert.match(svg, /href="https:\/\/github.com\/CYoJkoY\/SampleRepo\/commit\/abcdef1"/);
  assert.match(svg, />4<\/text>/);
  assert.match(svg, />2 days<\/text>/);
  assert.match(svg, /PEAK CONTRIBUTIONS · Jan 5/);
  assert.match(svg, />2\.8<\/text>/);
  assert.equal((svg.match(/class="row-date"/g) ?? []).length, 2);
});

test('validates API commit records and sorts them newest first', () => {
  const sorted = validateCommits([makeCommit('OlderRepo', 2), makeCommit('NewerRepo', 7)]);
  assert.deepEqual(sorted.map((commit) => commit.repository), ['NewerRepo', 'OlderRepo']);
  assert.throws(() => validateCommits([{ repository: '../bad', sha: 'bad', commit: {} }]), /invalid commit record/);
});

test('fetches owner-authored commits from each repository and keeps the newest five', async () => {
  const seen = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    seen.push(url);
    const repository = url.pathname.split('/').at(-2);
    response.setHeader('Content-Type', 'application/json');
    const dayOffset = repository === 'RepoA' ? 0 : 1;
    response.end(JSON.stringify(Array.from({ length: 6 }, (_, index) =>
      makeCommit(repository, index + 1 + dayOffset))));
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const commits = await fetchRecentCommits(['RepoA', 'RepoB'], {
      owner: 'Owner', apiUrl: 'http://127.0.0.1:' + server.address().port
    });
    assert.equal(commits.length, 5);
    assert.deepEqual(commits.map((commit) => commit.repository), ['RepoB', 'RepoA', 'RepoB', 'RepoA', 'RepoB']);
    assert.ok(seen.every((url) => url.searchParams.get('author') === 'Owner' && url.searchParams.get('per_page') === '10'));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('the README publishes the generated detail asset', async () => {
  const [readme, svg] = await Promise.all([
    readFile(new URL('../../README.md', import.meta.url), 'utf8'),
    readFile(new URL('../../assets/activity-details.svg', import.meta.url), 'utf8')
  ]);
  assert.match(readme, /<img src="\.\/assets\/activity-details\.svg" alt="Recent commits and yearly contribution statistics"/);
  assert.match(svg, /<title id="title">Recent commits and contribution statistics<\/title>/);
  assert.equal((svg.match(/class="row-date"/g) ?? []).length, 5);
});

test('a failed API request leaves the previous detail graphic intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-details-'));
  const output = join(directory, 'details.svg');
  const calendarPath = join(directory, 'calendar.svg');
  const server = createServer((request, response) => {
    response.statusCode = 503;
    response.end('unavailable');
  });
  try {
    await writeFile(output, 'previous graphic', 'utf8');
    await writeFile(calendarPath, makeCalendar(), 'utf8');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    await assert.rejects(run(process.execPath, [script], {
      env: {
        ...process.env,
        GITHUB_ACTIVITY_CALENDAR: calendarPath,
        GITHUB_ACTIVITY_DETAILS_OUTPUT: output,
        GITHUB_API_URL: 'http://127.0.0.1:' + server.address().port,
        GITHUB_REPOSITORY_OWNER: 'CYoJkoY'
      }
    }), (error) => /GitHub API request failed: 503/.test(error.stdout + error.stderr));
    assert.equal(await readFile(output, 'utf8'), 'previous graphic');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
