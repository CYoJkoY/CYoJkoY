import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = new URL('../../', import.meta.url);
const DEFAULT_CALENDAR = new URL('assets/commit-activity.svg', ROOT);
const DEFAULT_OUTPUT = new URL('assets/activity-details.svg', ROOT);
const CONFIG = new URL('.github/profile-pins.json', ROOT);
const OWNER = process.env.GITHUB_REPOSITORY_OWNER ?? 'CYoJkoY';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (character) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'
  })[character]);
}

function truncate(value, maxLength) {
  const characters = Array.from(value);
  if (characters.length <= maxLength) return value;
  return characters.slice(0, maxLength - 1).join('').trimEnd() + '…';
}

export function summarizeCalendar(svg) {
  const header = svg.match(/<title id="title">([\d,]+) GitHub contributions from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})<\/title>/);
  if (!header) throw new Error('Contribution calendar has no valid total and date range.');
  const days = [...svg.matchAll(/<title>(\d+) contributions on (\d{4}-\d{2}-\d{2})<\/title>/g)]
    .map((match) => ({ count: Number(match[1]), date: match[2] }));
  const start = Date.parse(header[2] + 'T00:00:00Z');
  const end = Date.parse(header[3] + 'T00:00:00Z');
  const expectedDays = (end - start) / 86400000 + 1;
  if (!Number.isInteger(expectedDays) || expectedDays < 1 || days.length !== expectedDays ||
      days[0]?.date !== header[2] || days.at(-1)?.date !== header[3]) {
    throw new Error('Contribution calendar daily counts do not match its date range.');
  }
  if (days.some((day, index) => day.date !== new Date(start + index * 86400000).toISOString().slice(0, 10))) {
    throw new Error('Contribution calendar dates must be consecutive.');
  }
  const total = days.reduce((sum, day) => sum + day.count, 0);
  if (total !== Number(header[1].replaceAll(',', ''))) {
    throw new Error('Contribution calendar daily counts do not match its total.');
  }
  const activeDays = days.filter((day) => day.count > 0).length;
  let longestStreak = 0;
  let currentStreak = 0;
  for (const day of days) {
    currentStreak = day.count > 0 ? currentStreak + 1 : 0;
    longestStreak = Math.max(longestStreak, currentStreak);
  }
  const busiest = days.reduce((best, day) => day.count > best.count ? day : best, days[0]);
  return {
    total,
    startDate: header[2],
    endDate: header[3],
    activeDays,
    longestStreak,
    busiest,
    averagePerActiveDay: activeDays === 0 ? 0 : total / activeDays
  };
}

export function validateCommits(commits) {
  if (!Array.isArray(commits)) throw new Error('GitHub commits response must be an array.');
  return commits.map((commit) => {
    const repository = commit.repository;
    const message = commit.commit?.message?.split('\n')[0];
    const date = commit.commit?.committer?.date ?? commit.commit?.author?.date;
    if (typeof repository !== 'string' || !/^[A-Za-z0-9_.-]+$/.test(repository) ||
        typeof message !== 'string' || typeof date !== 'string' ||
        !Number.isFinite(Date.parse(date)) || typeof commit.sha !== 'string' || !/^[a-f0-9]{7,40}$/i.test(commit.sha)) {
      throw new Error('GitHub returned an invalid commit record for ' + String(repository) + '.');
    }
    return { repository, message: message || '(no commit message)', date, sha: commit.sha.slice(0, 7) };
  }).sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
}

function monthDay(date) {
  const [, month, day] = date.split('-').map(Number);
  return MONTHS[month - 1] + ' ' + day;
}

