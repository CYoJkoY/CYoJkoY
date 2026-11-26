import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// Renders the pinned project cards in README.md from .github/profile-pins.json.
// A pin may be a bare repository name or an "owner/name" slug, so collaborations
// and organization projects can be listed next to the repositories this profile
// owns. See .github/profile-pins.md for the configuration contract.
const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'CYoJkoY';
const TOKEN = process.env.GITHUB_TOKEN || '';
const README_PATH = path.resolve('README.md');
const CONFIG_PATH = path.resolve('.github/profile-pins.json');
const PINS_DIR = path.resolve('pins');
const API_ROOT = 'https://api.github.com';

const START_MARKER = '<!-- REPO_LIST:START -->';
const END_MARKER = '<!-- REPO_LIST:END -->';

const LANG_COLORS = {
  AutoHotkey: '#7baed8',
  'C++': '#f34b7d',
  CSS: '#aa80d1',
  GDScript: '#6d98ba',
  HTML: '#e9795b',
  Java: '#d99138',
  JavaScript: '#f1e05a',
  PowerShell: '#7c9bdb',
  Python: '#70a5e3',
  Rust: '#dea584',
  TypeScript: '#5b9ce6',
};

function languageColor(language) {
  if (Object.hasOwn(LANG_COLORS, language)) return LANG_COLORS[language];

  let hash = 5381;
  for (const character of language) hash = (hash * 33) ^ character.charCodeAt(0);
  const hue = Math.abs(hash) % 360;
  const saturation = 52;
  const lightness = 62;
  const chroma = (1 - Math.abs(2 * lightness / 100 - 1)) * saturation / 100;
  const hueSection = hue / 60;
  const secondary = chroma * (1 - Math.abs(hueSection % 2 - 1));
  const [red, green, blue] = hueSection < 1 ? [chroma, secondary, 0]
    : hueSection < 2 ? [secondary, chroma, 0]
      : hueSection < 3 ? [0, chroma, secondary]
        : hueSection < 4 ? [0, secondary, chroma]
          : hueSection < 5 ? [secondary, 0, chroma]
            : [chroma, 0, secondary];
  const offset = lightness / 100 - chroma / 2;
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

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
  let remaining = text.trim();
  const lines = [];
  while (remaining && lines.length < 2) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      remaining = '';
      break;
    }
    const lastSpace = remaining.lastIndexOf(' ', maxChars);
    const split = lastSpace > 0 ? lastSpace : maxChars;
    lines.push(remaining.slice(0, split));
    remaining = remaining.slice(split).trim();
  }
  if (remaining) {
    lines[1] = lines[1].slice(0, maxChars - 3).trimEnd() + '...';
  }
  return lines;
}

function generateCardSvg(repo) {
  const name = escapeXml(repo.name);
  const lang = repo.language || '';
  const langColor = languageColor(lang);
  const stars = repo.stargazers_count ?? 0;
  const forks = repo.forks_count ?? 0;
  const desc = repo.customDesc || repo.description || 'No description provided.';
  const lines = wrapText(desc, 44);

  const line1 = escapeXml(lines[0] || '');
  const line2 = escapeXml(lines[1] || '');

  // The bottom element is uniformly based on y=82
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

  // 2. Stars
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

  // 3. Forks (completely fixed three-center absolute concentric repo-forked vector)
  const forkText = String(forks);
  footerItems += `
  <g transform="translate(${currentX}, 0)">
    <svg x="0" y="0" width="16" height="16" viewBox="0 0 16 16" fill="#7d8590">
      <path fill-rule="evenodd" d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm7.5 0a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0ZM8.75 12.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/>
    </svg>
    <text x="20" y="12.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#8b949e">${forkText}</text>
  </g>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="110" viewBox="0 0 390 110" fill="none">
  <rect x="0.5" y="0.5" width="389" height="109" rx="2" fill="#1B1C20" stroke="#3B3935"/>
  <path d="M16 1H374" stroke="#C84A3B" stroke-opacity="0.72"/>

  <!-- Repo Icon -->
  <g transform="translate(16, 16)">
    <svg width="16" height="16" viewBox="0 0 16 16" fill="#68645C">
      <path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1V9h-8c-.356 0-.694.074-1 .208V2.5a1 1 0 0 1 1-1ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z"/>
    </svg>
  </g>

  <!-- Title -->
  <text x="38" y="28.5" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="14" font-weight="600" fill="#EDEAE2">${name}</text>

  <!-- Description -->
  <text x="16" y="52" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#A39F95">${line1}</text>
  <text x="16" y="68" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif" font-size="12" fill="#A39F95">${line2}</text>

  <!-- Footer Items Row -->
  <g transform="translate(0, 82)">
    ${footerItems}
  </g>
</svg>`;
}

function apiHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'node-fetch',
  };
  if (TOKEN) {
    headers.Authorization = `Bearer ${TOKEN}`;
  }
  return headers;
}

function ownerLogin(repo) {
  return (repo.owner && repo.owner.login) || USERNAME;
}

function repoSlug(repo) {
  return `${ownerLogin(repo)}/${repo.name}`;
}

function isOwned(repo) {
  return ownerLogin(repo).toLowerCase() === USERNAME.toLowerCase();
}

function isProfileRepo(repo) {
  return isOwned(repo) && repo.name.toLowerCase() === USERNAME.toLowerCase();
}

// Pins share one flat directory, so a repository owned by someone else keeps its
// owner in the file name instead of clashing with an owned repository of the same
// name.
function pinFileName(repo) {
  return isOwned(repo) ? `${repo.name}.svg` : `${ownerLogin(repo)}--${repo.name}.svg`;
}

async function fetchRepoPages(buildUrl, label) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const response = await fetch(buildUrl(page), { headers: apiHeaders() });
    if (!response.ok) {
      throw new Error(`GitHub API request failed for ${label}: ${response.status} ${response.statusText}`);
    }
    const batch = await response.json();
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

// `type=owner` only lists repositories the profile owner created, which is why
// collaborations and organization projects used to be impossible to pin.
// `type=member` lists the repositories reachable through collaboration and
// organization membership, and it is public data, so the default workflow token
// can read it.
async function fetchProfileRepos() {
  const owned = await fetchRepoPages(
    (page) => `${API_ROOT}/users/${USERNAME}/repos?per_page=100&type=owner&sort=full_name&page=${page}`,
    `repositories owned by ${USERNAME}`
  );

  let shared = [];
  try {
    shared = await fetchRepoPages(
      (page) => `${API_ROOT}/users/${USERNAME}/repos?per_page=100&type=member&sort=full_name&page=${page}`,
      `collaboration and organization repositories of ${USERNAME}`
    );
  } catch (err) {
    console.warn(`[Warn] ${err.message}. Only owned repositories are discovered; pin others as "owner/name".`);
  }

  const repos = new Map();
  for (const repo of [...owned, ...shared]) {
    repos.set(repoSlug(repo).toLowerCase(), repo);
  }
  return [...repos.values()];
}

