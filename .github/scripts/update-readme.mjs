import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = path.resolve('README.md');
const CONFIG_PATH = path.resolve('.github/profile-pins.json');
const PINS_DIR = path.resolve('pins');

const START_MARKER = '<!-- REPO_LIST:START -->';
const END_MARKER = '<!-- REPO_LIST:END -->';

// 技术栈官方标志色
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

// 文本分行逻辑（适配 390px 卡片宽度，每行约 44 个半角字符）
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

  // 超过两行添加省略号
  if (words.length > 0 && lines.length === 2 && currentLine !== words[words.length - 1]) {
    lines[1] = lines[1].slice(0, maxChars - 3) + '...';
  }
  return lines;
}

// 渲染单个 Pin 的 SVG 矢量代码
function generateCardSvg(repo) {
  const name = escapeXml(repo.name);
  const lang = repo.language || '';
  const langColor = LANG_COLORS[lang] || '#8b949e';
  const stars = repo.stargazers_count || 0;
  const desc = repo.customDesc || repo.description || 'No description provided.';
  const lines = wrapText(desc, 44);

  const line1 = escapeXml(lines[0] || '');
  const line2 = escapeXml(lines[1] || '');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="110" viewBox="0 0 390 110" fill="none">
  <rect x="0.5" y="0.5" width="389" height="109" rx="6" fill="#0d1117" stroke="#30363d"/>
  
  <!-- Repo Icon -->
  <g transform="translate(16, 16)">
    <path fill-rule="evenodd" d="M2 2.5A2.5 2.5 0 014.5 0h8.75a.75.75 0 01.75.75v12.5a.75.75 0 01-.75.75h-2.5a.75.75 0 110-1.5h1.75v-2h-8a1 1 0 00-.714 1.7.75.75 0 01-1.072 1.05A2.495 2.495 0 012 11.5v-9zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 011-1h8zM5 12.25v3.25a.25.25 0 00.4.2l1.45-1.087a.25.25 0 01.3 0L8.6 15.7a.25.25 0 00.4-.2v-3.25a.25.25 0 00-.25-.25h-3.5a.25.25 0 00-.25.25z" fill="#7d8590"/>
  </g>
  
  <!-- Title -->
  <text x="36" y="28" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#58a6ff">${name}</text>
  
  <!-- Description -->
  <text x="16" y="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${line1}</text>
  <text x="16" y="69" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${line2}</text>
  
  <!-- Footer: Language & Stars -->
  <g transform="translate(16, 92)">
    ${lang ? `
    <circle cx="5" cy="-4" r="5" fill="${langColor}"/>
    <text x="15" y="0" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${escapeXml(lang)}</text>
    ` : ''}
    
    <g transform="translate(${lang ? 110 : 0}, -9)">
      <path fill-rule="evenodd" d="M8 .25a.75.75 0 01.673.418l1.882 3.815 4.21.612a.75.75 0 01.416 1.279l-3.046 2.97.719 4.192a.75.75 0 01-1.088.791L8 12.347l-3.766 1.98a.75.75 0 01-1.088-.79l.72-4.194L.818 6.374a.75.75 0 01.416-1.28l4.21-.611L7.327.668A.75.75 0 018 .25z" fill="#7d8590"/>
      <text x="18" y="9" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${stars}</text>
    </g>
  </g>
</svg>`;
}

async function fetchAllRepos() {
  const url = `https://api.github.com/users/${USERNAME}/repos?per_page=100&type=owner&sort=updated`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'node-fetch',
    },
  });

  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
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
          catRepos.push(repoData);

          // 写入独立的静态 SVG 文件
          const svgContent = generateCardSvg(repoData);
          await fs.writeFile(path.join(PINS_DIR, `${matched.name}.svg`), svgContent, 'utf-8');
        }
      }

      if (catRepos.length > 0) {
        generatedMarkdown += `#### ${cat.name}\n\n<p align="left">\n`;
        for (const item of catRepos) {
          generatedMarkdown += `  <a href="${item.html_url}"><img src="./pins/${item.name}.svg" alt="${item.name}" width="390" /></a>\n`;
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
    console.log(`[Success] Generated SVG cards and synchronized to README.md`);
  } catch (err) {
    console.error('[Error]', err);
    process.exit(1);
  }
}

run();