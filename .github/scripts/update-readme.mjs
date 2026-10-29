import fs from 'node:fs/promises';
import path from 'node:path';

const USERNAME = process.env.GITHUB_REPOSITORY_OWNER;
const TOKEN = process.env.GITHUB_TOKEN;
const README_PATH = path.resolve('README.md');
const CONFIG_PATH = path.resolve('.github/profile-pins.json');

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

  // 严格过滤：排除 Fork、私有仓库、同名 Profile 仓库，以及已归档（Public Archive）项目
  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.private &&
      !repo.archived &&
      repo.name.toLowerCase() !== USERNAME.toLowerCase()
  );
}

function renderTable(repoList) {
  let md = '\n| 项目 | 技术栈 | 描述 | Stars |\n';
  md += '| :--- | :---: | :--- | :---: |\n';

  for (const item of repoList) {
    const name = `[**${item.name}**](${item.html_url})`;
    const lang = item.language ? `\`${item.language}\`` : '-';
    const desc = (item.customDesc || item.description || '暂无描述').replace(/\|/g, '\\|');
    const stars = item.stargazers_count > 0 ? `⭐ ${item.stargazers_count}` : '-';

    md += `| ${name} | ${lang} | ${desc} | ${stars} |\n`;
  }
  return md;
}

async function run() {
  try {
    const repos = await fetchAllRepos();
    const repoMap = new Map(repos.map((r) => [r.name.toLowerCase(), r]));

    // 读取分类配置
    const rawConfig = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(rawConfig);

    const usedRepoNames = new Set();
    let generatedMarkdown = '\n';

    // 1. 按配置顺序渲染各分类表格
    for (const cat of config.categories || []) {
      const catRepos = [];

      for (const entry of cat.repos || []) {
        const repoName = typeof entry === 'string' ? entry : entry.name;
        const customDesc = typeof entry === 'object' ? entry.desc : null;
        const matched = repoMap.get(repoName.toLowerCase());

        // 仅添加存在且未归档的公开仓库
        if (matched) {
          catRepos.push({ ...matched, customDesc });
          usedRepoNames.add(repoName.toLowerCase());
        }
      }

      if (catRepos.length > 0) {
        generatedMarkdown += `#### ${cat.name}\n`;
        generatedMarkdown += renderTable(catRepos) + '\n';
      }
    }

    // 2. 将未分类的其他活跃公开项目收纳进折叠抽屉
    if (config.showUncategorizedInDrawer) {
      const remainingRepos = repos.filter((r) => !usedRepoNames.has(r.name.toLowerCase()));
      if (remainingRepos.length > 0) {
        remainingRepos.sort((a, b) => b.stargazers_count - a.stargazers_count);
        generatedMarkdown += '<details>\n';
        generatedMarkdown += `<summary><b>📦 更多活跃组件与实验项目 (共 ${remainingRepos.length} 个)</b></summary>\n<br>\n`;
        generatedMarkdown += renderTable(remainingRepos);
        generatedMarkdown += '\n</details>\n';
      }
    }

    // 3. 回写 README
    const readme = await fs.readFile(README_PATH, 'utf-8');
    const startIndex = readme.indexOf(START_MARKER);
    const endIndex = readme.indexOf(END_MARKER);

    if (startIndex === -1 || endIndex === -1 || startIndex >= endIndex) {
      throw new Error(`未在 README.md 中找到有效的注释标记: ${START_MARKER} ... ${END_MARKER}`);
    }

    const updatedReadme =
      readme.slice(0, startIndex + START_MARKER.length) +
      generatedMarkdown +
      readme.slice(endIndex);

    await fs.writeFile(README_PATH, updatedReadme, 'utf-8');
    console.log(`[成功] 分类矩阵已更新至 README.md`);
  } catch (err) {
    console.error('[失败]', err);
    process.exit(1);
  }
}

run();
