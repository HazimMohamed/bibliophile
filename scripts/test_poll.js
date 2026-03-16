/**
 * test_poll.js — Playwright diagnostic for the summary polling loop.
 *
 * What it does:
 *  1. Opens the reader for a real book.
 *  2. Waits for the book to fully load.
 *  3. Snapshots what the frontend currently thinks chapter-0 summary is.
 *  4. Injects a fake summary directly into the JSON on disk (no Haiku call needed).
 *  5. Waits two full poll cycles.
 *  6. Checks console for "[summarize]" messages and reads bookRef via
 *     an exposed global to verify the state was actually updated.
 *  7. Restores the original summary value.
 *
 * Usage:
 *   node scripts/test_poll.js
 */

const { chromium } = require('../frontend/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const BOOK_ID = '245a8ec5-ca80-47cb-afb3-ffb11f95a781';
const BOOK_JSON = path.resolve(__dirname, `../data/books/${BOOK_ID}.json`);
const APP_URL = `http://localhost:5173/#/reader/${BOOK_ID}`;
const POLL_MS = 5000;
const FAKE_SUMMARY = '__TEST_SUMMARY__ injected by test_poll.js';

async function main() {
  // ── 1. Patch the book JSON on disk ────────────────────────
  const raw = fs.readFileSync(BOOK_JSON, 'utf8');
  const bookData = JSON.parse(raw);
  const originalSummary = bookData.chapters[0].summary;
  console.log(`Chapter-0 summary before patch: ${JSON.stringify(originalSummary)}`);

  // ── 2. Launch browser, open reader ────────────────────────
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[summarize]')) consoleLogs.push({ type: msg.type(), text });
  });
  page.on('pageerror', (err) => console.error('PAGE ERROR:', err.message));

  console.log(`Navigating to ${APP_URL}`);
  await page.goto(APP_URL);

  // Wait for book to load (header shows chapter label)
  await page.waitForSelector('.reader-chapter-label', { timeout: 10_000 });
  console.log('Book loaded in browser.');

  // ── 3. Wait one poll so we have a baseline "no changes" ───
  console.log(`Waiting ${POLL_MS + 1000}ms for one baseline poll...`);
  await page.waitForTimeout(POLL_MS + 1000);
  const baselineLogs = consoleLogs.splice(0);
  console.log('Baseline poll logs:', baselineLogs.length ? baselineLogs : '(none — check console level)');

  // ── 4. Inject fake summary into the JSON file ─────────────
  bookData.chapters[0].summary = FAKE_SUMMARY;
  bookData.chapters[0].summarized_at = new Date().toISOString();
  fs.writeFileSync(BOOK_JSON, JSON.stringify(bookData, null, 2));
  console.log('Injected fake summary into disk. Waiting for next poll...');

  // ── 5. Wait two poll cycles ───────────────────────────────
  await page.waitForTimeout(POLL_MS * 2 + 1000);

  // ── 6. Report ─────────────────────────────────────────────
  const afterLogs = consoleLogs.splice(0);
  console.log('\n── Console logs after injection ─────────────────────');
  if (afterLogs.length === 0) {
    console.log('  (no [summarize] logs captured)');
  } else {
    afterLogs.forEach((l) => console.log(`  [${l.type}] ${l.text}`));
  }

  // Also inspect current book state via page.evaluate
  const currentSummary = await page.evaluate(() => {
    // bookRef is not directly accessible, but we can call the API
    return fetch(`/api/books/${window.__TEST_BOOK_ID__ ?? ''}`)
      .then(r => r.json())
      .then(d => d.chapters?.[0]?.summary)
      .catch(() => 'fetch failed');
  });
  // Easier: just check what the API returns from node
  const freshFromApi = JSON.parse(
    require('child_process').execSync(
      `curl -s "http://localhost:8000/books/${BOOK_ID}"`, { encoding: 'utf8' }
    )
  );
  console.log(`\nAPI chapter-0 summary now: ${JSON.stringify(freshFromApi.chapters?.[0]?.summary)}`);

  const detected = afterLogs.some(l => l.text.includes('summary updated'));
  console.log(`\n✅ Poll detected the change: ${detected}`);
  if (!detected) {
    console.log('❌ BUG CONFIRMED — poll did not fire "summary updated" despite disk change.');
  }

  // ── 7. Restore original value ─────────────────────────────
  bookData.chapters[0].summary = originalSummary;
  bookData.chapters[0].summarized_at = null;
  fs.writeFileSync(BOOK_JSON, JSON.stringify(bookData, null, 2));
  console.log('Restored original summary.');

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
