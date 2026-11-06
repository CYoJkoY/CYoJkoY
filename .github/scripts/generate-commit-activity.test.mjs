import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { contributionLevel, contributionThresholds, renderCalendar, validateCalendar } from './generate-commit-activity.mjs';

const run = promisify(execFile);
const script = fileURLToPath(new URL('./generate-commit-activity.mjs', import.meta.url));

function makeCalendar(start = '2025-01-05', weekCount = 53) {
  const startDate = new Date(start + 'T00:00:00Z');
  const weeks = Array.from({ length: weekCount }, (_, weekIndex) => ({
    contributionDays: Array.from({ length: 7 }, (_, weekday) => {
      const date = new Date(startDate.getTime() + (weekIndex * 7 + weekday) * 86400000);
      return {
        contributionCount: (weekIndex * 3 + weekday * 5) % 12,
        date: date.toISOString().slice(0, 10),
        weekday
      };
    })
  }));
  const totalContributions = weeks.flatMap((week) => week.contributionDays)
    .reduce((sum, day) => sum + day.contributionCount, 0);
  return { totalContributions, weeks };
}

test('renders complete accessible activity cells with a date range and reduced motion', () => {
  const svg = renderCalendar(makeCalendar());
  assert.match(svg, /<title id="title">[\d,]+ GitHub contributions from 2025-01-05 to 2026-01-10<\/title>/);
  assert.match(svg, /<desc id="desc">[^<]+<\/desc>/);
  assert.match(svg, /class="day level-4"/);
  assert.match(svg, /@keyframes wash-drift/);
  assert.match(svg, /CONTRIBUTION ACTIVITY/);
  assert.doesNotMatch(svg, /pulsar|radar|beacon|glaze/i);
  assert.equal((svg.match(/class="day level-[0-4]"/g) ?? []).length, 371);
});

test('renders a static variant without animation for reduced-motion readers', () => {
  const svg = renderCalendar(makeCalendar(), { animate: false });
  assert.doesNotMatch(svg, /@keyframes|animation:/);
  assert.match(svg, /\.wash\{opacity:0\}/);
  assert.equal((svg.match(/class="day level-[0-4]"/g) ?? []).length, 371);
  const readme = readFile(new URL('../../README.md', import.meta.url), 'utf8');
  return readme.then((text) => {
    assert.match(text, /<source media="\(prefers-reduced-motion: reduce\)" srcset="\.\/assets\/commit-activity-static\.svg" \/>/);
    assert.match(text, /<img src="\.\/assets\/commit-activity\.svg" alt="GitHub contribution calendar for the past year"/);
  });
});

test('aligns weekday labels and keeps month labels on one row without duplicates', () => {
  const svg = renderCalendar(makeCalendar());
  const weekdayLabels = [...svg.matchAll(/<g class="weekday">([\s\S]*?)<\/g>/g)][0][1];
  assert.deepEqual([...weekdayLabels.matchAll(/<text x="24" y="(\d+)">([MWF])<\/text>/g)]
    .map((match) => [match[2], Number(match[1])]), [['M', 161], ['W', 193], ['F', 225]]);
  const monthLabels = [...svg.matchAll(/<text x="(\d+)" y="120" class="month">([A-Z][a-z]{2})<\/text>/g)]
    .map((match) => [Number(match[1]), match[2]]);
  assert.equal(new Set(monthLabels.map(([x]) => x)).size, monthLabels.length);
  assert.deepEqual(monthLabels.map(([, month]) => month).slice(0, 3), ['Jan', 'Feb', 'Mar']);
  assert.ok(monthLabels.every(([x]) => x + 22 <= 940));
});

