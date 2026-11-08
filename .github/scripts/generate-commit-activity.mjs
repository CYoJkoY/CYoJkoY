import { rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const OUTPUT = new URL('../../assets/commit-activity.svg', import.meta.url);
const STATIC_OUTPUT = new URL('../../assets/commit-activity-static.svg', import.meta.url);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function validateCalendar(calendar) {
  if (!calendar || !Number.isSafeInteger(calendar.totalContributions) || calendar.totalContributions < 0 ||
      !Array.isArray(calendar.weeks) || calendar.weeks.length === 0 || calendar.weeks.length > 54) {
    throw new Error('Invalid GitHub contribution calendar.');
  }
  let previousDate = null;
  let total = 0;
  calendar.weeks.forEach((week, weekIndex) => {
    if (!Array.isArray(week.contributionDays) || week.contributionDays.length === 0 || week.contributionDays.length > 7) {
      throw new Error('Invalid GitHub contribution week.');
    }
    week.contributionDays.forEach((day, dayIndex) => {
      if (typeof day.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day.date) ||
          !Number.isSafeInteger(day.contributionCount) || day.contributionCount < 0) {
        throw new Error('Invalid GitHub contribution day.');
      }
      const date = new Date(day.date + 'T00:00:00Z');
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== day.date ||
          day.weekday !== date.getUTCDay() ||
          (previousDate !== null && date.getTime() - previousDate !== 86400000) ||
          (weekIndex > 0 && dayIndex === 0 && day.weekday !== 0)) {
        throw new Error('Contribution dates must be consecutive and aligned to weekdays.');
      }
      previousDate = date.getTime();
      total += day.contributionCount;
    });
  });
  if (total !== calendar.totalContributions) {
    throw new Error('Contribution total does not match the sum of daily counts.');
  }
}

export function contributionThresholds(days) {
  const positive = days.map((day) => day.contributionCount).filter((count) => count > 0)
    .sort((left, right) => left - right);
  if (positive.length === 0) return [1, 1, 1];
  const at = (fraction) => positive[Math.min(positive.length - 1, Math.ceil(fraction * positive.length) - 1)];
  return [at(0.25), at(0.5), at(0.75)];
}

export function contributionLevel(count, thresholds) {
  if (count === 0) return 0;
  if (count <= thresholds[0]) return 1;
  if (count <= thresholds[1]) return 2;
  if (count <= thresholds[2]) return 3;
  return 4;
}

function normalizeCalendar(calendar) {
  const totalContributions = calendar.weeks
    .flatMap((week) => week.contributionDays)
    .reduce((total, day) => total + day.contributionCount, 0);
  return { ...calendar, totalContributions };
}

