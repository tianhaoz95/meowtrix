const { test, expect } = require('@playwright/test');

test.describe('Meowtrix E2E Tests', () => {
  test.beforeEach(async ({ page, request }) => {
    // Reset settings to default before each test run
    await request.post('/api/settings/reset');
    // Reset layout state to a clean slate before each test run
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
    // Inject mock for LanguageModel/Prompt API to enable chat pet in settings
    await page.addInitScript(() => {
      // Mock the browser Prompt API for Gemini Nano
      window.LanguageModel = {
        availability: async () => 'available'
      };
      
      // Also mock window.ai / window.model if any other files check it
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
  });

  test('should load with correct title and logo', async ({ page }) => {
    // Check page title
    await expect(page).toHaveTitle(/Meowtrix/);

    // Verify logo is visible
    const logoText = page.locator('#logo-text');
    await expect(logoText).toContainText('Meowtrix');
  });

  test('should split and close panes', async ({ page }) => {
    const paneLocator = page.locator('.pane');
    
    // Initially, there should be exactly 1 pane
    await expect(paneLocator).toHaveCount(1);

    // Click vertical split button
    await page.locator('#btn-split-v').click();
    // Wait and verify we have 2 panes
    await expect(paneLocator).toHaveCount(2);

    // Click horizontal split button
    await page.locator('#btn-split-h').click();
    // Wait and verify we have 3 panes
    await expect(paneLocator).toHaveCount(3);

    // Close the active pane
    await page.locator('#btn-close-pane').click();
    // Verify count goes down to 2
    await expect(paneLocator).toHaveCount(2);

    // Close the active pane again
    await page.locator('#btn-close-pane').click();
    // Verify count goes back to 1
    await expect(paneLocator).toHaveCount(1);
  });

  test('should support creating different types of tabs via picker', async ({ page }) => {
    const addBtn = page.locator('.tab-add').first();
    const tabLocator = page.locator('.tab');

    // 1. Create Terminal Tab
    await addBtn.click();
    const picker = page.locator('.tab-type-picker');
    await expect(picker).toBeVisible();

    // Select Terminal
    await picker.locator('button:has-text("Terminal")').click();
    await expect(picker).not.toBeVisible();
    
    // Check tab list contains a new terminal tab (denoted by standard xterm classes or content)
    await expect(tabLocator).toContainText(['Terminal']);

    // 2. Create Browser Tab
    await addBtn.click();
    await expect(picker).toBeVisible();
    await picker.locator('button:has-text("Browser")').click();
    await expect(picker).not.toBeVisible();

    // Check we have browser tab and an iframe navigation bar is loaded
    await expect(tabLocator).toContainText(['Terminal', 'New Tab']);
    const browserUrlInput = page.locator('input.browser-url').first();
    await expect(browserUrlInput).toBeVisible();

    // 3. Create Code Editor Tab
    await addBtn.click();
    await expect(picker).toBeVisible();
    await picker.locator('button:has-text("Code editor")').click();
    await expect(picker).not.toBeVisible();

    // Check that folder prompt dialog is visible
    const folderPrompt = page.locator('.folder-prompt-overlay');
    await expect(folderPrompt).toBeVisible();

    // Enter a workspace path and confirm
    await folderPrompt.locator('.folder-prompt-input').fill('/workspace');
    await folderPrompt.locator('button:has-text("Open")').click();

    // Verify it closed and code tab was created
    await expect(folderPrompt).not.toBeVisible();
    await expect(tabLocator).toContainText(['Terminal', 'New Tab', 'workspace']);
  });

  test('should configure settings, themes, and pet companion', async ({ page }) => {
    const settingsPanel = page.locator('#settings-panel');
    
    // Open settings panel
    await page.locator('#btn-settings').click();
    await expect(settingsPanel).toBeVisible();

    // 1. Toggle Chat Pet
    const petCheckbox = page.locator('#s-pet');
    const petElement = page.locator('#pet');

    // Store initial checked state
    const isChecked = await petCheckbox.isChecked();
    
    if (isChecked) {
      // Toggle off
      await petCheckbox.click();
      await expect(petElement).not.toBeVisible();
      // Toggle back on
      await petCheckbox.click();
      await expect(petElement).toBeVisible();
    } else {
      // Toggle on
      await petCheckbox.click();
      await expect(petElement).toBeVisible();
      // Toggle back off
      await petCheckbox.click();
      await expect(petElement).not.toBeVisible();
    }

    // 2. Switch theme and verify DOM updates
    const themeSelect = page.locator('#s-theme');
    const htmlElement = page.locator('html');

    // Switch to Light (Daylight)
    await themeSelect.selectOption('light');
    await expect(htmlElement).toHaveAttribute('data-theme', 'light');

    // Switch to Ocean
    await themeSelect.selectOption('ocean');
    await expect(htmlElement).toHaveAttribute('data-theme', 'ocean');

    // Switch to Matrix
    await themeSelect.selectOption('matrix');
    await expect(htmlElement).toHaveAttribute('data-theme', 'matrix');

    // Switch back to Midnight (dark)
    await themeSelect.selectOption('dark');
    await expect(htmlElement).toHaveAttribute('data-theme', 'dark');

    // Switch to Auto and verify it resolves to either dark or light
    await themeSelect.selectOption('auto');
    const resolvedTheme = await htmlElement.getAttribute('data-theme');
    expect(['dark', 'light']).toContain(resolvedTheme);

    // Close settings
    await page.locator('#settings-close').click();
    await expect(settingsPanel).not.toBeVisible();
  });

  test('should control app commands via the keyboard command palette', async ({ page }) => {
    const btnPalette = page.locator('#btn-palette');
    const paletteOverlay = page.locator('#palette-overlay');
    const paletteInput = page.locator('#palette-input');
    const tabLocator = page.locator('.tab');

    // Open palette
    await btnPalette.click();
    await expect(paletteOverlay).toBeVisible();

    // Search and run 'New terminal tab'
    await paletteInput.fill('New terminal tab');
    await expect(page.locator('.palette-item.active')).toContainText('New terminal tab');
    await page.keyboard.press('Enter');

    // Verify palette closed and tab was added
    await expect(paletteOverlay).not.toBeVisible();
    await expect(tabLocator).toContainText(['Terminal']);

    // Open palette again and run vertical split
    await btnPalette.click();
    await expect(paletteOverlay).toBeVisible();
    await paletteInput.fill('Split pane vertically');
    await expect(page.locator('.palette-item.active')).toContainText('Split pane vertically');
    await page.keyboard.press('Enter');

    // Verify layout is split into two panes
    await expect(paletteOverlay).not.toBeVisible();
    await expect(page.locator('.pane')).toHaveCount(2);
  });

  test('should customize top menu bar button groups visibility', async ({ page }) => {
    // Open settings panel
    await page.locator('#btn-settings').click();
    await expect(page.locator('#settings-panel')).toBeVisible();

    const workspaceGroup = page.locator('#grp-workspace');
    const paneGroup = page.locator('#grp-pane');
    const systemGroup = page.locator('#grp-system');
    const settingsGroup = page.locator('#grp-settings');
    
    // Initially they should be visible
    await expect(workspaceGroup).toBeVisible();
    await expect(paneGroup).toBeVisible();
    await expect(systemGroup).toBeVisible();
    await expect(settingsGroup).toBeVisible();

    // Toggle Workspace buttons off
    const wsCheckbox = page.locator('#s-menu-workspace');
    await wsCheckbox.click();
    await expect(workspaceGroup).not.toBeVisible();

    // Toggle Pane buttons off
    const paneCheckbox = page.locator('#s-menu-pane');
    await paneCheckbox.click();
    await expect(paneGroup).not.toBeVisible();

    // Toggle System actions off (should hide grp-system but NOT grp-settings)
    const systemCheckbox = page.locator('#s-menu-system');
    await systemCheckbox.click();
    await expect(systemGroup).not.toBeVisible();
    await expect(settingsGroup).toBeVisible(); // Excluded from system actions, cannot be disabled

    // Toggle them back on
    await wsCheckbox.click();
    await paneCheckbox.click();
    await systemCheckbox.click();
    await expect(workspaceGroup).toBeVisible();
    await expect(paneGroup).toBeVisible();
    await expect(systemGroup).toBeVisible();
    await expect(settingsGroup).toBeVisible();

    // Close settings
    await page.locator('#settings-close').click();
  });

  test('settings button should never be disabled, even when session is inactive', async ({ page, context }) => {
    // Open a second page to hijack the session and make the first page inactive
    const page2 = await context.newPage();
    await page2.goto('/');
    
    // The second page will claim the active session. Wait for page 2 to load.
    const takeoverBtn = page2.locator('#btn-takeover');
    if (await takeoverBtn.isVisible()) {
      await takeoverBtn.click();
    }
    await expect(page2.locator('#workspace')).toBeVisible();

    // Now verify the first page shows the inactive overlay
    await expect(page.locator('#inactive-overlay')).toBeVisible();

    // The settings button on the first page should still be clickable and open settings
    const settingsPanel = page.locator('#settings-panel');
    await expect(settingsPanel).not.toBeVisible();
    await page.locator('#btn-settings').click();
    await expect(settingsPanel).toBeVisible();

    // Clean up settings panel
    await page.locator('#settings-close').click();
    await expect(settingsPanel).not.toBeVisible();
  });

  test('should auto-collapse toolbar buttons on narrow viewport', async ({ page }) => {
    const htmlElement = page.locator('html');
    await expect(htmlElement).not.toHaveClass(/mobile-ui/);

    // Resize viewport to narrow width where buttons don't fit
    await page.setViewportSize({ width: 500, height: 720 });

    // Should collapse and add mobile-ui class
    await expect(htmlElement).toHaveClass(/mobile-ui/);
    await expect(page.locator('#btn-menu')).toBeVisible();
    await expect(page.locator('#toolbar-group-extra')).not.toBeVisible();

    // Click menu button to open dropdown
    await page.locator('#btn-menu').click();
    const dropdown = page.locator('#toolbar-group-extra');
    await expect(dropdown).toBeVisible();

    // Click header to expand group in mobile accordion
    await page.locator('#grp-workspace .group-header').click();

    // Verify layout: button group should not be collapsed to desktop height (32px)
    const grpWorkspace = page.locator('#grp-workspace');
    const box = await grpWorkspace.boundingBox();
    expect(box.height).toBeGreaterThan(50);

    // Click outside or menu button again to close
    await page.locator('#btn-menu').click();
    await expect(dropdown).not.toBeVisible();

    // Resize viewport back to wide
    await page.setViewportSize({ width: 1920, height: 1080 });

    // Should restore desktop view
    await expect(htmlElement).not.toHaveClass(/mobile-ui/);
    await expect(page.locator('#btn-menu')).not.toBeVisible();
    await expect(page.locator('#toolbar-group-extra')).toBeVisible();
  });

  test('should allow collapsing and expanding the mobile utility key bar', async ({ page }) => {
    // 1. Force mobile ui by making viewport narrow
    await page.setViewportSize({ width: 500, height: 720 });

    // 2. Open a terminal tab to ensure we can focus it and show the keybar
    const addBtn = page.locator('.tab-add').first();
    await addBtn.click();
    await page.locator('.tab-type-picker button:has-text("Terminal")').click();
    
    // 3. Focus the terminal's hidden helper textarea to display the mobile-keybar
    const terminalTextarea = page.locator('.xterm-helper-textarea').first();
    await terminalTextarea.focus();
    
    const keybar = page.locator('#mobile-keybar');
    await expect(keybar).toBeVisible();

    // 4. Verify collapse button exists
    const toggleBtn = page.locator('.keybar-toggle-collapse');
    await expect(toggleBtn).toBeVisible();
    await expect(toggleBtn).toHaveText('▼');

    // 5. Click the toggle button to collapse the utility key bar
    await toggleBtn.click();
    await expect(keybar).toHaveClass(/collapsed/);
    await expect(toggleBtn).toHaveText('📱');

    // Verify other buttons are hidden
    const escBtn = page.locator('.keybar-btn:has-text("Esc")');
    await expect(escBtn).not.toBeVisible();

    // 6. Click again to expand
    await toggleBtn.click();
    await expect(keybar).not.toHaveClass(/collapsed/);
    await expect(toggleBtn).toHaveText('▼');
    await expect(escBtn).toBeVisible();
  });
});