test('places the footer rule and legend below every daily cell', () => {
  const svg = renderCalendar(makeCalendar());
  const lowestCell = Math.max(...[...svg.matchAll(/<rect class="day level-[0-4]" x="\d+" y="(\d+)"/g)]
    .map((match) => Number(match[1])));
  assert.equal(lowestCell, 232);
  assert.match(svg, /<path d="M24 264H\d+" stroke="#3B3935"\/>/);
  assert.match(svg, /y="276" width="12" height="12"/);
  assert.match(svg, /<path class="accent" d="M24 12H88"\/>/);
  assert.match(svg, /<text class="caption" x="24" y="90">contributions over the past year<\/text>/);
});

test('keeps the moving wash behind the contribution cells', () => {
  const svg = renderCalendar(makeCalendar());
  assert.ok(svg.indexOf('class="wash"') < svg.indexOf('<g id="days">'));
});

test('spreads warm ink levels across the actual contribution distribution', () => {
  const days = [1, 1, 2, 3, 4, 5, 8, 12, 20, 40, 90, 488]
    .map((count, index) => ({ contributionCount: count, date: '2025-01-' + String(index + 1).padStart(2, '0') }));
  const thresholds = contributionThresholds(days);
  assert.deepEqual(thresholds, [2, 5, 20]);
  assert.deepEqual([0, 1, 2, 3, 5, 8, 20, 21].map((count) => contributionLevel(count, thresholds)),
    [0, 1, 1, 2, 2, 3, 3, 4]);
  assert.deepEqual(contributionThresholds([{ contributionCount: 0 }]), [1, 1, 1]);
});

test('rejects malformed calendars before writing output', () => {
  const calendar = makeCalendar();
  calendar.totalContributions += 1;
  assert.throws(() => validateCalendar(calendar), /total does not match/);
  assert.throws(() => validateCalendar({ totalContributions: 0, weeks: [] }), /Invalid GitHub contribution calendar/);
});

test('handles 52 and 54 week calendars and a first-week month boundary', () => {
  const short = renderCalendar(makeCalendar('2025-01-05', 52));
  assert.equal((short.match(/class="day level-[0-4]"/g) ?? []).length, 364);
  assert.match(short, /viewBox="0 0 900 304"/);

  const long = renderCalendar(makeCalendar('2025-01-05', 54));
  assert.equal((long.match(/class="day level-[0-4]"/g) ?? []).length, 378);
  assert.match(long, /viewBox="0 0 932 304"/);

  const boundary = renderCalendar(makeCalendar('2025-01-26', 53));
  assert.match(boundary, /<text x="48" y="120" class="month">Feb<\/text>/);
  assert.doesNotMatch(boundary, /<text x="48" y="120" class="month">Jan<\/text>/);
});

test('renders an empty contribution year with level zero cells only', () => {
  const calendar = makeCalendar();
  calendar.totalContributions = 0;
  for (const week of calendar.weeks) {
    for (const day of week.contributionDays) day.contributionCount = 0;
  }
  const svg = renderCalendar(calendar);
  assert.match(svg, /<title id="title">0 GitHub contributions/);
  assert.equal((svg.match(/class="day level-0"/g) ?? []).length, 371);
  assert.doesNotMatch(svg, /class="day level-[1-4]"/);
});

test('places partial first and last weeks on their real weekday rows', () => {
  const start = new Date('2025-01-08T00:00:00Z');
  const days = [];
  for (let offset = 0; offset < 53 * 7 - 4; offset += 1) {
    const date = new Date(start.getTime() + offset * 86400000);
    days.push({ contributionCount: 1, date: date.toISOString().slice(0, 10), weekday: date.getUTCDay() });
  }
  const weeks = [{ contributionDays: days.slice(0, 4) }];
  for (let index = 4; index < days.length; index += 7) {
    weeks.push({ contributionDays: days.slice(index, index + 7) });
  }
  const calendar = {
    totalContributions: weeks.flatMap((week) => week.contributionDays).length,
    weeks
  };
  const svg = renderCalendar(calendar);
  const cells = [...svg.matchAll(/<rect class="day level-\d" x="(\d+)" y="(\d+)"/g)]
    .map((match) => [Number(match[1]), Number(match[2])]);
  assert.equal(weeks.length, 53);
  assert.equal(cells.length, 367);
  assert.deepEqual(cells[0], [48, 184]);
  assert.deepEqual(cells.at(-1), [48 + 52 * 16, 136 + days.at(-1).weekday * 16]);
  assert.equal(new Set(cells.map(([x, y]) => x + ':' + y)).size, cells.length);
});