export function renderCalendar(calendar, { animate = true } = {}) {
  validateCalendar(calendar);
  const { weeks } = calendar;
  const days = weeks.flatMap((week) => week.contributionDays);
  const range = days[0].date + ' to ' + days.at(-1).date;
  const number = calendar.totalContributions.toLocaleString('en-US');
  const cell = 12;
  const pitch = 16;
  const left = 48;
  const top = 136;
  const chartWidth = weeks.length * pitch - 4;
  const width = Math.max(640, left + chartWidth + 24);
  const height = 304;
  const chartHeight = 7 * pitch - 4;
  const thresholds = contributionThresholds(days);
  const cells = [];
  const startMonth = days[0].date.slice(0, 7);
  const firstWeekHasNewMonth = weeks[0].contributionDays
    .some((day) => day.date.endsWith('-01') && day.date.slice(0, 7) !== startMonth);
  const months = firstWeekHasNewMonth ? [] : ['<text x="' + left + '" y="120" class="month">' +
    MONTHS[Number(startMonth.slice(5)) - 1] + '</text>'];
  let previousMonth = startMonth;
  let lastMonthX = firstWeekHasNewMonth ? -Infinity : left;
  weeks.forEach((week, weekIndex) => {
    const x = left + weekIndex * pitch;
    const firstOfMonth = week.contributionDays
      .find((day) => day.date.slice(0, 7) !== previousMonth && day.date.endsWith('-01'));
    if (firstOfMonth && x + 22 <= width - 12 && x - lastMonthX >= 40) {
      months.push('<text x="' + x + '" y="120" class="month">' +
        MONTHS[Number(firstOfMonth.date.slice(5, 7)) - 1] + '</text>');
      lastMonthX = x;
    }
    previousMonth = week.contributionDays.at(-1).date.slice(0, 7);
    for (const day of week.contributionDays) {
      const level = contributionLevel(day.contributionCount, thresholds);
      cells.push('<rect class="day level-' + level + '" x="' + x + '" y="' + (top + day.weekday * pitch) +
        '" width="' + cell + '" height="' + cell + '" rx="2"><title>' + day.contributionCount +
        ' contributions on ' + day.date + '</title></rect>');
    }
  });
  const weekdays = [['M', 1], ['W', 3], ['F', 5]].map((entry) =>
    '<text x="24" y="' + (top + entry[1] * pitch + 9) + '">' + entry[0] + '</text>').join('');
  const legendX = width - 190;
  const legend = Array.from({ length: 5 }, (_, level) =>
    '<rect class="level-' + level + '" x="' + (legendX + 30 + level * 16) + '" y="276" width="12" height="12" rx="2"/>'
  ).join('');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height +
    '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="title desc">\n' +
    '<title id="title">' + number + ' GitHub contributions from ' + range + '</title>\n' +
    '<desc id="desc">Daily GitHub contributions, including commits, issues, pull requests and reviews. ' +
    'Columns are weeks and rows run Sunday to Saturday. Activity increases from dark ink to warm ochre.</desc>\n' +
    '<style>text{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif}' +
    '.frame{fill:#1B1C20;stroke:#3B3935}.eyebrow{fill:#A39F95;font-size:10px;letter-spacing:2px}' +
    '.total{fill:#EDEAE2;font-family:Georgia,\'Times New Roman\',serif;font-size:28px}' +
    '.caption,.month{fill:#A39F95;font-size:11px}.weekday{fill:#A39F95;font-size:10px}' +
    '.level-0{fill:#292824}.level-1{fill:#5E5147}.level-2{fill:#89715B}.level-3{fill:#B28A65}.level-4{fill:#D0A27A}' +
    '.accent{stroke:#C84A3B;stroke-width:2}.wash{opacity:0}' +
    (animate
      ? '.wash{animation:wash-drift 36s cubic-bezier(.45,0,.55,1) infinite}' +
        '@keyframes wash-drift{0%,6%{transform:translateX(-180px);opacity:0}' +
        '46%,54%{opacity:.85}94%,100%{transform:translateX(' + chartWidth + 'px);opacity:0}}'
      : '') +
    '</style>\n' +
    '<defs><linearGradient id="wash"><stop stop-color="#D0A27A" stop-opacity="0"/>' +
    '<stop offset=".5" stop-color="#D0A27A" stop-opacity=".16"/>' +
    '<stop offset="1" stop-color="#D0A27A" stop-opacity="0"/></linearGradient>' +
    '<clipPath id="calendar"><rect x="' + left + '" y="' + top + '" width="' + chartWidth +
    '" height="' + chartHeight + '"/></clipPath></defs>\n' +
    '<rect class="frame" x=".5" y=".5" width="' + (width - 1) + '" height="' + (height - 1) + '" rx="2"/>\n' +
    '<path class="accent" d="M24 12H88"/>\n' +
    '<text class="eyebrow" x="24" y="28">CONTRIBUTION ACTIVITY</text>\n' +
    '<text class="total" x="24" y="64">' + number + '</text>\n' +
    '<text class="caption" x="24" y="90">contributions over the past year</text>\n' +
    months.join('') + '\n' +
    '<g clip-path="url(#calendar)"><rect class="wash" x="' + left + '" y="' + top +
    '" width="180" height="' + chartHeight + '" fill="url(#wash)"/></g>\n' +
    '<g class="weekday">' + weekdays + '</g>\n' +
    '<g id="days">' + cells.join('') + '</g>\n' +
    '<path d="M24 264H' + (width - 24) + '" stroke="#3B3935"/>\n' +
    '<text class="caption" x="24" y="288">' + range + '</text>\n' +
    '<g class="caption"><text x="' + legendX + '" y="286">Less</text>' + legend +
    '<text x="' + (width - 72) + '" y="286">More</text></g>\n' +
    '</svg>\n';
}

export async function generate() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN environment variable is required.');
  const username = process.env.GITHUB_REPOSITORY_OWNER ?? 'CYoJkoY';
  const endpoint = process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql';
  const output = process.env.GITHUB_ACTIVITY_OUTPUT
    ? pathToFileURL(resolve(process.env.GITHUB_ACTIVITY_OUTPUT))
    : OUTPUT;
  const staticOutput = new URL(output.href.replace(/(\.svg)?$/, '-static.svg'));
  const query = 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{' +
    'totalContributions weeks{contributionDays{contributionCount date weekday}}}}}}';
  const response = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(30000),
    headers: {
      Authorization: 'bearer ' + token,
      'Content-Type': 'application/json',
      'User-Agent': 'CYoJkoY-Profile'
    },
    body: JSON.stringify({ query, variables: { login: username } })
  });
  if (!response.ok) {
    throw new Error('GitHub GraphQL request failed: ' + response.status + ' ' + response.statusText);
  }
  const payload = await response.json();
  if (payload.errors?.length) {
    throw new Error('GitHub GraphQL errors: ' + JSON.stringify(payload.errors));
  }
  const calendar = payload.data?.user?.contributionsCollection?.contributionCalendar;
  const normalizedCalendar = normalizeCalendar(calendar);
  const svg = renderCalendar(normalizedCalendar);
  const staticSvg = renderCalendar(normalizedCalendar, { animate: false });
  const temporary = new URL(output.href + '.tmp');
  const staticTemporary = new URL(staticOutput.href + '.tmp');
  try {
    await writeFile(temporary, svg, 'utf8');
    await writeFile(staticTemporary, staticSvg, 'utf8');
    await rename(temporary, output);
    await rename(staticTemporary, staticOutput);
  } finally {
    await rm(temporary, { force: true });
    await rm(staticTemporary, { force: true });
  }
  return svg;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  generate().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
