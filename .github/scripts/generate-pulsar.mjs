import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'CYoJkoY';
const TOKEN = process.env.GITHUB_TOKEN || '';
const DIST_DIR = path.resolve('dist');
const CACHE_DIR = path.resolve('.cache/pulsar');
const CACHE_FILE = path.join(CACHE_DIR, 'weekly-languages.json');

if (!TOKEN) {
  console.error('[Pulsar] Error: GITHUB_TOKEN environment variable is required.');
  process.exit(1);
}

const MONTH_NAMES = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

const BRAND_OVERRIDES = {
  TypeScript: '#3178c6',
  AutoHotkey: '#6594b9',
  GDScript: '#355570',
};

function hexToHsl(hex) {
  let c = hex.replace(/^#/, '');
  if (c.length === 3) c = c.split('').map((x) => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function generateDeterministicHsl(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash |= 0;
  }
  const h = Math.abs(hash) % 360;
  return { h, s: 72, l: 50 };
}

function resolveLanguageColor(langName, apiReportedColor, theme = 'dark') {
  if (!langName) return theme === 'dark' ? '#8b949e' : '#656d76';

  const rawHex = BRAND_OVERRIDES[langName] || apiReportedColor;
  let hsl = rawHex && /^#[0-9a-fA-F]{6}$/i.test(rawHex)
    ? hexToHsl(rawHex)
    : generateDeterministicHsl(langName);

  if (theme === 'dark') {
    if (hsl.l < 50) {
      hsl.l = Math.min(75, Math.max(58, hsl.l + 25));
    }
  } else {
    if (hsl.l > 55) {
      hsl.l = Math.max(30, Math.min(45, hsl.l - 20));
    }
  }

  return hslToHex(hsl.h, hsl.s, hsl.l);
}

async function fetchCalendar(username, token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
                weekday
              }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Node-Pulsar-Console',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!res.ok) throw new Error(`GraphQL API failed: ${res.status} ${res.statusText}`);
  const payload = await res.json();
  if (payload.errors) throw new Error(`GraphQL Errors: ${JSON.stringify(payload.errors)}`);
  return payload.data.user.contributionsCollection.contributionCalendar;
}

async function loadCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch {
    return new Map();
  }
}

async function saveCache(cacheMap, validKeys) {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const pruned = {};
  for (const key of validKeys) {
    if (cacheMap.has(key)) pruned[key] = cacheMap.get(key);
  }
  await fs.writeFile(CACHE_FILE, JSON.stringify(pruned, null, 2), 'utf-8');
}

