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

// --- 色彩自适应校准管线 ---

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
    if (hsl.l < 50) hsl.l = Math.min(75, Math.max(58, hsl.l + 25));
  } else {
    if (hsl.l > 55) hsl.l = Math.max(30, Math.min(45, hsl.l - 20));
  }

  return hslToHex(hsl.h, hsl.s, hsl.l);
}

// --- 数据获取与增量缓存管线 ---

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
        langCounts: Object.fromEntries(
          Array.from(langStats.entries()).map(([k, v]) => [k, { count: v.count, color: v.apiColor }])
        ),
      });
    }

    await saveCache(
      cacheMap,
      weekWindows.map((w) => w.key)
    );
  }

  const weeklyMeta = weekWindows.map(
    (w) => cacheMap.get(w.key) || { dominantLanguage: null, apiReportedColor: null }
  );

  const annualTotals = new Map();
  let totalLangCommits = 0;

  weekWindows.forEach((w) => {
    const entry = cacheMap.get(w.key);
    if (entry?.langCounts) {
      for (const [lang, info] of Object.entries(entry.langCounts)) {
        const cur = annualTotals.get(lang) || { count: 0, apiColor: info.color };
        cur.count += info.count;
        totalLangCommits += info.count;
        if (info.color) cur.apiColor = info.color;
        annualTotals.set(lang, cur);
      }
    } else if (entry?.dominantLanguage) {
      const cur = annualTotals.get(entry.dominantLanguage) || { count: 0, apiColor: entry.apiReportedColor };
      cur.count += 1;
      totalLangCommits += 1;
      annualTotals.set(entry.dominantLanguage, cur);
    }
  });

  const top5Languages = Array.from(annualTotals.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, info]) => {
      const pct = totalLangCommits > 0 
        ? ((info.count / totalLangCommits) * 100).toFixed(1) 
        : '0.0';
      return {
        name,
        count: info.count,
        percent: pct,
        apiColor: info.apiColor,
      };
    });

  return { weeklyMeta, top5Languages };
}

// --- 几何与信号波形算法 ---

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
    const amp = d.contributionCount > 0 ? Math.min(46, Math.pow(d.contributionCount, 0.6) * 11 + 6) : 0;
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

// --- 动态 SVG 渲染器 ---

