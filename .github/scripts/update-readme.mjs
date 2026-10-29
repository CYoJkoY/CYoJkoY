import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = path.resolve('README.md');

const START_MARKER = '<!-- REPO_LIST:START -->';
const END_MARKER = '<!-- REPO_LIST:END -->';

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
    throw new Error(`GitHub API 请求失败: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json();

  // 剔除 Fork 仓库、私有仓库和 Profile 自身同名仓库
  return repos.filter(
    (repo) => !repo.fork && !repo.private && repo.name.toLowerCase() !== USERNAME.toLowerCase()
  );
}

function buildMarkdownTable(repos) {
  const sorted = [...repos].sort((a, b) => b.stargazers_count - a.stargazers_count);

  let markdown = '\n| 项目 | 核心语言 | 描述 | Stars | 最近更新 |\n';
  markdown += '| :--- | :---: | :--- | :---: | :---: |\n';

  for (const repo of sorted) {
    const name = `[**${repo.name}**](${repo.html_url})`;
    const lang = repo.language ? `\`${repo.language}\`` : '-';
    const desc = (repo.description || '暂无描述').replace(/\|/g, '\\|');
    const stars = repo.stargazers_count > 0 ? `⭐ ${repo.stargazers_count}` : '-';
    const updated = repo.pushed_at ? repo.pushed_at.slice(0, 10) : '-';

    markdown += `| ${name} | ${lang} | ${desc} | ${stars} | ${updated} |\n`;
  }

  return markdown;
}

async function run() {
  try {
    const repos = await fetchAllRepos();
    const tableContent = buildMarkdownTable(repos);

    const readme = await fs.readFile(README_PATH, 'utf-8');
    const startIndex = readme.indexOf(START_MARKER);
    const endIndex = readme.indexOf(END_MARKER);

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      throw new Error(`未在 README.md 中找到有效的注释标记: ${START_MARKER} ... ${END_MARKER}`);
    }

    const updatedReadme =
      readme.slice(0, startIndex + START_MARKER.length) +
      '\n' +
      tableContent +
      readme.slice(endIndex);

    await fs.writeFile(README_PATH, updatedReadme, 'utf-8');
    console.log(`[成功] 已同步 ${repos.length} 个公开仓库至 README.md`);
  } catch (err) {
    console.error('[失败]', err);
    process.exit(1);
  }
}

run();
