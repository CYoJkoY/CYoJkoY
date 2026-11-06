const USERNAME = process.env.GITHUB_REPOSITORY_OWNER || 'CYoJkoY';
const TOKEN = process.env.GITHUB_TOKEN || '';
const OUTPUT = new URL('../../assets/commit-activity.svg', import.meta.url);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function renderCalendar(calendar) {
  const weeks = calendar.weeks;
  const cell = 12;
  const gap = 4;
  const left = 48;
  const top = 82;
  const chartWidth = weeks.length * (cell + gap) - gap;
  const width = left + chartWidth + 32;
  const height = 208;
  const max = Math.max(1, ...weeks.flatMap((week) => week.contributionDays.map((day) => day.contributionCount)));
  const palette = ['#292824', '#5E5147', '#89715B', '#B28A65', '#D0A27A'];
  const cells = [];
  const months = [];
  let previousMonth = -1;

  weeks.forEach((week, weekIndex) => {
    week.contributionDays.forEach((day) => {
      const x = left + weekIndex * (cell + gap);
      const y = top + day.weekday * (cell + gap);
      const level = day.contributionCount === 0 ? 0 : Math.min(4, Math.ceil(day.contributionCount / max * 4));
      const date = new Date(day.date + 'T00:00:00Z');
      if (date.getUTCMonth() !== previousMonth) {
        months.push('<text x="' + x + '" y="62" class="month">' + MONTHS[date.getUTCMonth()] + '</text>');
        previousMonth = date.getUTCMonth();
      }
      const safeDate = day.date.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
      cells.push('<rect class="day level-' + level + '" x="' + x + '" y="' + y + '" width="' + cell + '" height="' + cell + '" rx="1.5"><title>' + day.contributionCount + ' contributions on ' + safeDate + '</title></rect>');
    });
  });

  const year = new Date(weeks.at(-1).contributionDays.at(-1).date).getUTCFullYear();
  const number = Number(calendar.totalContributions).toLocaleString('en-US');
  return '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '" viewBox="0 0 ' + width + ' ' + height + '" role="img" aria-labelledby="title desc">\n' +
  '<title id="title">' + number + ' contributions in ' + year + '</title><desc id="desc">A year of daily GitHub contributions, shown as an ink wash calendar with quiet animated accents.</desc>\n' +
  '<defs><pattern id="paper" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".45" fill="#EDEAE2" opacity=".08"/></pattern><linearGradient id="glaze"><stop stop-color="#C84A3B" stop-opacity="0"/><stop offset=".5" stop-color="#D88B70" stop-opacity=".28"/><stop offset="1" stop-color="#C84A3B" stop-opacity="0"/></linearGradient><clipPath id="chart"><rect x="' + left + '" y="' + top + '" width="' + chartWidth + '" height="108"/></clipPath></defs>\n' +
  '<style>text{font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif}.frame{fill:#1B1C20;stroke:#3B3935}.paper{fill:url(#paper)}.rule{stroke:#C84A3B;stroke-opacity:.72}.eyebrow{fill:#A39F95;font-size:10px;letter-spacing:2px}.total{fill:#EDEAE2;font-family:Georgia,\'Times New Roman\',serif;font-size:27px}.caption{fill:#A39F95;font-size:11px}.month{fill:#A39F95;font-size:10px}.weekday{fill:#827E75;font-size:9px}.day{stroke:#1B1C20;stroke-width:1}.level-0{fill:#292824}.level-1{fill:#5E5147}.level-2{fill:#89715B}.level-3{fill:#B28A65}.level-4{fill:#D0A27A}.wash{animation:drift 32s ease-in-out infinite alternate}.glaze{animation:glide 24s ease-in-out infinite alternate}@keyframes drift{to{transform:translateY(-1px);opacity:.76}}@keyframes glide{from{transform:translateX(-' + Math.round(chartWidth * 0.1) + 'px)}to{transform:translateX(' + Math.round(chartWidth * 0.78) + 'px)}}@media(prefers-reduced-motion:reduce){.wash,.glaze{animation:none}}</style>\n' +
  '<rect class="frame" x=".5" y=".5" width="' + (width - 1) + '" height="' + (height - 1) + '" rx="2"/><rect class="paper" x="1" y="1" width="' + (width - 2) + '" height="' + (height - 2) + '"/>\n' +
  '<path class="rule" d="M20 1H94"/><text class="eyebrow" x="24" y="28">COMMIT ACTIVITY · ' + year + '</text><text class="total" x="24" y="59">' + number + '</text><text class="caption" x="' + left + '" y="199">' + year + ' · ' + weeks.length + ' weeks</text>\n' +
  months.join('') + '<g class="weekday"><text x="20" y="95">M</text><text x="20" y="111">W</text><text x="20" y="127">F</text></g><g>' + cells.join('') + '</g><g clip-path="url(#chart)" class="wash"><rect class="glaze" x="' + left + '" y="' + top + '" width="' + Math.max(20, Math.round(chartWidth * 0.22)) + '" height="108" fill="url(#glaze)"/></g><path d="M' + left + ' 183H' + (left + chartWidth) + '" stroke="#3B3935"/><circle cx="' + (width - 22) + '" cy="25" r="3" fill="#C84A3B"/></svg>\n';
}

export async function generate() {
  if (!TOKEN) throw new Error('GITHUB_TOKEN environment variable is required.');
  const query = 'query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date weekday}}}}}}';
  const response = await fetch('https://api.github.com/graphql', { method: 'POST', headers: { Authorization: 'bearer ' + TOKEN, 'Content-Type': 'application/json', 'User-Agent': 'CYoJkoY-Profile' }, body: JSON.stringify({ query, variables: { login: USERNAME } }) });
  if (!response.ok) throw new Error('GitHub GraphQL request failed: ' + response.status + ' ' + response.statusText);
  const payload = await response.json();
  if (payload.errors) throw new Error('GitHub GraphQL errors: ' + JSON.stringify(payload.errors));
  const svg = renderCalendar(payload.data.user.contributionsCollection.contributionCalendar);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(OUTPUT, svg, 'utf8');
}

if (process.argv[1] && OUTPUT.pathname === process.argv[1].replaceAll('\\', '/')) {
  generate().catch((error) => { console.error(error); process.exitCode = 1; });
}
