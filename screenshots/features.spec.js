const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

/**
 * Animated showcase capture for the website's Features page.
 *
 * Mirrors the still-screenshot capture (screenshots.spec.js) but records a short
 * screen recording per feature and converts each to an optimized GIF under
 * website/assets/features/. Run via `npm run gifs` (wired into
 * preview-website.sh --capture). Like the screenshots spec, this lives outside
 * ./tests so the CI E2E suite never picks it up.
 *
 * Each feature is captured in BOTH the dark (Midnight) and light (Daylight)
 * themes, producing `<name>-dark.gif` and `<name>-light.gif`. The Features page
 * shows whichever matches the page theme — same approach as the landing page's
 * paired light/dark screenshots.
 *
 * Each capture gets its own fresh browser context with Playwright video
 * recording enabled. The webm is converted to a GIF with ffmpeg (palettegen +
 * paletteuse for clean colors). ffmpeg must be on PATH.
 */

const GIF_DIR = path.resolve(__dirname, '../website/assets/features');
// Match the still-screenshot capture's viewport. Below ~1740px the toolbar no
// longer fits and the app collapses its controls into the mobile ☰ menu (the
// toolbar-fit measurement that drives mobile detection), which hides the
// split/schedule buttons this capture clicks. 1920×1080 keeps the full desktop
// toolbar visible; GIF_WIDTH scales the output down to a web-friendly size.
const VIEWPORT = { width: 1920, height: 1080 };
// GIF output knobs: a modest frame rate and width keep file sizes web-friendly
// while staying smooth enough to read the interactions.
const GIF_FPS = 11;
const GIF_WIDTH = 840;

function ensureGifDir() {
  fs.mkdirSync(GIF_DIR, { recursive: true });
}

// Convert a recorded webm to an optimized, looping GIF. Two-pass palette
// (palettegen → paletteuse) gives far cleaner color than ffmpeg's default
// single-pass quantization.
function convertToGif(input, output) {
  const vf =
    `fps=${GIF_FPS},scale=${GIF_WIDTH}:-1:flags=lanczos,split[s0][s1];` +
    `[s0]palettegen=max_colors=160:stats_mode=diff[p];` +
    `[s1][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`;
  execFileSync('ffmpeg', ['-y', '-i', input, '-vf', vf, '-loop', '0', output], {
    stdio: 'inherit',
  });
}

// The two themes every feature is captured in. The Features page swaps between
// the resulting GIFs based on its own theme (html[data-theme] + .theme-* CSS).
const THEME_VARIANTS = ['dark', 'light'];

// Spin up a fresh recorded page in the given theme, run the scenario, then
// convert the recording to website/assets/features/<name>-<theme>.gif.
async function captureFeature(browser, name, theme, scenario) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mtx-gif-'));
  const context = await browser.newContext({
    viewport: VIEWPORT,
    recordVideo: { dir: tmpDir, size: VIEWPORT },
  });
  // Mock the on-device LanguageModel API so nothing in the UI gates on it.
  await context.addInitScript(() => {
    window.LanguageModel = { availability: async () => 'available' };
    if (!window.ai) {
      window.ai = { languageModel: { availability: async () => 'readily' } };
    }
  });

  // Reset server state to a clean slate before each feature. The previous
  // feature's layout gets persisted to the host's session.json, so without this
  // a later feature would restore the prior one's panes/tabs instead of a fresh
  // single-terminal workspace — making the capture (and its assertions) flaky.
  await context.request.post('/api/settings/reset');
  // Keystroke Combo FX is opt-in (off by default), so keep it off in the
  // captures too — set it explicitly rather than relying on the server's
  // default, so the recordings stay clean even against an older server build.
  await context.request.post('/api/settings', { data: { comboFx: false } });
  await context.request.post('/api/session', {
    data: {
      workspaces: [
        { name: 'Workspace 1', layout: null },
        { name: 'Workspace 2', layout: null },
        { name: 'Workspace 3', layout: null },
        { name: 'Workspace 4', layout: null },
      ],
      activeWorkspaceIndex: 0,
    },
  });

  const page = await context.newPage();
  await page.goto('/');

  // This fresh context is the newest client; claim the session if prompted.
  const takeoverBtn = page.locator('#btn-takeover');
  try {
    await takeoverBtn.waitFor({ state: 'visible', timeout: 2000 });
    await takeoverBtn.click();
  } catch (e) {}

  await expect(page.locator('#workspace')).toBeVisible();
  // Apply the requested theme so the recording matches the variant being saved.
  await page.evaluate((t) => setTheme(t), theme);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  // Snap animations off so each GIF frame is crisp rather than caught mid-tween.
  await page.addStyleTag({
    content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
  });
  // Settle on the loaded workspace for a beat before the action starts.
  await page.waitForTimeout(700);

  await scenario(page, theme);

  // Hold the final state so the GIF lingers on the result before it loops.
  await page.waitForTimeout(1200);

  const video = page.video();
  await context.close(); // finalizes the webm
  const webm = await video.path();
  const fileName = `${name}-${theme}.gif`;
  convertToGif(webm, path.join(GIF_DIR, fileName));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`Saved feature GIF: ${fileName}`);
}

