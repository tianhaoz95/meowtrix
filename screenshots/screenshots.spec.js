const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Generate Showcase Screenshots', () => {
  test.beforeAll(async ({ request }) => {
    // Reset settings to default before screenshots run
    await request.post('/api/settings/reset');
    // Reset layout state to a clean slate before screenshots run
    await request.post('/api/session', {
      data: {
        workspaces: [
          { name: 'Workspace 1', layout: null },
          { name: 'Workspace 2', layout: null },
          { name: 'Workspace 3', layout: null },
          { name: 'Workspace 4', layout: null }
        ],
        activeWorkspaceIndex: 0
      }
    });
  });

  test('capture light and dark theme screenshots', async ({ page }) => {
    // Set a high-quality standard desktop resolution. Width must comfortably fit
    // the full toolbar (its button row grows past ~1740px with the editor/terminal
    // panes open); a narrower viewport overflows it, pushing the right-side controls
    // (incl. #btn-settings) off-screen where they can't be screenshotted cleanly.
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Inject mock for LanguageModel/Prompt API to enable chat pet in settings
    await page.addInitScript(() => {
      window.LanguageModel = {
        availability: async () => 'available'
      };
      if (!window.ai) {
        window.ai = {
          languageModel: {
            availability: async () => 'readily'
          }
        };
      }
    });

    // Open the app page
    await page.goto('/');

    // Check if the inactive session overlay appears and claim the session
    const takeoverBtn = page.locator('#btn-takeover');
    try {
      await takeoverBtn.waitFor({ state: 'visible', timeout: 1500 });
      await takeoverBtn.click();
    } catch (e) {}

    // Wait for the workspace to be visible and ready
    await expect(page.locator('#workspace')).toBeVisible();

    // Disable CSS transitions/animations for the rest of the capture. Under the
    // heavy populated layout (Monaco + a loaded browser iframe) the settings
    // panel's open/close transition can freeze at its off-screen start state,
    // so the panel never actually slides in. Snapping state changes also makes
    // the captured screenshots crisp instead of caught mid-animation.
    await page.addStyleTag({
      content: '*, *::before, *::after { transition: none !important; animation: none !important; }',
    });

    // 1. Split Pane Vertically -> Pane A (left) and Pane B (right, active)
    await page.locator('#btn-split-v').click();
    await expect(page.locator('.pane')).toHaveCount(2);

    // 2. Split Pane B (right, active) Horizontally -> Pane B (top-right) and Pane C (bottom-right, active)
    await page.locator('#btn-split-h').click();
    await expect(page.locator('.pane')).toHaveCount(3);

    // 3. Set up Code Editor in Left Pane (Pane A, index 0)
    const pane0 = page.locator('.pane').nth(0);
    await pane0.click(); // Focus Pane A
    await pane0.locator('.tab-add').click();
    
    const picker = page.locator('.tab-type-picker');
    await expect(picker).toBeVisible();
    await picker.locator('button:has-text("Code editor")').click();
    await expect(picker).not.toBeVisible();

    // Fill in directory and open
    const folderPrompt = page.locator('.folder-prompt-overlay');
    await expect(folderPrompt).toBeVisible();
    await folderPrompt.locator('.folder-prompt-input').fill('/workspace');
    await folderPrompt.locator('button:has-text("Open")').click();
    await expect(folderPrompt).not.toBeVisible();

    // Wait for files to load in the sidebar and open server.js
    const serverJsRow = page.locator('.editor-tree-row.is-file').filter({ hasText: 'server.js' }).first();
    await expect(serverJsRow).toBeVisible({ timeout: 10000 });
    await serverJsRow.click();
    
    // Wait for Monaco editor to finish loading and taking initial focus
    await page.waitForTimeout(3000);
    
    // 4. Focus Top Right Pane (Pane B, index 1) and run a command in the terminal
    const pane1 = page.locator('.pane').nth(1);
    const terminalScreen = pane1.locator('.xterm-screen');
    await expect(terminalScreen).toBeVisible();
    await terminalScreen.click();

    const terminalTextarea = pane1.locator('textarea.xterm-helper-textarea');
    await expect(terminalTextarea).toBeVisible();
    await terminalTextarea.focus();
    // Wait for terminal prompt to be active
    await page.waitForTimeout(1000);
    // Run `git status` to show a realistic terminal state
    await page.keyboard.type('git status');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1500); // Wait for command output to render

    // 5. Focus Bottom Right Pane (Pane C, index 2) and open the Embedded Browser
    const pane2 = page.locator('.pane').nth(2);
    await pane2.click();
    await pane2.locator('.tab-add').click();
    await expect(picker).toBeVisible();
    await picker.locator('button:has-text("Browser")').click();
    await expect(picker).not.toBeVisible();

    // Navigate to DuckDuckGo for the browser preview demo
    const browserUrlInput = pane2.locator('input.browser-url');
    await expect(browserUrlInput).toBeVisible();
    await browserUrlInput.click();
    await browserUrlInput.fill('');
    await page.keyboard.type('http://duckduckgo.com');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000); // Wait for browser iframe to load

    // Verify that the input field value and iframe src updated correctly
    await expect(browserUrlInput).toHaveValue('http://duckduckgo.com');
    const iframe = pane2.locator('iframe.browser-frame');
    await expect(iframe).toHaveAttribute('src', /\/proxy\/http\/duckduckgo.com/);

    // The demo page is taller than its pane, so the proxied document renders its
    // own vertical scrollbar — which looks unpolished in the capture. The proxy
    // serves same-origin content, so we can reach into the iframe's document and
    // hide the scrollbar (content stays scrollable, the bar just isn't painted).
    const hideIframeScrollbars = async () => {
      const handle = await pane2.locator('iframe.browser-frame').elementHandle();
      const frame = handle && (await handle.contentFrame());
      if (frame) {
        await frame.addStyleTag({
          content:
            'html{scrollbar-width:none!important;-ms-overflow-style:none!important;}' +
            '::-webkit-scrollbar{width:0!important;height:0!important;display:none!important;}',
        }).catch(() => {});
      }
    };
    await hideIframeScrollbars();

    // 6. Disable Chat Pet companion in settings for a clean workspace layout.
    // Open via the global openSettings() rather than clicking #btn-settings: with
    // every pane populated the toolbar's button row can grow wider than the viewport,
    // leaving the settings button off-screen and unclickable. (The button click
    // itself is covered by the functional suite in tests/meowtrix.spec.js.)
    await page.evaluate(() => openSettings());
    const settingsPanel = page.locator('#settings-panel');
    await expect(settingsPanel).toBeVisible();

    const petCheckbox = page.locator('#s-pet');
    if (await petCheckbox.isChecked()) {
      await petCheckbox.click();
    }
    
    // Ensure we start with Midnight (dark) theme for the dark screenshot
    const themeSelect = page.locator('#s-theme');
    await themeSelect.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // Close settings
    await page.locator('#settings-close').click();
    await expect(settingsPanel).not.toBeVisible();
    await expect(page.locator('#pet')).not.toBeVisible();

    // Wait slightly to ensure everything is settled
    await page.waitForTimeout(2000);

    // Save Dark Theme Screenshot
    await hideIframeScrollbars();
    const screenshotDarkPath = path.resolve(__dirname, '../website/assets/screenshot-dark.png');
    await page.screenshot({ path: screenshotDarkPath });
    console.log(`Saved dark theme screenshot to ${screenshotDarkPath}`);

    // 7. Toggle to Light Theme (Daylight)
    await page.evaluate(() => openSettings());
    await expect(settingsPanel).toBeVisible();
    await themeSelect.selectOption('light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Close settings again
    await page.locator('#settings-close').click();
    await expect(settingsPanel).not.toBeVisible();

    // Wait slightly to ensure light theme styling settled
    await page.waitForTimeout(2000);

    // Save Light Theme Screenshot
    await hideIframeScrollbars();
    const screenshotLightPath = path.resolve(__dirname, '../website/assets/screenshot-light.png');
    await page.screenshot({ path: screenshotLightPath });
    console.log(`Saved light theme screenshot to ${screenshotLightPath}`);

    // 8. Mobile screenshots. Maximize the terminal pane and drop to a phone
    // viewport so the capture is a single, full-bleed pane in the app's mobile
    // layout — far cleaner inside the landing page's phone frame than the 3-pane
    // desktop split squeezed onto a narrow screen. The terminal already shows
    // `git status` output from step 4, which reads well on a phone.
    await pane1.click(); // focus the top-right terminal pane
    await page.evaluate(() => { if (typeof activePane !== 'undefined' && activePane) toggleMaximizePane(activePane); });
    // A phone viewport (~iPhone 12/13/14 logical size). Width <= 640 trips the
    // app's mobile detection, which toggles `mobile-ui` and reflows for touch.
    await page.setViewportSize({ width: 390, height: 844 });
    // Let the mobile reflow run and the terminal refit/reflow to the new width.
    await page.waitForTimeout(2000);

    // Currently on Light theme — capture mobile light first.
    const screenshotMobileLightPath = path.resolve(__dirname, '../website/assets/screenshot-mobile-light.png');
    await page.screenshot({ path: screenshotMobileLightPath });
    console.log(`Saved mobile light theme screenshot to ${screenshotMobileLightPath}`);

    // Switch to Dark theme and capture mobile dark.
    await page.evaluate(() => openSettings());
    await expect(settingsPanel).toBeVisible();
    await themeSelect.selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.locator('#settings-close').click();
    await expect(settingsPanel).not.toBeVisible();
    await page.waitForTimeout(2000);

    const screenshotMobileDarkPath = path.resolve(__dirname, '../website/assets/screenshot-mobile-dark.png');
    await page.screenshot({ path: screenshotMobileDarkPath });
    console.log(`Saved mobile dark theme screenshot to ${screenshotMobileDarkPath}`);
  });
});