async function fetchConfiguredRepo(slug) {
  const response = await fetch(`${API_ROOT}/repos/${slug}`, { headers: apiHeaders() });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub API request failed for ${slug}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function indexRepos(repos) {
  const bySlug = new Map();
  const byName = new Map();
  for (const repo of repos) {
    bySlug.set(repoSlug(repo).toLowerCase(), repo);
    const key = repo.name.toLowerCase();
    byName.set(key, [...(byName.get(key) || []), repo]);
  }
  return { bySlug, byName };
}

function pinnedSpec(entry) {
  if (typeof entry === 'string') return entry.trim();
  if (entry && typeof entry.name === 'string') return entry.name.trim();
  return '';
}

function unpinnableReason(repo) {
  if (repo.private) return 'private';
  if (isProfileRepo(repo)) return 'the profile repository itself';
  return null;
}

async function resolvePinnedRepo(spec, index) {
  if (spec.includes('/')) {
    const [owner, name, ...rest] = spec.split('/').map((part) => part.trim());
    if (!owner || !name || rest.length > 0) {
      return { spec, reason: 'invalid, expected "owner/name"' };
    }
    const slug = `${owner}/${name}`;
    let repo = index.bySlug.get(slug.toLowerCase());
    if (!repo) {
      repo = await fetchConfiguredRepo(slug);
    }
    const reason = repo ? unpinnableReason(repo) : 'not found or not reachable';
    return reason ? { spec, reason } : { spec, repo };
  }

  const matches = index.byName.get(spec.toLowerCase()) || [];
  const pinnable = matches.filter((repo) => !unpinnableReason(repo));
  const owned = pinnable.find(isOwned);
  if (owned) {
    return { spec, repo: owned };
  }
  if (pinnable.length === 1) {
    return { spec, repo: pinnable[0] };
  }
  if (pinnable.length > 1) {
    return { spec, reason: `ambiguous, pin it as "owner/name" (${pinnable.map(repoSlug).join(' or ')})` };
  }
  if (matches.length > 0) {
    return { spec, reason: unpinnableReason(matches[0]) };
  }
  return { spec, reason: `not found in the public repositories of ${USERNAME}, pin it as "owner/name"` };
}

async function run() {
  try {
    await fs.mkdir(PINS_DIR, { recursive: true });

    const index = indexRepos(await fetchProfileRepos());

    const rawConfig = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = JSON.parse(rawConfig);
    const categories = Array.isArray(config.categories) ? config.categories : [];

    // Explicit pins include public forks, archived repositories, and repositories
    // owned by other accounts. Resolve all configured names before writing so a
    // typo cannot silently remove cards.
    const resolutions = new Map();
    const problems = [];
    for (const cat of categories) {
      for (const entry of cat.repos || []) {
        const spec = pinnedSpec(entry);
        if (!spec) {
          problems.push('an entry without a repository name');
          continue;
        }
        const key = spec.toLowerCase();
        if (!resolutions.has(key)) {
          resolutions.set(key, await resolvePinnedRepo(spec, index));
        }
        const resolution = resolutions.get(key);
        if (!resolution.repo) {
          problems.push(`${resolution.spec} (${resolution.reason})`);
        }
      }
    }
    if (problems.length > 0) {
      throw new Error(`Configured repositories are not available as public repositories: ${problems.join(', ')}`);
    }

    let generatedMarkdown = '\n';
    const generatedFiles = new Set();

    for (const cat of categories) {
      const catRepos = [];

      for (const entry of cat.repos || []) {
        const customDesc = typeof entry === 'object' && entry !== null ? entry.desc : null;
        const matched = resolutions.get(pinnedSpec(entry).toLowerCase()).repo;
        const repoData = { ...matched, customDesc };
        const svgContent = generateCardSvg(repoData);

        const hash = crypto.createHash('md5').update(svgContent).digest('hex').slice(0, 8);
        const fileName = pinFileName(matched);
        await fs.writeFile(path.join(PINS_DIR, fileName), svgContent, 'utf-8');
        generatedFiles.add(fileName);

        catRepos.push({ ...repoData, hash, fileName });
      }

      if (catRepos.length > 0) {
        generatedMarkdown += `#### ${cat.name}\n\n<p align="left">\n`;
        for (const item of catRepos) {
          generatedMarkdown += `  <a href="${item.html_url}"><img src="./pins/${item.fileName}?v=${item.hash}" alt="${item.name}" width="390" /></a>\n`;
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
    for (const file of await fs.readdir(PINS_DIR)) {
      if (file.endsWith('.svg') && !generatedFiles.has(file)) {
        await fs.unlink(path.join(PINS_DIR, file));
      }
    }
    console.log(`[Success] Synced ${generatedFiles.size} cards and removed unlisted SVGs.`);
  } catch (err) {
    console.error('[Error]', err);
    process.exit(1);
  }
}

run();
