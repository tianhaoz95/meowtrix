const { defineConfig, devices } = require('@playwright/test');

/**
 * See https://playwright.dev/docs/test-configuration.
 */
module.exports = defineConfig({
  // E2E suite only. The showcase screenshot capture lives in ./screenshots and is
  // run separately via playwright.screenshots.config.js (`npm run screenshots`), so
  // it is deliberately kept out of testDir and never runs in the CI E2E job.
  testDir: './tests',
  /* Run tests sequentially to avoid layout/session state conflicts on a single server */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Limit workers to 1 to prevent multiple browser instances from fighting over session */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env.BASE_URL || 'http://localhost:9234',

    /* Always collect trace for all tests. See https://playwright.dev/docs/trace-viewer */
    trace: 'on',
    
    /* Always capture screenshots for all tests */
    screenshot: 'on',

    /* Always record video for all tests */
    video: 'on',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 }
      },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1920, height: 1080 }
      },
    },
    {
      name: 'webkit',
      use: {
        ...devices['Desktop Safari'],
        viewport: { width: 1920, height: 1080 }
      },
    },
  ],

  /* Run Docker server on port 9234 before starting the tests if BASE_URL is not specified */
  webServer: process.env.BASE_URL ? undefined : {
    command: 'PORT=9234 NO_OPEN=1 ./docker-run.sh',
    url: 'http://localhost:9234',
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
    timeout: 90000, // Give Docker build/up some extra time
  },
});
