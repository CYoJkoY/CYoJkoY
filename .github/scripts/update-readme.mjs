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
    throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
  }

  const repos = await response.json();

  // Exclude forks, private repositories, the profile repository itself, and archived projects
  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.private &&
      !repo.archived &&
      repo.name.toLowerCase() !== USERNAME.toLowerCase()
  );
}

function renderTable(repoList) {
  let md = '\n| Project | Tech Stack | Description | Stars |\n';
  md += '| :--- | :---: | :--- | :---: |\n';

  for (const item of repoList) {
    const name = `[**${item.name}**](${item.html_url})`;
    const lang = item.language ? `\`${item.language}\`` : '-';
    const desc = (item.customDesc || item.description || 'No description provided').replace(/\|/g, '\\|');
    const stars = item.stargazers_count > 0 ? `⭐ ${item.stargazers_count}` : '-';

    md += `| ${name} | ${lang} | ${desc} | ${stars} |\n`;
  }
  return md;
}

async function run() {
  try {
    const repos = await fetchAllRepos();
    const repoMap = new Map(repos.map((r) => [r.name.toLowerCase(), r]));

    const rawConfig = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(rawConfig);

    const usedRepoNames = new Set();
    let generatedMarkdown = '\n';

    // 1. Render categorized tables
    for (const cat of config.categories || []) {
      const catRepos = [];

      for (const entry of cat.repos || []) {
        const repoName = typeof entry === 'string' ? entry : entry.name;
        const customDesc = typeof entry === 'object' ? entry.desc : null;
        const matched = repoMap.get(repoName.toLowerCase());

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

    // 2. Render uncategorized active projects in a collapsible drawer
    if (config.showUncategorizedInDrawer) {
      const remainingRepos = repos.filter((r) => !usedRepoNames.has(r.name.toLowerCase()));
      if (remainingRepos.length > 0) {
        remainingRepos.sort((a, b) => b.stargazers_count - a.stargazers_count);
        generatedMarkdown += '<details>\n';
        generatedMarkdown += `<summary><b>📦 Additional Active Projects (${remainingRepos.length})</b></summary>\n<br>\n`;
        generatedMarkdown += renderTable(remainingRepos);
        generatedMarkdown += '\n</details>\n';
      }
    }

    // 3. Write back to README.md
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
    console.log(`[Success] Categorized matrix synced to README.md`);
  } catch (err) {
    console.error('[Error]', err);
    process.exit(1);
  }
}

run();
