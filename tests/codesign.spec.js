const { test, expect } = require('@playwright/test');

// CoDesign: an agent writes .codesign/spec.html, the human comments on it in a
// CoDesign tab and sends feedback / signs off, and a blocked `mtx review`
// (simulated here via /api/codesign/wait) receives the decision.
test.describe('CoDesign tab', () => {
  let proj;

  test.beforeEach(async ({ page, request }) => {
    await request.post('/api/settings/reset');
    await request.post('/api/session', {
      data: { workspaces: [{ name: 'Workspace 1', layout: null }], activeWorkspaceIndex: 0 },
    });

    // A fresh project folder on the server host (tests may run in Docker).
    const { home } = await (await request.get('/api/fs/home')).json();
    const name = `codesign-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    proj = `${home.replace(/\/$/, '')}/${name}`;
    expect((await request.post('/api/fs/create', { data: { path: home, name, type: 'dir' } })).ok()).toBeTruthy();

    await page.goto('/');
    const takeoverBtn = page.locator('#btn-takeover');
    try {
      await takeoverBtn.waitFor({ state: 'visible', timeout: 1500 });
      await takeoverBtn.click();
    } catch (e) {}
    await expect(page.locator('#workspace')).toBeVisible();
  });

  test('review loop: spec appears, comment pin, send feedback, sign off', async ({ page, request }) => {
    // Open a CoDesign tab via the tab-type picker.
    await page.locator('.tab-add').first().click();
    await page.locator('.tab-type-picker button:has-text("CoDesign")').click();
    const folderPrompt = page.locator('.folder-prompt-overlay');
    await folderPrompt.locator('.folder-prompt-input').fill(proj);
    await folderPrompt.locator('button:has-text("Open")').click();

    const view = page.locator('.pane-view.codesign-view.active');
    await expect(view).toBeVisible();
    await expect(view.locator('.cd-empty-state')).toContainText('Waiting for a design spec');
    await expect(view.locator('.cd-status')).toHaveText('Waiting for spec');

    // The "agent" writes the spec; the tab picks it up from the file watcher.
    const specFile = `${proj}/.codesign/spec.html`;
    await request.post('/api/fs/create', { data: { path: proj, name: '.codesign/spec.html', type: 'file' } });
    const html = `<!doctype html><html><head><title>Spec</title>
      <style>body{margin:0;font-family:sans-serif}.hero{padding:40px}.badge{display:inline-block;padding:6px 12px;background:#e11d48;color:#fff}</style></head>
      <body><div class="hero"><h1 id="headline">Hello</h1><span class="badge">New</span></div>
      <script>try { localStorage.setItem('x', '1'); document.body.dataset.storage = 'yes'; } catch (e) { document.body.dataset.storage = 'blocked'; }</script></body></html>`;
    await request.put(`/api/fs/write?path=${encodeURIComponent(specFile)}`, { data: html, headers: { 'Content-Type': 'text/plain' } });

    await expect(view.locator('.cd-status')).toHaveText('Ready for review', { timeout: 10000 });
    await expect(view.locator('.cd-rev')).toHaveText('Revision 1');
    const iframe = view.locator('iframe.codesign-iframe');
    await expect(iframe).toHaveAttribute('sandbox', /allow-scripts/);
    await expect(iframe).not.toHaveAttribute('sandbox', /allow-same-origin/);

    const spec = page.frameLocator('.pane-view.codesign-view.active iframe.codesign-iframe');
    await expect(spec.locator('.badge')).toBeVisible();
    // Sandboxed into an opaque origin: no storage, no access to Meowtrix.
    await expect(spec.locator('body')).toHaveAttribute('data-storage', 'blocked');

    // Comment mode is the default: clicking an element opens the composer.
    await spec.locator('.badge').click();
    const composer = view.locator('.codesign-composer');
    await expect(composer).toBeVisible();
    await expect(composer.locator('.cd-composer-target')).toContainText('badge');
    await composer.locator('textarea').fill('Make the badge smaller');
    await composer.locator('textarea').press('Enter');
    await expect(composer).toBeHidden();

    await expect(view.locator('.cd-comment.draft')).toContainText('Make the badge smaller');
    await expect(spec.locator('[data-codesign-ui] button', { hasText: '1' })).toBeVisible();
    const sendBtn = view.locator('.cd-send');
    await expect(sendBtn).toHaveText('Send feedback (1)');

    // A blocked `mtx review` receives the comments when feedback is sent.
    const waiting = request.get(`/api/codesign/wait?dir=${encodeURIComponent(proj)}&timeout=20`);
    await expect(view.locator('.cd-agent')).toBeVisible();
    await sendBtn.click();
    const res = await waiting;
    expect(res.headers()['x-codesign-event']).toBe('changes');
    const body = await res.json();
    expect(body.comments[0].comment).toBe('Make the badge smaller');
    expect(body.comments[0].selector).toContain('badge');
    await expect(view.locator('.cd-status')).toHaveText('Changes requested');
    await expect(view.locator('.cd-comment.sent')).toBeVisible();

    // The agent revises the spec → new revision, then the human signs off.
    await request.put(`/api/fs/write?path=${encodeURIComponent(specFile)}`, { data: html.replace('Hello', 'Hello again'), headers: { 'Content-Type': 'text/plain' } });
    await expect(view.locator('.cd-rev')).toHaveText('Revision 2', { timeout: 10000 });
    await expect(spec.locator('#headline')).toHaveText('Hello again');
    await view.locator('.cd-approve').click();
    await expect(view.locator('.cd-status')).toHaveText('Approved');
    await expect(view.locator('.cd-approve')).toHaveText('Signed off ✓');

    const approved = await request.get(`/api/codesign/wait?dir=${encodeURIComponent(proj)}&timeout=2`);
    expect(approved.headers()['x-codesign-event']).toBe('approved');
  });

  test('inspect mode shows the computed-style HUD', async ({ page, request }) => {
    await request.post('/api/fs/create', { data: { path: proj, name: '.codesign/spec.html', type: 'file' } });
    await request.put(`/api/fs/write?path=${encodeURIComponent(`${proj}/.codesign/spec.html`)}`, {
      data: '<!doctype html><html><head></head><body><h1 style="font-size:40px">Title</h1></body></html>',
      headers: { 'Content-Type': 'text/plain' },
    });
    // `mtx spec` / `mtx review` ask the active session to open the tab.
    await request.post('/api/codesign/open', { data: { dir: proj } });
    const view = page.locator('.pane-view.codesign-view.active');
    await expect(view).toBeVisible();

    await view.locator('[data-mode="inspect"]').click();
    const spec = page.frameLocator('.pane-view.codesign-view.active iframe.codesign-iframe');
    await spec.locator('h1').hover();
    await expect(spec.locator('[data-codesign-ui]', { hasText: 'font' }).first()).toContainText('40px');

    // Device presets resize the frame.
    await view.locator('[data-device="mobile"]').click();
    await expect(view.locator('.codesign-frame')).toHaveAttribute('style', /width:\s*390px/);
  });
});
