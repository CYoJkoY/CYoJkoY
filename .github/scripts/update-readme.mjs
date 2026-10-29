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
  return repos.filter(
    (repo) =>
      !repo.fork &&
      !repo.private &&
      !repo.archived &&
      repo.name.toLowerCase() !== USERNAME.toLowerCase()
  );
}

function renderGrid(repoList) {
  let html = '<table>\n';
  
  for (let i = 0; i < repoList.length; i += 2) {
    const left = repoList[i];
    const right = repoList[i + 1];

    html += '  <tr>\n';

    const leftStars = left.stargazers_count > 0 ? ` &nbsp;<sub>★ ${left.stargazers_count}</sub>` : '';
    const leftLang = left.language ? ` &nbsp;<code>${left.language}</code>` : '';
    const leftDesc = left.customDesc || left.description || 'No description provided.';
    html += `    <td width="50%" valign="top">\n`;
    html += `      <b><a href="${left.html_url}">${left.name}</a></b>${leftLang}${leftStars}<br/>\n`;
    html += `      <sub>${leftDesc}</sub>\n`;
    html += `    </td>\n`;

    if (right) {
      const rightStars = right.stargazers_count > 0 ? ` &nbsp;<sub>★ ${right.stargazers_count}</sub>` : '';
      const rightLang = right.language ? ` &nbsp;<code>${right.language}</code>` : '';
      const rightDesc = right.customDesc || right.description || 'No description provided.';
      html += `    <td width="50%" valign="top">\n`;
      html += `      <b><a href="${right.html_url}">${right.name}</a></b>${rightLang}${rightStars}<br/>\n`;
      html += `      <sub>${rightDesc}</sub>\n`;
      html += `    </td>\n`;
    } else {
      html += `    <td width="50%" valign="top"></td>\n`;
    }

    html += '  </tr>\n';
  }

  html += '</table>\n';
  return html;
}

async function run() {
  try {
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
          catRepos.push({ ...matched, customDesc });
        }
      }

      if (catRepos.length > 0) {
        generatedMarkdown += `#### ${cat.name}\n`;
        generatedMarkdown += renderGrid(catRepos) + '\n';
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
    console.log(`[Success] Minimal list synced to README.md`);
  } catch (err) {
    console.error('[Error]', err);
    process.exit(1);
  }
}

run();
