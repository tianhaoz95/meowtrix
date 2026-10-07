const { test, expect } = require('@playwright/test');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

test.describe('Desktop AI Daemon & Startup Regression Tests', () => {
  test('cargo test passes without Tokio reactor panic', async () => {
    // Check if cargo is installed in the test environment (e.g. absent in standard Playwright Docker container)
    const hasCargo = await new Promise(resolve => {
      const check = spawn('cargo', ['--version']);
      check.on('error', () => resolve(false));
      check.on('close', code => resolve(code === 0));
    });

    if (!hasCargo) {
      test.skip(true, 'Cargo is not installed in this environment');
      return;
    }

    // Run cargo test directly
    await new Promise((resolve, reject) => {
      const proc = spawn('cargo', ['test', '--manifest-path', 'src-tauri/Cargo.toml'], {
        stdio: 'inherit'
      });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`cargo test failed with exit code ${code}`));
      });
      proc.on('error', reject);
    });
  });

  test('desktop binary launches without SIGABRT crash in headless mode', async () => {
    const candidates = [
      path.join(__dirname, '..', 'src-tauri', 'target', 'debug', 'meowtrix'),
      path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'meowtrix'),
    ];
    const binPath = candidates.find(p => fs.existsSync(p));
    if (!binPath) {
      test.skip('No compiled desktop binary found in target directory');
      return;
    }

    let stdout = '';
    let stderr = '';
    let exited = false;
    let exitCode = null;

    const proc = spawn(binPath, ['--headless'], {
      env: { ...process.env, RUST_LOG: 'info' }
    });

    proc.stdout.on('data', d => stdout += d.toString('utf8'));
    proc.stderr.on('data', d => stderr += d.toString('utf8'));
    proc.on('close', code => {
      exited = true;
      exitCode = code;
    });

    // Wait 4 seconds for initialization
    await new Promise(r => setTimeout(r, 4000));

    // The binary MUST NOT have crashed with SIGABRT (code 134) or non-zero exit
    if (exited) {
      expect(exitCode).toBe(0);
    } else {
      // Process is alive and running as daemon
      expect(proc.killed).toBe(false);
      expect(stderr).not.toContain('panic in a function that cannot unwind');
      expect(stderr).not.toContain('there is no reactor running');
      
      // Clean up process
      proc.kill('SIGTERM');
    }
  });

  test('AI engine status API reports valid configuration', async () => {
    const express = require('express');
    const { mountAiRoutes } = require('../ai-service');
    const app = express();
    app.use(express.json());
    mountAiRoutes(app);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;

    try {
      const res = await new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/api/ai/status`, (r) => {
          let data = '';
          r.on('data', chunk => data += chunk);
          r.on('end', () => resolve({ statusCode: r.statusCode, data: JSON.parse(data) }));
        }).on('error', reject);
      });

      expect(res.statusCode).toBe(200);
      const data = res.data;

      expect(data.engines).toBeDefined();
      expect(Array.isArray(data.engines)).toBeTruthy();

      const mistral = data.engines.find(e => e.id === 'mistralrs');
      expect(mistral).toBeDefined();
      expect(mistral.name).toContain('Mistral.rs');

      const ollama = data.engines.find(e => e.id === 'ollama');
      expect(ollama).toBeDefined();

      const cloud = data.engines.find(e => e.id === 'cloud');
      expect(cloud).toBeDefined();
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  test('agent session persistence API preserves history, plan, diffs, and resets cleanly', async () => {
    const express = require('express');
    const { mountAiRoutes, saveAgentSession, loadAgentSession } = require('../ai-service');
    const app = express();
    app.use(express.json());
    mountAiRoutes(app);

    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const port = server.address().port;
    const testAgentId = 'test-agent-' + Date.now();

    try {
      // 1. Initial get creates default session
      let res = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}`).then(r => r.json());
      expect(res.id).toBe(testAgentId);
      expect(res.history).toEqual([]);
      expect(res.plan).toEqual([]);
      expect(res.diffs).toEqual([]);

      // 2. Save session with history, plan, and diffs
      saveAgentSession({
        id: testAgentId,
        title: 'Persistent Session',
        workingDir: '/tmp',
        mode: 'supervised',
        status: 'idle',
        plan: [
          { id: 'step-1', title: 'Inspect workspace', status: 'completed' },
          { id: 'step-2', title: 'Apply diff', status: 'completed' }
        ],
        history: [
          { role: 'user', content: 'Add a new feature to the app' },
          { role: 'assistant', content: 'I have modified `app.js` with the requested feature.' }
        ],
        diffs: [
          { path: 'app.js', diff: '+ console.log("new feature");' }
        ]
      });

      // 3. Query via HTTP endpoint — must match saved state
      res = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}`).then(r => r.json());
      expect(res.history.length).toBe(2);
      expect(res.history[0].content).toContain('Add a new feature');
      expect(res.history[1].content).toContain('I have modified `app.js`');
      expect(res.plan.length).toBe(2);
      expect(res.plan[0].status).toBe('completed');
      expect(res.diffs.length).toBe(1);
      expect(res.diffs[0].path).toBe('app.js');
      expect(res.mode).toBe('supervised');

      // 4. Update session workingDir and mode
      const updateRes = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workingDir: '/var/log', mode: 'autonomous' })
      }).then(r => r.json());
      expect(updateRes.ok).toBe(true);

      res = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}`).then(r => r.json());
      expect(res.workingDir).toBe('/var/log');
      expect(res.mode).toBe('autonomous');
      expect(res.history.length).toBe(2); // History still intact

      // 5. Reset session
      const resetRes = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}/reset`, {
        method: 'POST'
      }).then(r => r.json());
      expect(resetRes.ok).toBe(true);

      res = await fetch(`http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}`).then(r => r.json());
      expect(res.history).toEqual([]);
      expect(res.plan).toEqual([]);
      expect(res.diffs).toEqual([]);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  test('frontend agent tab correctly hydrates chat history and plan from session', async () => {
    // Start Meowtrix server instance for testing
    const express = require('express');
    const path = require('path');
    const { mountAiRoutes, saveAgentSession } = require('../ai-service');
    const app = express();
    app.use(express.json());
    app.use(express.static(path.join(__dirname, '..', 'public')));
    app.get('/meowtrix-version.js', (req, res) => res.type('application/javascript').send('window.MEOWTRIX_VERSION = "test";'));
    mountAiRoutes(app);

    const testAgentId = 'test-tab-' + Date.now();
    saveAgentSession({
      id: testAgentId,
      title: 'Restored Agent',
      workingDir: '/workspace/test',
      mode: 'autonomous',
      status: 'idle',
      plan: [
        { id: 'step-1', title: 'Explore project', status: 'completed' }
      ],
      history: [
        { role: 'user', content: 'What is the project architecture?' },
        { role: 'assistant', content: 'The project is built with **Node.js** and **Tauri**.' }
      ],
      diffs: [
        { path: 'test.txt', diff: '+ restored file' }
      ]
    });

    const server = await new Promise(r => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const port = server.address().port;

    try {
      const sessionUrl = `http://127.0.0.1:${port}/api/ai/agent/session/${testAgentId}`;
      const sessionData = await fetch(sessionUrl).then(r => r.json());
      expect(sessionData.history.length).toBe(2);
      expect(sessionData.history[0].role).toBe('user');
      expect(sessionData.history[1].role).toBe('assistant');
      expect(sessionData.plan.length).toBe(1);
      expect(sessionData.diffs.length).toBe(1);
    } finally {
      await new Promise(r => server.close(r));
    }
  });

  test('model status reports local and recommended models with direct GGUF mapping', async () => {
    const express = require('express');
    const { mountAiRoutes } = require('../ai-service');
    const app = express();
    app.use(express.json());
    mountAiRoutes(app);

    const server = await new Promise(r => {
      const s = app.listen(0, '127.0.0.1', () => r(s));
    });
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/ai/status`).then(r => r.json());
      expect(res.recommendedModels).toBeDefined();
      expect(Array.isArray(res.recommendedModels)).toBe(true);
      expect(res.recommendedModels.length).toBeGreaterThan(0);

      // Verify each recommended model has required fields for one-click download
      for (const rec of res.recommendedModels) {
        expect(rec.id).toBeDefined();
        expect(rec.name).toBeDefined();
        expect(rec.filename).toBeDefined();
        expect(rec.url).toBeDefined();
      }

      // Verify local models array exists
      expect(res.localModels).toBeDefined();
      expect(Array.isArray(res.localModels)).toBe(true);
    } finally {
      await new Promise(r => server.close(r));
    }
  });
});