function buildConsoleSvg(calendar, languageData, theme) {
  const width = 860;
  const height = 660;
  const topPad = 140; // 抬升首行基线至 140px，为顶部与第一周预留绝对开阔防区
  const bottomPad = 86;
  const leftMargin = 120;
  const chartWidth = 620;

  const sweepPeriod = 6.0;
  const sweepTravelTime = 5.2;
  const sweepDistance = 740;
  const sweepStartX = leftMargin - 50;

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0d1117' : '#ffffff';
  const borderColor = isDark ? '#30363d' : '#d0d7de';
  const strokeColor = isDark ? '#f0f6fc' : '#1f2328';
  const axisColor = isDark ? '#8b949e' : '#656d76';
  const gridDim = isDark ? '#21262d' : '#eaeef2';
  const accentColor = isDark ? '#2f81f7' : '#0969da';
  const beamTailColor = isDark ? '#58a6ff' : '#0969da';
  const otherSegmentColor = isDark ? '#30363d' : '#d0d7de';

  const weeks = calendar.weeks.slice(-46);
  const langMeta = languageData.weeklyMeta.slice(-46);
  const top5Languages = languageData.top5Languages;
  const verticalStep = (height - topPad - bottomPad) / (weeks.length - 1);

  let maxDayCommit = 0;
  let peakPoint = { x: 0, y: 0, date: '', count: 0 };
  let firstDate = '';
  let lastDate = '';

  weeks.forEach((w, weekIdx) => {
    const baseY = topPad + weekIdx * verticalStep;
    w.contributionDays.forEach((d) => {
      if (!firstDate && d.date) firstDate = d.date;
      if (d.date) lastDate = d.date;
      if (d.contributionCount > maxDayCommit) {
        maxDayCommit = d.contributionCount;
        const rawX = leftMargin + (d.weekday / 6) * chartWidth;
        const amp = Math.min(46, Math.pow(d.contributionCount, 0.6) * 11 + 6);
        const rawY = baseY - amp;

        // 准星绝对安全内缩：X 轴不低于 130px，Y 轴不高于 98px
        const safeX = Math.max(leftMargin + 10, Math.min(width - 90, rawX));
        const safeY = Math.max(98, Math.min(height - bottomPad - 20, rawY));

        peakPoint = {
          x: safeX,
          y: safeY,
          date: d.date,
          count: d.contributionCount,
        };
      }
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
        <stop offset="0%" stop-color="${hex}" stop-opacity="${isDark ? 0.42 : 0.28}" />
        <stop offset="60%" stop-color="${hex}" stop-opacity="${isDark ? 0.14 : 0.09}" />
        <stop offset="100%" stop-color="${bgColor}" stop-opacity="0.95" />
      </linearGradient>`;
  }

  gradientDefs += `
    <linearGradient id="laser-beam-${theme}" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="${beamTailColor}" stop-opacity="0" />
      <stop offset="60%" stop-color="${beamTailColor}" stop-opacity="${isDark ? 0.15 : 0.10}" />
      <stop offset="96%" stop-color="${beamTailColor}" stop-opacity="${isDark ? 0.50 : 0.38}" />
      <stop offset="100%" stop-color="#ffffff" stop-opacity="${isDark ? 0.95 : 0.85}" />
    </linearGradient>
  `;

  let gridLines = '';
  [1, 3, 5].forEach((wDay) => {
    const gx = leftMargin + (wDay / 6) * chartWidth;
    gridLines += `<line x1="${gx}" y1="${topPad - 55}" x2="${gx}" y2="${height - bottomPad + 10}" stroke="${gridDim}" stroke-dasharray="2 4" stroke-width="1" />`;
  });

  let paths = '';
  let monthLabels = '';
  let prevMonth = -1;
  let flareNodes = '';

  weeks.forEach((week, i) => {
    const baseY = topPad + i * verticalStep;
    const points = calculateRidgePoints(week.contributionDays, i, width, leftMargin, chartWidth, baseY);
    const meta = langMeta[i];
    const dominantHex = meta.dominantLanguage ? usedLangs.get(meta.dominantLanguage) || accentColor : accentColor;

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

    week.contributionDays.forEach((day) => {
      if (day.contributionCount > 0) {
        const peakX = leftMargin + (day.weekday / 6) * chartWidth;
        const amp = Math.min(46, Math.pow(day.contributionCount, 0.6) * 11 + 6);
        const peakY = baseY - amp;

        const arrivalProgress = Math.max(0, Math.min(1, (peakX - sweepStartX) / sweepDistance));
        const triggerDelay = (arrivalProgress * sweepTravelTime).toFixed(2);

        if (day.contributionCount >= 8) {
          flareNodes += `
          <g transform="translate(${peakX.toFixed(1)}, ${peakY.toFixed(1)})">
            <g class="flare-major" style="animation-delay: ${triggerDelay}s;">
              <circle cx="0" cy="0" r="10" fill="${dominantHex}" opacity="0.3" class="flare-ring" />
              <line x1="-7" y1="0" x2="7" y2="0" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
              <line x1="0" y1="-7" x2="0" y2="7" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round" />
              <circle cx="0" cy="0" r="2.5" fill="#ffffff" />
            </g>
          </g>`;
        } else {
          flareNodes += `
          <g transform="translate(${peakX.toFixed(1)}, ${peakY.toFixed(1)})">
            <g class="flare-minor" style="animation-delay: ${triggerDelay}s;">
              <circle cx="0" cy="0" r="6" fill="${dominantHex}" opacity="0.45" />
              <circle cx="0" cy="0" r="2" fill="#ffffff" />
            </g>
          </g>`;
        }
      }
    });

    const firstValidDay = week.contributionDays.find((d) => d.date);
    if (firstValidDay) {
      const m = new Date(firstValidDay.date).getUTCMonth();
      if (m !== prevMonth) {
        monthLabels += `
        <text x="${leftMargin - 28}" y="${baseY.toFixed(1)}" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" text-anchor="end" letter-spacing="0.08em">${MONTH_NAMES[m]}</text>
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
      <text x="${wx}" y="${height - bottomPad + 36}" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="10" font-weight="600" fill="${axisColor}" text-anchor="middle" letter-spacing="0.1em">${name}</text>
    `;
  });

  // Top 5 语言图例
  let langLegendItems = '';
  let curLegX = 0;
  top5Languages.forEach((item) => {
    const hex = resolveLanguageColor(item.name, item.apiColor, theme);
    const textStr = `${item.name} ${item.percent}%`;
    langLegendItems += `
      <circle cx="${curLegX + 4}" cy="4" r="3.5" fill="${hex}" />
      <text x="${curLegX + 13}" y="4" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}">
        ${item.name} <tspan fill="${strokeColor}" font-weight="600" opacity="0.9">${item.percent}%</tspan>
      </text>
    `;
    curLegX += 13 + textStr.length * 5.8 + 14;
  });

  // 底部 2px 堆叠进度条 (带 1px 底色微缝)
  const barWidth = width - 72;
  const barHeight = 2;
  const gap = 1;

  const segments = [];
  let totalTop5Pct = 0;
  top5Languages.forEach((item) => {
    const pct = parseFloat(item.percent) || 0;
    if (pct > 0) {
      totalTop5Pct += pct;
      segments.push({
        name: item.name,
        pct,
        color: resolveLanguageColor(item.name, item.apiColor, theme),
      });
    }
  });

  const remainingPct = Math.max(0, 100 - totalTop5Pct);
  if (remainingPct > 0.05) {
    segments.push({
      name: 'Other',
      pct: remainingPct,
      color: otherSegmentColor,
    });
  }

  const totalGaps = Math.max(0, segments.length - 1) * gap;
  const usableWidth = barWidth - totalGaps;
  let barSegments = '';
  let curBarX = 0;

  segments.forEach((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const segWidth = isLast
      ? Math.max(1, barWidth - curBarX)
      : Math.max(1, (seg.pct / 100) * usableWidth);

    barSegments += `<rect x="${curBarX.toFixed(2)}" y="0" width="${segWidth.toFixed(2)}" height="${barHeight}" fill="${seg.color}" />`;
    curBarX += segWidth + gap;
  });

  // 准星物理定位与渲染：容器分层彻底杜绝 transform 属性被 CSS 重写归零
  let peakMarker = '';
  if (peakPoint.x > 0 && peakPoint.y > 0) {
    const targetX = peakPoint.x;
    const targetY = peakPoint.y;

    // 智能朝内避让：靠左强制向右，靠右强制向左
    const isNearRight = targetX > width - 160;
    const isNearLeft = targetX < leftMargin + 80;
    const textAnchor = isNearRight ? 'end' : 'start';
    const textOffsetX = isNearRight ? -14 : 14;

    // 垂直避让：靠顶强制向下展开标签，远离头部 HUD
    const isNearTop = targetY < 120;
    const textOffsetY = isNearTop ? 16 : -12;

    peakMarker = `
    <!-- 物理位移外层容器 (严禁挂载包含 transform 的 CSS 动画) -->
    <g transform="translate(${targetX.toFixed(1)}, ${targetY.toFixed(1)})">
      <!-- 视效内层容器 (纯 opacity 呼吸，零位移干扰) -->
      <g class="peak-hud-inner">
        <circle cx="0" cy="0" r="4.5" fill="none" stroke="${accentColor}" stroke-width="1.2" class="target-spin" stroke-dasharray="3 3" />
        <circle cx="0" cy="0" r="1.5" fill="${accentColor}" />
        <line x1="0" y1="-8" x2="0" y2="-5" stroke="${accentColor}" stroke-width="1.2" />
        <line x1="0" y1="5" x2="0" y2="8" stroke="${accentColor}" stroke-width="1.2" />
        <line x1="-8" y1="0" x2="-5" y2="0" stroke="${accentColor}" stroke-width="1.2" />
        <line x1="5" y1="0" x2="8" y2="0" stroke="${accentColor}" stroke-width="1.2" />
        <text x="${textOffsetX}" y="${textOffsetY}" dominant-baseline="central" text-anchor="${textAnchor}" font-family="ui-monospace, monospace" font-size="8.5" font-weight="700" fill="${accentColor}" letter-spacing="0.06em">PEAK // +${peakPoint.count}</text>
      </g>
    </g>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto">
  <defs>
    ${gradientDefs}
    <clipPath id="chart-viewport">
      <rect x="${leftMargin - 15}" y="${topPad - 55}" width="${chartWidth + 30}" height="${height - (topPad - 55) - bottomPad + 15}" />
    </clipPath>
    <clipPath id="bar-clip-${theme}">
      <rect x="0" y="0" width="${barWidth}" height="${barHeight}" rx="1" />
    </clipPath>
  </defs>

  <style>
    /* 1. 信标原点声呐波纹硬件加速动画 */
    @keyframes beaconPulse {
      0% { transform: scale(0.6); opacity: 0.9; stroke-width: 1.5px; }
      65% { transform: scale(2.6); opacity: 0.15; stroke-width: 0.8px; }
      100% { transform: scale(3.4); opacity: 0; stroke-width: 0.2px; }
    }
    @keyframes coreBlink {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.8); }
    }
    .beacon-core {
      transform-box: fill-box;
      transform-origin: center;
      animation: coreBlink 2.2s ease-in-out infinite;
    }
    .beacon-wave {
      transform-origin: 0px 0px;
      animation: beaconPulse 2.2s cubic-bezier(0.1, 0.7, 0.3, 1) infinite;
    }

    /* 2. 匀速扫频光刃 */
    @keyframes radarSweepLinear {
      0% { transform: translateX(0px); opacity: 0; }
      3% { opacity: 0.95; }
      83.3% { transform: translateX(${sweepDistance}px); opacity: 0.95; }
      86.6% { transform: translateX(${sweepDistance}px); opacity: 0; }
      100% { transform: translateX(0px); opacity: 0; }
    }
    .sweep-blade {
      animation: radarSweepLinear ${sweepPeriod}s linear infinite;
    }

    /* 3. 荧光爆发动效 */
    @keyframes phosphorExplodeMajor {
      0% { opacity: 0; transform: scale(0.3); }
      3% { opacity: 1; transform: scale(1.4); }
      15% { opacity: 0.75; transform: scale(1.0); }
      35% { opacity: 0; transform: scale(0.6); }
      100% { opacity: 0; transform: scale(0.3); }
    }
    @keyframes phosphorExplodeMinor {
      0% { opacity: 0; transform: scale(0.2); }
      3% { opacity: 1; transform: scale(1.3); }
      20% { opacity: 0.5; transform: scale(0.9); }
      32% { opacity: 0; transform: scale(0.4); }
      100% { opacity: 0; transform: scale(0.2); }
    }
    .flare-major {
      opacity: 0;
      transform-origin: 0px 0px;
      animation: phosphorExplodeMajor ${sweepPeriod}s cubic-bezier(0.1, 0.9, 0.2, 1) infinite;
    }
    .flare-minor {
      opacity: 0;
      transform-origin: 0px 0px;
      animation: phosphorExplodeMinor ${sweepPeriod}s cubic-bezier(0.1, 0.9, 0.2, 1) infinite;
    }

    /* 4. 十字准星与微动 (使用纯透明度呼吸，杜绝坐标矩阵位移污染) */
    @keyframes targetRotate {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes peakBreathe {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    .target-spin {
      transform-origin: 0px 0px;
      animation: targetRotate 8s linear infinite;
    }
    .peak-hud-inner {
      animation: peakBreathe 2.6s ease-in-out infinite;
    }
  </style>

  <rect width="${width}" height="${height}" rx="6" fill="${bgColor}" stroke="${borderColor}" stroke-width="1" />
  
  <!-- 1. 头部 HUD -->
  <g transform="translate(36, 38)">
    <g transform="translate(8, 8)">
      <circle cx="0" cy="0" r="4" fill="${accentColor}" class="beacon-core" />
      <circle cx="0" cy="0" r="4" fill="none" stroke="${accentColor}" class="beacon-wave" />
    </g>
    <text x="28" y="7" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="11" font-weight="600" fill="${strokeColor}" letter-spacing="0.14em">ANNUAL CODE TELEMETRY // LIVE</text>
    <text x="28" y="24" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.08em">WINDOW: ${firstDate} — ${lastDate}</text>
  </g>

  <g transform="translate(${width - 36}, 38)" text-anchor="end">
    <text x="0" y="7" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="11" font-weight="700" fill="${strokeColor}" letter-spacing="0.1em">${calendar.totalContributions.toLocaleString()} COMMITS</text>
    <text x="0" y="24" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.08em">MAX FLUX: ${maxDayCommit} COMMITS / DAY</text>
  </g>

  <!-- 2. 网格与时间坐标轴 -->
  ${gridLines}
  ${monthLabels}

  <!-- 3. 山脊波形 -->
  ${paths}

  <!-- 4. 波峰十字准星标记 (分层隔离且安全内缩) -->
  ${peakMarker}

  <!-- 5. 波峰瞬时时空激荡层 -->
  ${flareNodes}

  <!-- 6. 示波器雷达光束扫频 -->
  <g clip-path="url(#chart-viewport)">
    <g class="sweep-blade" transform="translate(${sweepStartX - 70}, 0)">
      <rect x="0" y="${topPad - 55}" width="70" height="${height - (topPad - 55) - bottomPad + 30}" fill="url(#laser-beam-${theme})" />
      <line x1="70" y1="${topPad - 55}" x2="70" y2="${height - bottomPad + 15}" stroke="#ffffff" stroke-width="1.3" opacity="${isDark ? 0.95 : 0.8}" />
    </g>
  </g>

  <!-- 7. 底部 X 轴刻度 -->
  <line x1="${leftMargin}" y1="${height - bottomPad + 16}" x2="${leftMargin + chartWidth}" y2="${height - bottomPad + 16}" stroke="${borderColor}" stroke-width="1" />
  ${weekdayLabels}

  <!-- 8. 底部 Top 5 语言图例 -->
  <g transform="translate(36, ${height - 30})">
    ${langLegendItems}
  </g>
  <g transform="translate(${width - 36}, ${height - 30})" text-anchor="end">
    <text x="0" y="4" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="9" fill="${axisColor}" letter-spacing="0.06em">▲ PEAK HEIGHT ∝ COMMIT DENSITY</text>
  </g>

  <!-- 9. 底部 2px 堆叠进度导轨 (带 1px 细微缝隙) -->
  <g transform="translate(36, ${height - 14})" clip-path="url(#bar-clip-${theme})">
    ${barSegments}
  </g>
</svg>`;
}

async function run() {
  try {
    await fs.mkdir(DIST_DIR, { recursive: true });

    const calendar = await fetchCalendar(USERNAME, TOKEN);
    const languageData = await resolveDominantLanguages(USERNAME, TOKEN, calendar.weeks);

    const darkSvg = buildConsoleSvg(calendar, languageData, 'dark');
    const lightSvg = buildConsoleSvg(calendar, languageData, 'light');

    await fs.writeFile(path.join(DIST_DIR, 'pulsar-dark.svg'), darkSvg, 'utf-8');
    await fs.writeFile(path.join(DIST_DIR, 'pulsar-light.svg'), lightSvg, 'utf-8');

    console.log('[Pulsar Dynamic] Peak marker decoupled & safe-clamped console SVGs generated successfully in dist/');
  } catch (err) {
    console.error('[Pulsar Fatal Error]', err);
    process.exit(1);
  }
}

run();