export function renderActivityDetails(calendar, commits) {
  const rows = commits.slice(0, 5);
  const rowMarkup = rows.map((commit, index) => {
    const y = 64 + index * 36;
    const repoUrl = 'https://github.com/' + encodeURIComponent(OWNER) + '/' + encodeURIComponent(commit.repository);
    const commitUrl = repoUrl + '/commit/' + encodeURIComponent(commit.sha);
    return '<circle cx="32" cy="' + (y - 4) + '" r="2.5" fill="#C84A3B" fill-opacity=".85"/>' +
      '<text x="48" y="' + y + '" class="row-date">' + escapeXml(commit.date.slice(0, 10)) + '</text>' +
      '<a href="' + commitUrl + '"><text x="146" y="' + y + '" class="row-repo">' +
      escapeXml(truncate(commit.repository, 27)) + '</text></a>' +
      '<text x="380" y="' + y + '" class="row-message">' + escapeXml(truncate(commit.message, 70)) + '</text>';
  }).join('\n');
  const stats = [
    { value: String(calendar.activeDays), label: 'ACTIVE DAYS' },
    { value: calendar.longestStreak + ' days', label: 'LONGEST STREAK' },
    { value: String(calendar.busiest.count), label: 'PEAK CONTRIBUTIONS · ' + monthDay(calendar.busiest.date) },
    { value: calendar.averagePerActiveDay.toFixed(1), label: 'CONTRIB. / ACTIVE DAY' }
  ];
  const statsMarkup = stats.map((stat, index) => {
    const x = 24 + index * 222;
    return '<text x="' + x + '" y="352" class="stat">' + escapeXml(stat.value) + '</text>' +
      '<text x="' + x + '" y="378" class="stat-label">' + escapeXml(stat.label) + '</text>';
  }).join('\n');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="915" height="420" viewBox="0 0 915 420" ' +
    'role="img" aria-labelledby="title desc">\n' +
    '<title id="title">Recent commits and contribution statistics</title>\n' +
    '<desc id="desc">The five latest commits by ' + escapeXml(OWNER) + ' in pinned public repositories, followed by ' +
    calendar.total.toLocaleString('en-US') + ' contributions from ' + calendar.startDate + ' to ' + calendar.endDate +
    ', across ' + calendar.activeDays + ' active days.</desc>\n' +
    '<style>text{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif}' +
    '.frame{fill:#1B1C20;stroke:#3B3935}.eyebrow{fill:#A39F95;font-size:10px;letter-spacing:2px}' +
    '.row-date{fill:#A39F95;font-size:11px}.row-repo{fill:#EDEAE2;font-size:12.5px;font-weight:600}' +
    'a{text-decoration:none}.row-message{fill:#A39F95;font-size:11px}' +
    '.stat{fill:#EDEAE2;font-family:Georgia,\'Times New Roman\',serif;font-size:26px}' +
    '.stat-label{fill:#A39F95;font-size:9.5px;letter-spacing:1.2px}</style>\n' +
    '<rect class="frame" x=".5" y=".5" width="914" height="247" rx="2"/>\n' +
    '<path d="M24 12H88" stroke="#C84A3B" stroke-width="2"/>\n' +
    '<text class="eyebrow" x="24" y="30">LATEST WORK</text>\n' +
    '<path d="M32 54V208" stroke="#3B3935"/>\n' + rowMarkup + '\n' +
    '<rect class="frame" x=".5" y="264.5" width="914" height="155" rx="2"/>\n' +
    '<path d="M24 276H88" stroke="#C84A3B" stroke-width="2"/>\n' +
    '<text class="eyebrow" x="24" y="296">THIS YEAR IN NUMBERS</text>\n' + statsMarkup + '\n</svg>\n';
}

async function requestJson(url, token) {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'CYoJkoY-Profile' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('GitHub API request failed: ' + response.status + ' ' + response.statusText +
    ' (' + url + '): ' + (await response.text()).slice(0, 300));
  return response.json();
}

export async function fetchRecentCommits(repositories, { owner = OWNER, token = '', apiUrl = 'https://api.github.com' } = {}) {
  const batches = await Promise.all(repositories.map(async (repository) => {
    const url = new URL('/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repository) + '/commits', apiUrl);
    url.searchParams.set('author', owner);
    url.searchParams.set('per_page', '10');
    const payload = await requestJson(url, token);
    if (!Array.isArray(payload)) throw new Error('GitHub commits response must be an array for ' + repository + '.');
    return payload.map((commit) => ({ ...commit, repository }));
  }));
  return validateCommits(batches.flat()).slice(0, 5);
}

export async function generate() {
  const calendarPath = process.env.GITHUB_ACTIVITY_CALENDAR
    ? pathToFileURL(resolve(process.env.GITHUB_ACTIVITY_CALENDAR))
    : DEFAULT_CALENDAR;
  const output = process.env.GITHUB_ACTIVITY_DETAILS_OUTPUT
    ? pathToFileURL(resolve(process.env.GITHUB_ACTIVITY_DETAILS_OUTPUT))
    : DEFAULT_OUTPUT;
  const calendar = summarizeCalendar(await readFile(calendarPath, 'utf8'));
  const config = JSON.parse(await readFile(CONFIG, 'utf8'));
  const repositories = (config.categories ?? []).flatMap((category) => category.repos ?? [])
    .map((entry) => typeof entry === 'string' ? entry : entry.name)
    .filter((name) => typeof name === 'string');
  if (repositories.length === 0) throw new Error('No pinned public repositories are configured.');
  const commits = await fetchRecentCommits(repositories, {
    token: process.env.GITHUB_TOKEN ?? '',
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com'
  });
  const svg = renderActivityDetails(calendar, commits);
  const temporary = new URL(output.href + '.tmp');
  try {
    await writeFile(temporary, svg, 'utf8');
    await rename(temporary, output);
  } finally {
    await rm(temporary, { force: true });
  }
  return svg;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  generate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
