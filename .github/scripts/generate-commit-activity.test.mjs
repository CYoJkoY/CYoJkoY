import assert from 'node:assert/strict';
import test from 'node:test';
import { renderCalendar } from './generate-commit-activity.mjs';

const calendar = { totalContributions: 9, weeks: Array.from({ length: 53 }, (_, weekIndex) => ({ contributionDays: Array.from({ length: 7 }, (_, weekday) => {
  const date = new Date(Date.UTC(2025, 11, 28 + weekIndex * 7 + weekday)).toISOString().slice(0, 10);
  return { contributionCount: (weekIndex + weekday) % 5, date, weekday };
}) })) };

test('renders accessible, complete activity cells with quiet motion and reduced-motion support', () => {
  const svg = renderCalendar(calendar);
  assert.match(svg, /<title id="title">9 contributions in 2027<\/title>/);
  assert.match(svg, /class="day level-4"/);
  assert.match(svg, /prefers-reduced-motion:reduce/);
  assert.match(svg, /class="glaze"/);
  assert.match(svg, /COMMIT ACTIVITY/);
  assert.doesNotMatch(svg, /pulsar|radar|beacon/i);
});

test('keeps every daily contribution cell available when animation is disabled', () => {
  const svg = renderCalendar(calendar);
  assert.equal((svg.match(/class="day level-[0-4]"/g) || []).length, 371);
  assert.match(svg, /animation:none/);
});