test('the published asset contains a complete calendar whose counts match its total', async () => {
  const svg = await readFile(new URL('../../assets/commit-activity.svg', import.meta.url), 'utf8');
  const staticSvg = await readFile(new URL('../../assets/commit-activity-static.svg', import.meta.url), 'utf8');
  const title = svg.match(/<title id="title">([\d,]+) GitHub contributions from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})<\/title>/);
  assert.ok(title, 'published asset must expose its contribution total and date range');
  const days = [...svg.matchAll(/<title>(\d+) contributions on (\d{4}-\d{2}-\d{2})<\/title>/g)];
  const inclusiveDays = (Date.parse(title[3] + 'T00:00:00Z') - Date.parse(title[2] + 'T00:00:00Z')) / 86400000 + 1;
  assert.equal(days.length, inclusiveDays);
  assert.equal(days[0][2], title[2]);
  assert.equal(days.at(-1)[2], title[3]);
  assert.equal(days.reduce((sum, day) => sum + Number(day[1]), 0), Number(title[1].replaceAll(',', '')));
  assert.equal(new Set([...svg.matchAll(/<text x="(\d+)" y="120" class="month">/g)].map((match) => match[1])).size,
    [...svg.matchAll(/<text x="\d+" y="120" class="month">/g)].length);
  assert.equal(staticSvg.replace(/<style>[\s\S]*?<\/style>/, ''), svg.replace(/<style>[\s\S]*?<\/style>/, ''));
  assert.doesNotMatch(staticSvg, /@keyframes|animation:/);
});

test('CLI fails without a token and writes the SVG through a mocked API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-calendar-'));
  const output = join(directory, 'calendar.svg');
  const calendar = makeCalendar();
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      data: { user: { contributionsCollection: { contributionCalendar: calendar } } }
    }));
  });
  try {
    await assert.rejects(run(process.execPath, [script], {
      env: { ...process.env, GITHUB_TOKEN: '' }
    }), /GITHUB_TOKEN environment variable is required/);

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await run(process.execPath, [script], {
      env: {
        ...process.env,
        GITHUB_TOKEN: 'test-token',
        GITHUB_GRAPHQL_URL: 'http://127.0.0.1:' + port,
        GITHUB_ACTIVITY_OUTPUT: output
      }
    });
    const svg = await readFile(output, 'utf8');
    const staticSvg = await readFile(output.replace(/\.svg$/, '-static.svg'), 'utf8');
    assert.match(svg, /CONTRIBUTION ACTIVITY/);
    assert.doesNotMatch(staticSvg, /@keyframes|animation:/);
    assert.equal((svg.match(/class="day level-[0-4]"/g) ?? []).length, 371);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed API request leaves the previous graphic intact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'profile-calendar-'));
  const output = join(directory, 'calendar.svg');
  const server = createServer((request, response) => {
    response.statusCode = 503;
    response.end('unavailable');
  });
  try {
    await writeFile(output, 'previous graphic', 'utf8');
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await assert.rejects(run(process.execPath, [script], {
      env: {
        ...process.env,
        GITHUB_TOKEN: 'test-token',
        GITHUB_GRAPHQL_URL: 'http://127.0.0.1:' + port,
        GITHUB_ACTIVITY_OUTPUT: output
      }
    }), /GitHub GraphQL request failed: 503/);
    assert.equal(await readFile(output, 'utf8'), 'previous graphic');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});
