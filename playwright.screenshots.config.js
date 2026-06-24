const baseConfig = require('./playwright.config.js');

/**
 * Dedicated config for the showcase screenshot capture (`npm run screenshots`,
 * used by ./preview-website.sh). It is intentionally NOT part of the E2E suite:
 * the default config's testDir is './tests', so a bare `npx playwright test`
 * (as run in CI) never picks these up. This config points testDir at
 * './screenshots' so the capture spec is discoverable on demand.
 */
module.exports = {
  ...baseConfig,
  testDir: './screenshots',
  // The capture builds a full 3-pane layout (editor + terminal + browser) with
  // several deliberate settle waits, which comfortably exceeds Playwright's
  // default 30s per-test timeout — raise it so the run isn't killed mid-sequence.
  timeout: 120000,
  // The capture spec drives a heavy populated layout (Monaco + a live browser
  // iframe). The E2E config records a trace + video + auto-screenshots for every
  // test; doing that here adds enough main-thread/IO overhead to starve
  // Playwright's in-page actionability polling, causing sporadic 30s timeouts on
  // otherwise-ready elements. None of it is useful for generating showcase PNGs.
  use: {
    ...baseConfig.use,
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
};
