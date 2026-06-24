const { test, expect } = require('@playwright/test');

test.describe('Meowtrix E2E Tests', () => {
  test.beforeAll(async ({ request }) => {
    // Reset layout state to a clean slate before any tests run
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

  test.beforeEach(async ({ page }) => {
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
    if (await takeoverBtn.isVisible()) {
      await takeoverBtn.click();
    }

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
    await page.keyboard.press('Enter');

    // Verify palette closed and tab was added
    await expect(paletteOverlay).not.toBeVisible();
    await expect(tabLocator).toContainText(['Terminal']);

    // Open palette again and run vertical split
    await btnPalette.click();
    await expect(paletteOverlay).toBeVisible();
    await paletteInput.fill('Split pane vertically');
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
    
    // Initially they should be visible
    await expect(workspaceGroup).toBeVisible();
    await expect(paneGroup).toBeVisible();

    // Toggle Workspace buttons off
    const wsCheckbox = page.locator('#s-menu-workspace');
    await wsCheckbox.click();
    await expect(workspaceGroup).not.toBeVisible();

    // Toggle Pane buttons off
    const paneCheckbox = page.locator('#s-menu-pane');
    await paneCheckbox.click();
    await expect(paneGroup).not.toBeVisible();

    // Toggle them back on
    await wsCheckbox.click();
    await paneCheckbox.click();
    await expect(workspaceGroup).toBeVisible();
    await expect(paneGroup).toBeVisible();

    // Close settings
    await page.locator('#settings-close').click();
  });
});
