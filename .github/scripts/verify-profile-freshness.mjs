import { readFile } from 'node:fs/promises';

const [publishedPath, generatedPath] = process.argv.slice(2);
if (!publishedPath || !generatedPath) {
  throw new Error('Usage: node verify-profile-freshness.mjs <published-svg> <generated-svg>');
}

function endDate(svg, label) {
  const match = svg.match(/<title id="title">[\d,]+ GitHub contributions from \d{4}-\d{2}-\d{2} to (\d{4}-\d{2}-\d{2})<\/title>/);
  if (!match) throw new Error(label + ' does not contain a valid contribution date range.');
  return match[1];
}

const [published, generated] = await Promise.all([readFile(publishedPath, 'utf8'), readFile(generatedPath, 'utf8')]);
const publishedEnd = Date.parse(endDate(published, 'Published SVG') + 'T00:00:00Z');
const generatedEnd = Date.parse(endDate(generated, 'Generated SVG') + 'T00:00:00Z');
if (publishedEnd < generatedEnd) {
  throw new Error('Published contribution data ends before the latest generated data (' +
    new Date(publishedEnd).toISOString().slice(0, 10) + ' < ' + new Date(generatedEnd).toISOString().slice(0, 10) + ').');
}
console.log('Published contribution data reaches ' + new Date(publishedEnd).toISOString().slice(0, 10) + '.');