// Focus the terminal in the given pane and return its input textarea locator.
async function focusTerminal(page, pane) {
  const screen = pane.locator('.xterm-screen');
  await expect(screen).toBeVisible();
  await screen.click();
  const textarea = pane.locator('textarea.xterm-helper-textarea');
  await textarea.focus();
  await page.waitForTimeout(500);
}

test.describe('Generate Feature Showcase GIFs', () => {
  test.beforeAll(async ({ request }) => {
    ensureGifDir();
    // Clean slate: default settings + a single empty workspace.
    await request.post('/api/settings/reset');
    await request.post('/api/session', {
      data: {
        workspaces: [
          { name: 'Workspace 1', layout: null },
          { name: 'Workspace 2', layout: null },
          { name: 'Workspace 3', layout: null },
          { name: 'Workspace 4', layout: null },
        ],
        activeWorkspaceIndex: 0,
      },
    });
  });

  // Each feature is captured once per theme variant. The `run(page, theme)`
  // scenario drives the actual interaction; `theme` is only used by features
  // that care about it (e.g. the theme cycler ends on the variant's theme).
  const FEATURES = [
    {
      name: 'tiling-panes',
      run: async (page) => {
        await page.locator('#btn-split-v').click();
        await expect(page.locator('.pane')).toHaveCount(2);
        await page.waitForTimeout(800);
        await page.locator('#btn-split-h').click();
        await expect(page.locator('.pane')).toHaveCount(3);
        await page.waitForTimeout(900);
        // Drag the first divider to show live, proportional resizing.
        const divider = page.locator('.split-divider').first();
        const box = await divider.boundingBox();
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await page.mouse.move(cx, cy);
          await page.mouse.down();
          await page.mouse.move(cx - 160, cy, { steps: 24 });
          await page.mouse.move(cx + 80, cy, { steps: 18 });
          await page.mouse.up();
        }
        await page.waitForTimeout(600);
      },
    },
    {
      name: 'terminal',
      run: async (page) => {
        const pane = page.locator('.pane').first();
        await focusTerminal(page, pane);
        await page.keyboard.type('echo "🐾 hello from meowtrix" && ls', { delay: 55 });
        await page.waitForTimeout(500);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
        await page.keyboard.type('git status', { delay: 55 });
        await page.waitForTimeout(400);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(1500);
      },
    },
    {
      name: 'embedded-browser',
      run: async (page) => {
        const pane = page.locator('.pane').first();
        await pane.locator('.tab-add').click();
        const picker = page.locator('.tab-type-picker');
        await expect(picker).toBeVisible();
        await picker.locator('button:has-text("Browser")').click();
        await expect(picker).not.toBeVisible();

        const urlInput = pane.locator('input.browser-url');
        await expect(urlInput).toBeVisible();
        await urlInput.click();
        await urlInput.fill('');
        await page.keyboard.type('http://duckduckgo.com', { delay: 45 });
        await page.waitForTimeout(300);
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3800);
      },
    },
    {
      name: 'code-editor',
      run: async (page) => {
        const pane = page.locator('.pane').first();
        await pane.locator('.tab-add').click();
        const picker = page.locator('.tab-type-picker');
        await expect(picker).toBeVisible();
        await picker.locator('button:has-text("Code editor")').click();
        await expect(picker).not.toBeVisible();

        const folderPrompt = page.locator('.folder-prompt-overlay');
        await expect(folderPrompt).toBeVisible();
        await folderPrompt.locator('.folder-prompt-input').fill('/workspace');
        await folderPrompt.locator('button:has-text("Open")').click();
        await expect(folderPrompt).not.toBeVisible();

        const serverJsRow = page
          .locator('.editor-tree-row.is-file')
          .filter({ hasText: 'server.js' })
          .first();
        await expect(serverJsRow).toBeVisible({ timeout: 10000 });
        await page.waitForTimeout(600);
        await serverJsRow.click();
        // Let Monaco load and paint the file.
        await page.waitForTimeout(3000);
        // Open a second file to show the tree + per-file tabs in motion.
        const readmeRow = page
          .locator('.editor-tree-row.is-file')
          .filter({ hasText: 'package.json' })
          .first();
        if (await readmeRow.count()) {
          await readmeRow.click();
          await page.waitForTimeout(2000);
        }
      },
    },
    {
      name: 'command-palette',
      run: async (page) => {
        await page.locator('#btn-palette').click();
        const input = page.locator('#palette-input');
        await expect(input).toBeVisible();
        await input.click();
        await page.waitForTimeout(500);
        // pressSequentially types into the focused input (vs. global keyboard),
        // so no characters are dropped if focus hasn't fully settled.
        await input.pressSequentially('split', { delay: 95 });
        const splitItem = page.locator('.palette-item').filter({ hasText: 'Split' }).first();
        await expect(splitItem).toBeVisible();
        await page.waitForTimeout(1100);
        await splitItem.click();
        await expect(page.locator('.pane')).toHaveCount(2);
        await page.waitForTimeout(900);
      },
    },
    {
      name: 'scheduled-enter',
      run: async (page) => {
        const pane = page.locator('.pane').first();
        // Queue the command that will fire later, then open the schedule dialog.
        await focusTerminal(page, pane);
        await page.keyboard.type('claude "continue the task"', { delay: 45 });
        await page.waitForTimeout(700);

        await page.locator('#btn-schedule').click();
        await page.waitForTimeout(900);
        // Dial in a short delay so the preview updates on camera.
        const hours = page.locator('#sched-hours');
        await hours.click();
        await hours.fill('0');
        const mins = page.locator('#sched-mins');
        await mins.click();
        await mins.fill('30');
        await mins.blur();
        await page.waitForTimeout(1100);
        // Confirm — the terminal locks behind the blurred schedule overlay.
        await page.locator('#sched-confirm').click();
        await page.waitForTimeout(1600);
      },
    },
    {
      name: 'themes',
      run: async (page, theme) => {
        // Populate the terminal a little so the recolor has content to show.
        const pane = page.locator('.pane').first();
        await focusTerminal(page, pane);
        await page.keyboard.type('neofetch', { delay: 40 });
        await page.keyboard.press('Enter');
        await page.waitForTimeout(900);
        // Cycle through several themes, ending back on this variant's theme so
        // the final (held) frame matches the GIF the page shows for that theme.
        for (const t of ['ocean', 'matrix', 'ember', 'sakura', 'synthwave', theme]) {
          await page.evaluate((x) => setTheme(x), t);
          await page.waitForTimeout(950);
        }
      },
    },
  ];

  for (const feature of FEATURES) {
    for (const theme of THEME_VARIANTS) {
      test(`${feature.name} (${theme})`, async ({ browser }) => {
        await captureFeature(browser, feature.name, theme, feature.run);
      });
    }
  }
});
