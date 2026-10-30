import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'CYoJkoY';
const TOKEN = process.env.GITHUB_TOKEN || '';
const DIST_DIR = path.resolve('dist');

if (!TOKEN) {
  console.error('[Pulsar] GITHUB_TOKEN is required for GraphQL API.');
  process.exit(1);
}

// 1. 获取近 52 周贡献数据
async function fetchContributions(username, token) {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
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
      'User-Agent': 'Node-Pulsar-Generator',
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL API failed: ${res.status} ${res.statusText}`);
  }

  const payload = await res.json();
  if (payload.errors) {
    throw new Error(`GraphQL Errors: ${JSON.stringify(payload.errors)}`);
  }

  return payload.data.user.contributionsCollection.contributionCalendar.weeks;
}

// 2. 高斯核平滑计算波峰坐标
function calculateRidgePoints(weekDays, width, baseY) {
  const leftMargin = 120;
  const rightMargin = 120;
  const chartWidth = width - leftMargin - rightMargin;
  const stepX = 5;
  const sigma = 30; // 高斯波峰横向弥散范围

  // 映射每周 7 天的提交与振幅
  const centers = weekDays.map((d) => {
    const x = leftMargin + (d.weekday / 6) * chartWidth;
    const amp = d.contributionCount > 0 ? Math.min(36, 4.8 * Math.sqrt(d.contributionCount) + 2) : 0;
    return { x, amp };
  });

  const points = [];
  for (let x = 0; x <= width; x += stepX) {
    let elevation = 0;
    for (const c of centers) {
      if (c.amp > 0) {
        const dx = x - c.x;
        elevation += c.amp * Math.exp(-(dx * dx) / (2 * sigma * sigma));
      }
    }
    const y = baseY - elevation;
    points.push({ x, y: Number(y.toFixed(2)) });
  }

  return points;
}

// 3. 构建指定主题的 SVG
function buildSvg(weeks, theme) {
  const width = 850;
  const height = 620;
  const topPad = 56;
  const bottomPad = 48;

  const isDark = theme === 'dark';
  const bgColor = isDark ? '#0d1117' : '#ffffff';
  const strokeColor = isDark ? '#e6edf3' : '#1f2328';
  const metaColor = isDark ? '#7d8590' : '#656d76';

  const targetWeeks = weeks.slice(-50);
  const verticalStep = (height - topPad - bottomPad) / (targetWeeks.length - 1);

  let paths = '';

  targetWeeks.forEach((week, i) => {
    const baseY = topPad + i * verticalStep;
    const points = calculateRidgePoints(week.contributionDays, width, baseY);

    const lineCoords = points.map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    // 闭合路径用于遮挡下层线条
    const fillCoords = `${lineCoords} L ${width} ${baseY + 36} L 0 ${baseY + 36} Z`;

    paths += `
    <g class="ridge">
      <path d="${fillCoords}" fill="${bgColor}" stroke="none" />
      <path d="${lineCoords}" fill="none" stroke="${strokeColor}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round" />
    </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="auto">
  <rect width="${width}" height="${height}" rx="6" fill="${bgColor}" />
  ${paths}
  <text x="32" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', ui-monospace, monospace" font-size="11" letter-spacing="0.12em" fill="${metaColor}">PULSAR / CONTRIBUTION FLUX</text>
  <text x="${width - 130}" y="32" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', ui-monospace, monospace" font-size="11" letter-spacing="0.12em" fill="${metaColor}">50 WEEKS KDE</text>
</svg>`;
}

async function run() {
  try {
    await fs.mkdir(DIST_DIR, { recursive: true });

    const weeks = await fetchContributions(USERNAME, TOKEN);

    const darkSvg = buildSvg(weeks, 'dark');
    const lightSvg = buildSvg(weeks, 'light');

    await fs.writeFile(path.join(DIST_DIR, 'pulsar-dark.svg'), darkSvg, 'utf-8');
    await fs.writeFile(path.join(DIST_DIR, 'pulsar-light.svg'), lightSvg, 'utf-8');

    console.log('[Pulsar] Generated dist/pulsar-dark.svg and dist/pulsar-light.svg successfully.');
  } catch (err) {
    console.error('[Pulsar Error]', err);
    process.exit(1);
  }
}

run();
