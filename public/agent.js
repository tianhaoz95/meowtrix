// ==============================================================================
// agent.js — Meowtrix AI Agent Tab (Deep Agents GUI & Inference Cockpit)
// ==============================================================================

(function() {
  'use strict';

  // Expose global init function
  window.initAgentTab = initAgentTab;

  function renderMarkdown(text) {
    if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
      try {
        return marked.parse(text || '');
      } catch (e) {
        console.warn('Markdown parsing error:', e);
      }
    }
    // Fallback: Escape HTML and preserve newlines
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML.replace(/\n/g, '<br>');
  }

  function initAgentTab(tab, viewEl, existingDir) {
    tab.agentId = tab.id;
    tab.workingDir = existingDir || '';
    tab.selectedEngine = 'mistralrs';
    tab.selectedModel = 'qwen2.5-coder-1.5b';
    tab.mode = 'autonomous'; // 'autonomous' | 'supervised'
    tab.isRunning = false;
    tab.plan = [];
    tab.diffs = [];
    tab.activeEventSource = null;

    viewEl.innerHTML = `
      <div class="agent-container">
        <!-- Top Navigation / Status Header -->
        <div class="agent-header">
          <div class="agent-header-left">
            <span class="agent-badge agent-badge-idle" id="agent-status-badge-${tab.id}">
              <span class="agent-dot"></span> <span class="agent-status-text">Ready</span>
            </span>
            <div class="agent-engine-selector-wrap">
              <select class="agent-select" id="agent-model-select-${tab.id}" title="Select inference engine & model">
                <option value="mistralrs:qwen2.5-coder-1.5b">⚡ Mistral.rs (Native Rust) · Qwen 2.5 Coder 1.5B</option>
                <option value="mistralrs:qwen2.5-coder-3b">🧠 Mistral.rs (Native Rust) · Qwen 2.5 Coder 3B</option>
                <option value="ollama:auto">🦙 Ollama (Local Auto-Detect)</option>
                <option value="cloud:gpt-4o">☁️ Cloud / OpenAI-Compatible</option>
                <option value="download">📥 Download New Model...</option>
              </select>
            </div>
            <button class="agent-btn agent-btn-toggle" id="agent-mode-toggle-${tab.id}" title="Switch between Autonomous and Supervised (Confirm tool actions)">
              <span class="agent-btn-icon">⚡</span> <span class="agent-mode-label">Autonomous</span>
            </button>
          </div>
          <div class="agent-header-right">
            <button class="agent-btn agent-dir-btn" id="agent-dir-btn-${tab.id}" title="Current working directory">
              <span class="agent-btn-icon">📁</span> <span class="agent-dir-label">Workspace</span>
            </button>
            <button class="agent-btn" id="agent-clear-btn-${tab.id}" title="Clear conversation & reset plan">
              <span class="agent-btn-icon">🧹</span> Clear
            </button>
          </div>
        </div>

        <!-- Download Progress Drawer (hidden by default) -->
        <div class="agent-download-bar" id="agent-download-bar-${tab.id}" style="display: none;">
          <div class="agent-download-info">
            <span class="agent-download-title">Downloading model weights...</span>
            <span class="agent-download-percent" id="agent-download-percent-${tab.id}">0%</span>
          </div>
          <div class="agent-progress-track">
            <div class="agent-progress-fill" id="agent-download-fill-${tab.id}" style="width: 0%;"></div>
          </div>
        </div>

        <!-- Main Body: Two-Column Split Layout -->
        <div class="agent-body">
          <!-- Left Column: Interaction & Execution Stream -->
          <div class="agent-stream-column">
            <div class="agent-stream" id="agent-stream-${tab.id}">
              <div class="agent-welcome-card">
                <div class="agent-welcome-icon">🤖</div>
                <h3>Meowtrix Autonomous AI Cockpit</h3>
                <p>Equipped with native workspace access: file reading/writing, terminal commands, git diffs, and iterative planning.</p>
                <div class="agent-quick-pills">
                  <button class="agent-pill" data-prompt="Survey the project files and explain the workspace architecture.">🔍 Explore Project</button>
                  <button class="agent-pill" data-prompt="Check git status and explain all unstaged or modified files.">🌿 Inspect Git State</button>
                  <button class="agent-pill" data-prompt="Check for test scripts or syntax errors and suggest fixes.">🧪 Verify Tests</button>
                  <button class="agent-pill" data-prompt="Analyze the code for potential optimizations or refactoring.">✨ Code Health Check</button>
                </div>
              </div>
            </div>

            <!-- Input Toolbar & Prompt Box -->
            <div class="agent-input-container">
              <div class="agent-input-box">
                <textarea
                  class="agent-textarea"
                  id="agent-input-${tab.id}"
                  placeholder="Ask a question, describe a task, or prompt the agent... (Enter to send, Shift+Enter for newline)"
                  rows="1"
                ></textarea>
                <div class="agent-input-actions">
                  <button class="agent-send-btn" id="agent-send-btn-${tab.id}" title="Send message (Enter)">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
                  </button>
                  <button class="agent-stop-btn" id="agent-stop-btn-${tab.id}" style="display: none;" title="Cancel running task">
                    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M6 6h12v12H6z"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Right Column: Cockpit, Dynamic Plan & Artifacts -->
          <div class="agent-cockpit-column">
            <!-- Dynamic Plan Checklist -->
            <div class="agent-panel agent-panel-plan">
              <div class="agent-panel-header">
                <span class="agent-panel-title">📋 Dynamic Task Plan</span>
                <span class="agent-plan-stats" id="agent-plan-stats-${tab.id}">0 / 0</span>
              </div>
              <div class="agent-plan-progress-bar">
                <div class="agent-plan-progress-fill" id="agent-plan-progress-fill-${tab.id}" style="width: 0%;"></div>
              </div>
              <div class="agent-plan-list" id="agent-plan-list-${tab.id}">
                <div class="agent-empty-hint">No active task. Send a prompt to generate an autonomous execution plan.</div>
              </div>
            </div>

            <!-- Active Diffs & Changes -->
            <div class="agent-panel agent-panel-diffs">
              <div class="agent-panel-header">
                <span class="agent-panel-title">📂 Proposed Changes & Diffs</span>
                <span class="agent-diff-count" id="agent-diff-count-${tab.id}">0 files</span>
              </div>
              <div class="agent-diff-list" id="agent-diff-list-${tab.id}">
                <div class="agent-empty-hint">Files modified or generated by the agent will appear here with live diffs.</div>
              </div>
            </div>

            <!-- Environment & Engine Specs -->
            <div class="agent-panel agent-panel-specs">
              <div class="agent-panel-header">
                <span class="agent-panel-title">⚙️ Workspace Context</span>
              </div>
              <div class="agent-specs-content">
                <div class="agent-spec-row">
                  <span class="agent-spec-label">Engine:</span>
                  <span class="agent-spec-val" id="agent-spec-engine-${tab.id}">Mistral.rs (Rust)</span>
                </div>
                <div class="agent-spec-row">
                  <span class="agent-spec-label">Target Dir:</span>
                  <span class="agent-spec-val agent-spec-dir" id="agent-spec-dir-${tab.id}">~</span>
                </div>
                <div class="agent-spec-row">
                  <span class="agent-spec-label">Execution Mode:</span>
                  <span class="agent-spec-val" id="agent-spec-mode-${tab.id}">Autonomous</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache elements
    const statusBadge = viewEl.querySelector(`#agent-status-badge-${tab.id}`);
    const statusText = statusBadge.querySelector('.agent-status-text');
    const modelSelect = viewEl.querySelector(`#agent-model-select-${tab.id}`);
    const modeToggleBtn = viewEl.querySelector(`#agent-mode-toggle-${tab.id}`);
    const modeLabel = modeToggleBtn.querySelector('.agent-mode-label');
    const dirBtn = viewEl.querySelector(`#agent-dir-btn-${tab.id}`);
    const dirLabel = dirBtn.querySelector('.agent-dir-label');
    const clearBtn = viewEl.querySelector(`#agent-clear-btn-${tab.id}`);
    const streamEl = viewEl.querySelector(`#agent-stream-${tab.id}`);
    const inputEl = viewEl.querySelector(`#agent-input-${tab.id}`);
    const sendBtn = viewEl.querySelector(`#agent-send-btn-${tab.id}`);
    const stopBtn = viewEl.querySelector(`#agent-stop-btn-${tab.id}`);
    const planListEl = viewEl.querySelector(`#agent-plan-list-${tab.id}`);
    const planStatsEl = viewEl.querySelector(`#agent-plan-stats-${tab.id}`);
    const planProgressFill = viewEl.querySelector(`#agent-plan-progress-fill-${tab.id}`);
    const diffListEl = viewEl.querySelector(`#agent-diff-list-${tab.id}`);
    const diffCountEl = viewEl.querySelector(`#agent-diff-count-${tab.id}`);
    const specEngineEl = viewEl.querySelector(`#agent-spec-engine-${tab.id}`);
    const specDirEl = viewEl.querySelector(`#agent-spec-dir-${tab.id}`);
    const specModeEl = viewEl.querySelector(`#agent-spec-mode-${tab.id}`);
    const downloadBar = viewEl.querySelector(`#agent-download-bar-${tab.id}`);
    const downloadPercent = viewEl.querySelector(`#agent-download-percent-${tab.id}`);
    const downloadFill = viewEl.querySelector(`#agent-download-fill-${tab.id}`);

    // Update Directory Label
    function updateDirLabel(dir) {
      tab.workingDir = dir;
      const base = dir ? (dir.split('/').pop() || dir) : 'Workspace';
      dirLabel.textContent = base;
      specDirEl.textContent = dir || '~';
    }

    // Default working directory
    if (!tab.workingDir) {
      fetch('/api/fs/home')
        .then(r => r.json())
        .then(data => { if (data.home) updateDirLabel(data.home); })
        .catch(() => updateDirLabel(''));
    } else {
      updateDirLabel(tab.workingDir);
    }

    // Refresh available models
    function refreshModels() {
      fetch('/api/ai/status')
        .then(r => r.json())
        .then(data => {
          if (!data) return;
          modelSelect.innerHTML = '';

          // Built-in Native Mistral.rs
          const optMistral1 = document.createElement('option');
          optMistral1.value = 'mistralrs:qwen2.5-coder-1.5b';
          optMistral1.textContent = '⚡ Mistral.rs (Native Rust) · Qwen 2.5 Coder 1.5B';
          modelSelect.appendChild(optMistral1);

          const optMistral2 = document.createElement('option');
          optMistral2.value = 'mistralrs:qwen2.5-coder-3b';
          optMistral2.textContent = '🧠 Mistral.rs (Native Rust) · Qwen 2.5 Coder 3B';
          modelSelect.appendChild(optMistral2);

          // Local GGUF models on disk
          if (data.localModels && data.localModels.length) {
            const group = document.createElement('optgroup');
            group.label = 'Local GGUF Models (~/.meowtrix/models)';
            data.localModels.forEach(m => {
              const opt = document.createElement('option');
              opt.value = `local:${m.filename}`;
              opt.textContent = `📦 ${m.filename} (${m.sizeMb} MB)`;
              group.appendChild(opt);
            });
            modelSelect.appendChild(group);
          }

          // Ollama detected models
          const ollamaEngine = (data.engines || []).find(e => e.id === 'ollama');
          if (ollamaEngine && ollamaEngine.available && ollamaEngine.models && ollamaEngine.models.length) {
            const group = document.createElement('optgroup');
            group.label = 'Ollama (Local Bridge)';
            ollamaEngine.models.forEach(m => {
              const opt = document.createElement('option');
              opt.value = `ollama:${m}`;
              opt.textContent = `🦙 ${m}`;
              group.appendChild(opt);
            });
            modelSelect.appendChild(group);
          }

          // Cloud & Download option
          const optCloud = document.createElement('option');
          optCloud.value = 'cloud:custom';
          optCloud.textContent = '☁️ Cloud / OpenAI-Compatible Endpoint';
          modelSelect.appendChild(optCloud);

          const optDl = document.createElement('option');
          optDl.value = 'download';
          optDl.textContent = '📥 Download Recommended Model...';
          modelSelect.appendChild(optDl);
        })
        .catch(() => {});
    }

    refreshModels();

    // Mode Toggle
    modeToggleBtn.addEventListener('click', () => {
      if (tab.mode === 'autonomous') {
        tab.mode = 'supervised';
        modeToggleBtn.classList.add('agent-mode-supervised');
        modeLabel.textContent = 'Supervised';
        modeToggleBtn.querySelector('.agent-btn-icon').textContent = '🛡️';
        specModeEl.textContent = 'Supervised';
      } else {
        tab.mode = 'autonomous';
        modeToggleBtn.classList.remove('agent-mode-supervised');
        modeLabel.textContent = 'Autonomous';
        modeToggleBtn.querySelector('.agent-btn-icon').textContent = '⚡';
        specModeEl.textContent = 'Autonomous';
      }
    });

    // Model Selector Change
    modelSelect.addEventListener('change', () => {
      const val = modelSelect.value;
      if (val === 'download') {
        startModelDownload('qwen2.5-coder-1.5b');
        return;
      }
      specEngineEl.textContent = val.split(':')[0].toUpperCase();
    });

    // Directory Selector Button
    dirBtn.addEventListener('click', async () => {
      if (typeof promptForFolder === 'function') {
        const folder = await promptForFolder();
        if (folder) updateDirLabel(folder);
      }
    });

    // Quick Prompt Pills
    viewEl.querySelectorAll('.agent-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.getAttribute('data-prompt');
        if (prompt) {
          inputEl.value = prompt;
          submitTask();
        }
      });
    });

    // Auto-grow Textarea
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 180) + 'px';
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitTask();
      }
    });

    sendBtn.addEventListener('click', submitTask);
    stopBtn.addEventListener('click', stopTask);

    clearBtn.addEventListener('click', () => {
      streamEl.innerHTML = `
        <div class="agent-welcome-card">
          <div class="agent-welcome-icon">🤖</div>
          <h3>Session Cleared</h3>
          <p>Ready for your next task. Type an instruction below or select a quick starter pill.</p>
        </div>
      `;
      planListEl.innerHTML = '<div class="agent-empty-hint">No active task. Send a prompt to generate an autonomous execution plan.</div>';
      planStatsEl.textContent = '0 / 0';
      planProgressFill.style.width = '0%';
      diffListEl.innerHTML = '<div class="agent-empty-hint">Files modified or generated by the agent will appear here with live diffs.</div>';
      diffCountEl.textContent = '0 files';
      tab.plan = [];
      tab.diffs = [];
    });

    // Model Download Handler
    function startModelDownload(modelId) {
      downloadBar.style.display = 'block';
      downloadFill.style.width = '0%';
      downloadPercent.textContent = '0%';

      fetch('/api/ai/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId })
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();

        function readChunk() {
          reader.read().then(({ done, value }) => {
            if (done) {
              setTimeout(() => { downloadBar.style.display = 'none'; }, 2000);
              refreshModels();
              return;
            }
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            for (const line of lines) {
              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.percent !== undefined) {
                    downloadFill.style.width = data.percent + '%';
                    downloadPercent.textContent = data.percent + '%';
                  }
                  if (data.completed) {
                    downloadPercent.textContent = 'Complete!';
                  }
                } catch {}
              }
            }
            readChunk();
          });
        }
        readChunk();
      }).catch(err => {
        downloadPercent.textContent = 'Failed: ' + err.message;
      });
    }

    // Set Status Badge Helper
    function setStatus(status) {
      statusBadge.className = 'agent-badge agent-badge-' + status;
      const labels = {
        idle: 'Ready',
        thinking: 'Thinking',
        executing: 'Running Tool',
        waiting_approval: 'Awaiting Approval',
        error: 'Error'
      };
      statusText.textContent = labels[status] || status;
    }

    // Update Plan List UI
    function renderPlan(plan) {
      tab.plan = plan || [];
      if (!tab.plan.length) {
        planListEl.innerHTML = '<div class="agent-empty-hint">No active task.</div>';
        planStatsEl.textContent = '0 / 0';
        planProgressFill.style.width = '0%';
        return;
      }

      const completed = tab.plan.filter(s => s.status === 'completed').length;
      const total = tab.plan.length;
      planStatsEl.textContent = `${completed} / ${total}`;
      planProgressFill.style.width = Math.round((completed / total) * 100) + '%';

      planListEl.innerHTML = '';
      tab.plan.forEach(step => {
        const item = document.createElement('div');
        item.className = 'agent-plan-item agent-plan-' + step.status;

        const icon = document.createElement('span');
        icon.className = 'agent-plan-icon';
        icon.textContent = step.status === 'completed' ? '✔' : step.status === 'running' ? '▶' : step.status === 'failed' ? '✖' : '◻';

        const text = document.createElement('span');
        text.className = 'agent-plan-title';
        text.textContent = step.title;

        item.append(icon, text);
        planListEl.appendChild(item);
      });
    }

    // Append Chat Card to Stream
    function appendMessageCard(role, text) {
      const card = document.createElement('div');
      card.className = `agent-card agent-card-${role}`;

      const header = document.createElement('div');
      header.className = 'agent-card-header';
      header.textContent = role === 'user' ? '👤 User' : '🤖 Meowtrix Agent';

      const content = document.createElement('div');
      content.className = 'agent-card-content';
      content.innerHTML = renderMarkdown(text);

      card.append(header, content);
      streamEl.appendChild(card);
      streamEl.scrollTop = streamEl.scrollHeight;
      return content;
    }

    // Submit Task to Agent Loop
    function submitTask() {
      const prompt = inputEl.value.trim();
      if (!prompt || tab.isRunning) return;

      inputEl.value = '';
      inputEl.style.height = 'auto';

      appendMessageCard('user', prompt);

      tab.isRunning = true;
      sendBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      setStatus('thinking');

      // Create Assistant Stream Container
      const assistantCard = document.createElement('div');
      assistantCard.className = 'agent-card agent-card-assistant';
      assistantCard.innerHTML = `
        <div class="agent-card-header">🤖 Meowtrix Agent</div>
        <div class="agent-thinking-box" style="display: none;">
          <details open>
            <summary class="agent-thinking-summary">🧠 Reasoning / Chain of Thought</summary>
            <div class="agent-thinking-text"></div>
          </details>
        </div>
        <div class="agent-card-content"></div>
      `;
      streamEl.appendChild(assistantCard);
      streamEl.scrollTop = streamEl.scrollHeight;

      const thinkingBox = assistantCard.querySelector('.agent-thinking-box');
      const thinkingText = assistantCard.querySelector('.agent-thinking-text');
      const contentEl = assistantCard.querySelector('.agent-card-content');

      const parts = modelSelect.value.split(':');
      const engine = parts[0];
      const model = parts[1] || 'default';

      fetch('/api/ai/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          agentId: tab.agentId,
          workingDir: tab.workingDir,
          mode: tab.mode,
          engine,
          model
        })
      }).then(res => {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        function readEvents() {
          reader.read().then(({ done, value }) => {
            if (done) {
              finishTask();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n\n');
            buffer = lines.pop() || '';

            for (const block of lines) {
              if (!block.trim()) continue;
              let eventType = 'message';
              let eventData = null;

              const blockLines = block.split('\n');
              for (const l of blockLines) {
                if (l.startsWith('event: ')) eventType = l.slice(7).trim();
                else if (l.startsWith('data: ')) {
                  try { eventData = JSON.parse(l.slice(6)); } catch {}
                }
              }

              if (eventData) handleAgentEvent(eventType, eventData);
            }
            readEvents();
          }).catch(err => {
            console.error('SSE Read Error:', err);
            finishTask();
          });
        }
        readEvents();
      }).catch(err => {
        contentEl.textContent = 'Execution failed: ' + err.message;
        finishTask();
      });

      function handleAgentEvent(event, data) {
        if (event === 'status') {
          setStatus(data.status);
        } else if (event === 'thinking') {
          thinkingBox.style.display = 'block';
          thinkingText.textContent += (thinkingText.textContent ? '\n' : '') + data.text;
          streamEl.scrollTop = streamEl.scrollHeight;
        } else if (event === 'plan') {
          renderPlan(data.plan);
        } else if (event === 'tool_call') {
          const callEl = document.createElement('div');
          callEl.className = 'agent-tool-call';
          callEl.innerHTML = `
            <div class="agent-tool-header">
              <span class="agent-tool-tag">⚙️ Tool: <code>${data.name}</code></span>
            </div>
            <pre class="agent-tool-args"><code>${JSON.stringify(data.args, null, 2)}</code></pre>
          `;

          if (data.requiresApproval) {
            const approveBox = document.createElement('div');
            approveBox.className = 'agent-approval-box';
            approveBox.innerHTML = `
              <span class="agent-approval-title">⚠️ Action Requires Confirmation</span>
              <div class="agent-approval-actions">
                <button class="agent-btn agent-btn-approve">Approve Action</button>
                <button class="agent-btn agent-btn-reject">Reject</button>
              </div>
            `;
            approveBox.querySelector('.agent-btn-approve').addEventListener('click', () => {
              approveBox.remove();
              fetch('/api/ai/agent/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: tab.agentId, approved: true })
              });
            });
            approveBox.querySelector('.agent-btn-reject').addEventListener('click', () => {
              approveBox.remove();
              fetch('/api/ai/agent/approve', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agentId: tab.agentId, approved: false })
              });
            });
            callEl.appendChild(approveBox);
          }

          contentEl.appendChild(callEl);
          streamEl.scrollTop = streamEl.scrollHeight;
        } else if (event === 'tool_result') {
          const resEl = document.createElement('div');
          resEl.className = 'agent-tool-result' + (data.isError ? ' agent-tool-error' : '');
          resEl.innerHTML = `<pre><code>${data.output}</code></pre>`;
          contentEl.appendChild(resEl);
          streamEl.scrollTop = streamEl.scrollHeight;
        } else if (event === 'diff') {
          addDiffCard(data.path, data.diff);
        } else if (event === 'message' || event === 'done') {
          contentEl.innerHTML = renderMarkdown(data.text || data.summary || '');
          streamEl.scrollTop = streamEl.scrollHeight;
        }
      }

      function finishTask() {
        tab.isRunning = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        setStatus('idle');
      }
    }

    // Stop Running Task
    function stopTask() {
      fetch('/api/ai/agent/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: tab.agentId })
      }).finally(() => {
        tab.isRunning = false;
        sendBtn.style.display = 'flex';
        stopBtn.style.display = 'none';
        setStatus('idle');
      });
    }

    // Add Diff Card to Right Column
    function addDiffCard(filePath, diffText) {
      if (!tab.diffs.find(d => d.path === filePath)) {
        tab.diffs.push({ path: filePath, diff: diffText });
      }
      diffCountEl.textContent = `${tab.diffs.length} files`;

      const card = document.createElement('div');
      card.className = 'agent-diff-card';
      card.innerHTML = `
        <div class="agent-diff-header">
          <span class="agent-diff-path">📄 ${filePath}</span>
          <button class="agent-diff-open-btn" title="Open file in Meowtrix Editor tab">Open</button>
        </div>
        <pre class="agent-diff-body"><code>${diffText || '(new file)'}</code></pre>
      `;

      card.querySelector('.agent-diff-open-btn').addEventListener('click', () => {
        if (typeof triggerOpenEditor === 'function') {
          triggerOpenEditor(tab.workingDir);
        }
      });

      diffListEl.appendChild(card);
    }
  }
})();