async function fetchLanguagesForWindows(username, token, windows) {
  if (windows.length === 0) return {};

  const aliasFields = windows
    .map(
      (w) => `
      w_${w.key}: contributionsCollection(from: "${w.from}", to: "${w.to}") {
        commitContributionsByRepository(maxRepositories: 25) {
          repository {
            name
            primaryLanguage {
              name
              color
            }
          }
          contributions {
            totalCount
          }
        }
      }
    `
    )
    .join('\n');

  const query = `
    query($login: String!) {
      user(login: $login) {
        ${aliasFields}
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'Node-Pulsar-Console',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!res.ok) throw new Error(`GraphQL API failed: ${res.status} ${res.statusText}`);
  const payload = await res.json();
  if (payload.errors) throw new Error(`GraphQL Errors: ${JSON.stringify(payload.errors)}`);
  return payload.data.user;
}

async function resolveDominantLanguages(username, token, weeks) {
  const cacheMap = await loadCache();
  const now = Date.now();

  const weekWindows = weeks.map((w) => {
    const days = w.contributionDays;
    const fromDate = days[0].date;
    const toDate = days[days.length - 1].date;
    const key = `${fromDate}_${toDate}`.replace(/-/g, '');
    const isPastWeek = new Date(`${toDate}T23:59:59Z`).getTime() < now;

    return {
      key,
      from: `${fromDate}T00:00:00Z`,
      to: `${toDate}T23:59:59Z`,
      isPastWeek,
    };
  });

  const needFetch = weekWindows.filter((w) => !w.isPastWeek || !cacheMap.has(w.key));

  if (needFetch.length > 0) {
    console.log(`[Pulsar Cache] Querying ${needFetch.length} uncached / active weeks via GraphQL...`);
    const rawData = await fetchLanguagesForWindows(username, token, needFetch);

    for (const w of needFetch) {
      const weekData = rawData[`w_${w.key}`];
      const repoContributions = weekData?.commitContributionsByRepository || [];
      const langStats = new Map();

      for (const item of repoContributions) {
        const lang = item.repository?.primaryLanguage?.name;
        const apiColor = item.repository?.primaryLanguage?.color;
        const count = item.contributions?.totalCount || 0;
        if (!lang || count <= 0) continue;

        const current = langStats.get(lang) || {
          name: lang,
          count: 0,
          apiColor: apiColor || null,
        };
        current.count += count;
        langStats.set(lang, current);
      }

      const sorted = Array.from(langStats.values()).sort((a, b) => b.count - a.count);
      const dominant = sorted[0] || null;

      cacheMap.set(w.key, {
        dominantLanguage: dominant ? dominant.name : null,
        apiReportedColor: dominant ? dominant.apiColor : null,
      });
    }

    await saveCache(
      cacheMap,
      weekWindows.map((w) => w.key)
    );
  }

  return weekWindows.map((w) => cacheMap.get(w.key) || { dominantLanguage: null, apiReportedColor: null });
}

function pseudoNoise(seed) {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

function calculateRidgePoints(weekDays, weekIndex, width, leftMargin, chartWidth, baseY) {
  const rightMargin = width - leftMargin - chartWidth;
  const stepX = 3;
  const sigma = 14;

  const centers = weekDays.map((d) => {
    const x = leftMargin + (d.weekday / 6) * chartWidth;
    const amp = d.contributionCount > 0 ? Math.min(68, Math.pow(d.contributionCount, 0.62) * 15 + 8) : 0;
    return { x, amp };
  });

  const points = [];
  for (let x = leftMargin - 20; x <= width - rightMargin + 20; x += stepX) {
    let edgeWindow = 1;
    const relLeft = x - leftMargin;
    const relRight = width - rightMargin - x;

    if (relLeft < 0) edgeWindow = Math.max(0, 1 + relLeft / 20);
    else if (relRight < 0) edgeWindow = Math.max(0, 1 + relRight / 20);

    let elevation = 0;
    for (const c of centers) {
      if (c.amp > 0) {
        const dx = x - c.x;
        elevation += c.amp * Math.exp(-(dx * dx) / (2 * sigma * sigma));
      }
    }

    const noiseSeed = weekIndex * 1500 + x;
    const noise = pseudoNoise(noiseSeed) * (0.8 + (elevation > 0 ? elevation * 0.08 : 0)) * edgeWindow;
    const totalLift = (elevation + noise) * edgeWindow;

    points.push({ x, y: Number((baseY - totalLift).toFixed(2)) });
  }

  return points;
}

function buildConsoleSvg(calendar, weeklyLanguages, theme) {
  const width = 860;
  const height = 640;
  const topPad = 80;
  const bottomPad = 80;
  const leftMargin = 120;
  const chartWidth = 620;

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0d1117' : '#ffffff';
  const borderColor = isDark ? '#30363d' : '#d0d7de';
  const strokeColor = isDark ? '#f0f6fc' : '#1f2328';
  const axisColor = isDark ? '#8b949e' : '#656d76';
  const gridDim = isDark ? '#21262d' : '#eaeef2';
  const accentColor = isDark ? '#2f81f7' : '#0969da';

  const weeks = calendar.weeks.slice(-46);
  const langMeta = weeklyLanguages.slice(-46);
  const verticalStep = (height - topPad - bottomPad) / (weeks.length - 1);

  let maxDayCommit = 0;
  let firstDate = '';
  let lastDate = '';

  weeks.forEach((w) => {
    w.contributionDays.forEach((d) => {
      if (!firstDate && d.date) firstDate = d.date;
      if (d.date) lastDate = d.date;
      if (d.contributionCount > maxDayCommit) maxDayCommit = d.contributionCount;
    });
  });

  const usedLangs = new Map();
  langMeta.forEach((meta) => {
    if (meta.dominantLanguage) {
      const color = resolveLanguageColor(meta.dominantLanguage, meta.apiReportedColor, theme);
      usedLangs.set(meta.dominantLanguage, color);
    }
  });

  let gradientDefs = '';
  for (const [lang, hex] of usedLangs.entries()) {
    const safeId = lang.replace(/[^a-zA-Z0-9_-]/g, '_');
    gradientDefs += `
      <linearGradient id="glow-${safeId}-${theme}" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${hex}" stop-opacity="${isDark ? 0.38 : 0.26}" />
        <stop offset="60%" stop-color="${hex}" stop-opacity="${isDark ? 0.12 : 0.08}" />
        <stop offset="100%" stop-color="${bgColor}" stop-opacity="0.95" />
      </linearGradient>`;
  }

  let gridLines = '';
  [1, 3, 5].forEach((wDay) => {
    const gx = leftMargin + (wDay / 6) * chartWidth;
    gridLines += `<line x1="${gx}" y1="${topPad - 10}" x2="${gx}" y2="${height - bottomPad + 10}" stroke="${gridDim}" stroke-dasharray="2 4" stroke-width="1" />`;
  });

  let paths = '';
  let monthLabels = '';
  let prevMonth = -1;

  weeks.forEach((week, i) => {
    const baseY = topPad + i * verticalStep;
    const points = calculateRidgePoints(week.contributionDays, i, width, leftMargin, chartWidth, baseY);
    const meta = langMeta[i];

    const lineCoords = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const fillCoords = `${lineCoords} L ${points[points.length - 1].x} ${baseY + 45} L ${points[0].x} ${baseY + 45} Z`;

    const weekHasCommits = week.contributionDays.some((d) => d.contributionCount > 0);
    const safeLangId = meta.dominantLanguage ? meta.dominantLanguage.replace(/[^a-zA-Z0-9_-]/g, '_') : null;
    const fillStyle = weekHasCommits && safeLangId
      ? `url(#glow-${safeLangId}-${theme})`
      : bgColor;

    paths += `
    <g class="wave-row">
      <path d="${fillCoords}" fill="${fillStyle}" stroke="none" />
      <path d="${lineCoords}" fill="none" stroke="${strokeColor}" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round" />
    </g>`;

    const firstValidDay = week.contributionDays.find((d) => d.date);
    if (firstValidDay) {
      const m = new Date(firstValidDay.date).getUTCMonth();
      if (m !== prevMonth) {
        monthLabels += `
        <text x="${leftMargin - 28}" y="${(baseY + 3.5).toFixed(1)}" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" text-anchor="end" letter-spacing="0.08em">${MONTH_NAMES[m]}</text>
        <line x1="${leftMargin - 18}" y1="${baseY.toFixed(1)}" x2="${leftMargin - 8}" y2="${baseY.toFixed(1)}" stroke="${borderColor}" stroke-width="1" />`;
        prevMonth = m;
      }
    }
  });

  let weekdayLabels = '';
  WEEKDAYS.forEach((name, idx) => {
    const wx = leftMargin + (idx / 6) * chartWidth;
    weekdayLabels += `
      <line x1="${wx}" y1="${height - bottomPad + 16}" x2="${wx}" y2="${height - bottomPad + 22}" stroke="${borderColor}" stroke-width="1" />
      <text x="${wx}" y="${height - bottomPad + 36}" font-family="ui-monospace, monospace" font-size="10" font-weight="600" fill="${axisColor}" text-anchor="middle" letter-spacing="0.1em">${name}</text>
    `;
  });

  let langLegendItems = '';
  let curLegX = 0;
  for (const [lang, hex] of usedLangs.entries()) {
    langLegendItems += `
      <circle cx="${curLegX + 4}" cy="4" r="3.5" fill="${hex}" />
      <text x="${curLegX + 13}" y="7.5" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}">${lang}</text>
    `;
    curLegX += 18 + lang.length * 6.5 + 14;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto">
  <defs>
    ${gradientDefs}
  </defs>
  <rect width="${width}" height="${height}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="1" />
  
  <!-- 1. Header Telemetry HUD -->
  <g transform="translate(32, 34)">
    <circle cx="5" cy="5" r="4" fill="${accentColor}" />
    <text x="18" y="9" font-family="ui-monospace, monospace" font-size="11" font-weight="600" fill="${strokeColor}" letter-spacing="0.14em">ANNUAL CODE TELEMETRY</text>
    <text x="18" y="24" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.08em">WINDOW: ${firstDate} — ${lastDate}</text>
  </g>

  <g transform="translate(${width - 32}, 34)" text-anchor="end">
    <text x="0" y="9" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="${strokeColor}" letter-spacing="0.1em">${calendar.totalContributions.toLocaleString()} COMMITS</text>
    <text x="0" y="24" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.08em">MAX FLUX: ${maxDayCommit} COMMITS / DAY</text>
  </g>

  <!-- 2. Subtle Grid & Time Axes -->
  ${gridLines}
  ${monthLabels}

  <!-- 3. Waveform Ridges -->
  ${paths}

  <!-- 4. Bottom X-Axis -->
  <line x1="${leftMargin}" y1="${height - bottomPad + 16}" x2="${leftMargin + chartWidth}" y2="${height - bottomPad + 16}" stroke="${borderColor}" stroke-width="1" />
  ${weekdayLabels}

  <!-- 5. Bottom Legend Key -->
  <g transform="translate(32, ${height - 24})">
    ${langLegendItems}
  </g>
  <g transform="translate(${width - 32}, ${height - 24})" text-anchor="end">
    <text x="0" y="7" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.06em">▲ PEAK HEIGHT ∝ COMMIT DENSITY</text>
  </g>
</svg>`;
}

async function run() {
  try {
    await fs.mkdir(DIST_DIR, { recursive: true });

    const calendar = await fetchCalendar(USERNAME, TOKEN);
    const weeklyLanguages = await resolveDominantLanguages(USERNAME, TOKEN, calendar.weeks);

    const darkSvg = buildConsoleSvg(calendar, weeklyLanguages, 'dark');
    const lightSvg = buildConsoleSvg(calendar, weeklyLanguages, 'light');

    await fs.writeFile(path.join(DIST_DIR, 'pulsar-dark.svg'), darkSvg, 'utf-8');
    await fs.writeFile(path.join(DIST_DIR, 'pulsar-light.svg'), lightSvg, 'utf-8');

    console.log('[Pulsar] Telemetry console SVGs generated successfully in dist/');
  } catch (err) {
    console.error('[Pulsar Fatal Error]', err);
    process.exit(1);
  }
}

run();
