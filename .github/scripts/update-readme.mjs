import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'CYoJkoY';
const TOKEN = process.env.GITHUB_TOKEN || '';
const README_PATH = path.resolve('README.md');
const CONFIG_PATH = path.resolve('.github/profile-pins.json');
const PINS_DIR = path.resolve('pins');

const START_MARKER = '<!-- REPO_LIST:START -->';
const END_MARKER = '<!-- REPO_LIST:END -->';

const LANG_COLORS = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  AutoHotkey: '#6594b9',
  PowerShell: '#012456',
  'C++': '#f34b7d',
  GDScript: '#355570',
  CSS: '#563d7c',
  HTML: '#e34c26',
  Python: '#3572A5',
  Rust: '#dea584',
  Go: '#00ADD8',
};

function escapeXml(str) {
  return String(str || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  });
}

function wrapText(text, maxChars = 44) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + ' ' + word).trim().length <= maxChars) {
      currentLine = (currentLine + ' ' + word).trim();
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 2 && currentLine) {
    lines.push(currentLine);
  }

  if (words.length > 0 && lines.length === 2 && currentLine !== words[words.length - 1]) {
    lines[1] = lines[1].slice(0, maxChars - 3) + '...';
  }
  return lines;
}

function generateCardSvg(repo) {
  const name = escapeXml(repo.name);
  const lang = repo.language || '';
  const langColor = LANG_COLORS[lang] || '#8b949e';
  const stars = repo.stargazers_count ?? 0;
  const forks = repo.forks_count ?? 0;
  const desc = repo.customDesc || repo.description || 'No description provided.';
  const lines = wrapText(desc, 44);

  const line1 = escapeXml(lines[0] || '');
  const line2 = escapeXml(lines[1] || '');

  // 底部元素统一以 y=82 为基准行
  // 16x16 图标的几何中心位于 y=8，12px 文字在 y=12.5 基线下字形几何中心同样为 y=8.25，两端绝对平齐
  let footerItems = '';
  let currentX = 16;

  // 1. Language Dot & Name
  if (lang) {
    const langWidth = Math.round(lang.length * 7.2);
    footerItems += `
    <g transform="translate(${currentX}, 0)">
      <circle cx="5" cy="8" r="5" fill="${langColor}"/>
      <text x="16" y="12.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${escapeXml(lang)}</text>
    </g>`;
    currentX += 16 + langWidth + 16;
  }

  // 2. Stars (GitHub Primer Octicon Outline)
  const starText = String(stars);
  const starWidth = Math.round(starText.length * 7.5);
  footerItems += `
  <g transform="translate(${currentX}, 0)">
    <svg x="0" y="0" width="16" height="16" viewBox="0 0 16 16" fill="#7d8590">
      <path d="M8 .25a.75.75 0 0 1 .673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.75.75 0 0 1-1.088.791L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.695Z"/>
    </svg>
    <text x="20" y="12.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${starText}</text>
  </g>`;
  currentX += 20 + starWidth + 16;

  // 3. Forks (GitHub Primer Octicon repo-forked)
  const forkText = String(forks);
  footerItems += `
  <g transform="translate(${currentX}, 0)">
    <svg x="0" y="0" width="16" height="16" viewBox="0 0 16 16" fill="#7d8590">
      <path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V10.5h-1.5A2.25 2.25 0 0 1 3.5 8.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z"/>
    </svg>
    <text x="20" y="12.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${forkText}</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="110" viewBox="0 0 390 110" fill="none">
  <rect x="0.5" y="0.5" width="389" height="109" rx="6" fill="#0d1117" stroke="#30363d"/>
  
  <!-- Repo Icon -->
  <g transform="translate(16, 16)">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="#7d8590">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 0 1 1-1ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z"/>
    </svg>
  </g>
  
  <!-- Title -->
  <text x="38" y="28.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#58a6ff">${name}</text>
  
  <!-- Description -->
  <text x="16" y="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${line1}</text>
  <text x="16" y="68" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${line2}</text>
  
  <!-- Footer Items Row -->
  <g transform="translate(0, 82)">
    ${footerItems}
  </g>
</svg>`;
}

async function fetchAllRepos() {
  const url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&type=owner&sort=updated`;
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'node-fetch',
  };
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json();
  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.private &&
      !repo.archived &&
      repo.name.toLowerCase() !== USERNAME.toLowerCase()
  );
}

async function run() {
  try {
    await fs.mkdir(PINS_DIR, { recursive: true });

    const repos = await fetchAllRepos();
    const repoMap = new Map(repos.map((r) => [r.name.toLowerCase(), r]));

    const rawConfig = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(rawConfig);

    let generatedMarkdown = '\n';

    for (const cat of config.categories || []) {
      const catRepos = [];

      for (const entry of cat.repos || []) {
        const repoName = typeof entry === 'string' ? entry : entry.name;
        const customDesc = typeof entry === 'object' ? entry.desc : null;
        const matched = repoMap.get(repoName.toLowerCase());

        if (matched) {
          const repoData = { ...matched, customDesc };
          const svgContent = generateCardSvg(repoData);

          // 核心：计算内容哈希并写入独立 SVG
          const hash = crypto.createHash('md5').update(svgContent).digest('hex').slice(0, 8);
          await fs.writeFile(path.join(PINS_DIR, `${matched.name}.svg`), svgContent, 'utf-8');

          catRepos.push({ ...repoData, hash });
        }
      }

      if (catRepos.length > 0) {
        generatedMarkdown += `#### ${cat.name}\n\n<p align="left">\n`;
        for (const item of catRepos) {
          // 在 URL 后拼接内容哈希，彻底穿透 GitHub Camo 缓存
          generatedMarkdown += `  <a href="${item.html_url}"><img src="./pins/${item.name}.svg?v=${item.hash}" alt="${item.name}" width="390" /></a>\n`;
        }
        generatedMarkdown += `</p>\n\n`;
      }
    }

    const readme = await fs.readFile(README_PATH, 'utf-8');
    const startIndex = readme.indexOf(START_MARKER);
    const endIndex = readme.indexOf(END_MARKER);

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      throw new Error(`Markers not found: ${START_MARKER} ... ${END_MARKER}`);
    }

    const updatedReadme =
      readme.slice(0, startIndex + START_MARKER.length) +
      generatedMarkdown +
      readme.slice(endIndex);

    await fs.writeFile(README_PATH, updatedReadme, 'utf-8');
    console.log(`[Success] Cards and README synchronized with cache-busting hashes.`);
  } catch (err) {
    console.error('[Error]', err);
    process.exit(1);
  }
}

run();
