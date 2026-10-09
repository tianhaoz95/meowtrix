# CoDesign Monorepo Modularization & Meowtrix Tab Integration: Implementation Design

## 1. Executive Summary & Goals

This document specifies the exact implementation design for modularizing **CoDesign Studio** into two independent, publishable npm packages within the **Meowtrix** monorepo, and integrating them as a first-class **CoDesign Canvas** tab inside Meowtrix.

### Architectural Objectives
1. **Zero Dependency Leakage**: The UI Canvas Engine and MCP Server must have zero direct coupling to Meowtrix internals. They can be published independently to npm (`@codesign/canvas`, `@codesign/server`) and embedded into any web container or Node.js server.
2. **Unified Monorepo Workflow**: Managed via NPM Workspaces in `/Volumes/DATA/GitHub/meowtrix`.
3. **Turnkey Integration in Meowtrix**:
   - Backend: Mounted as an Express router & WebSocket handler in `server.js`.
   - Frontend: Implemented as a native tab type (`'codesign'`) in `pane.js`, accessible via the Tab Type Picker (`+`), Command Palette (`⌘K`), and workspace session persistence.
4. **Living Spec AI Loop**:
   - Agent running in Meowtrix terminal (or external Claude Code / AGY CLI) connects to `/api/codesign/mcp`.
   - Agent creates/refreshes `.codesign/spec.html` and calls `codesign_create_spec` / `codesign_refresh_spec`.
   - CoDesign Tab in Meowtrix renders the canvas in real-time.
   - Developer drops visual comment pins, highlights elements, and submits reviews or clicks "Sign Off".
   - Agent reads feedback via `codesign_get_feedback` or unblocks from `codesign_await_signoff`.

---

## 2. Directory Structure & NPM Workspaces Layout

Inside `/Volumes/DATA/GitHub/meowtrix`:

```
meowtrix/
├── package.json                         # Root package.json (Configured with npm workspaces)
├── server.js                            # Meowtrix Express + WebSocket server
├── public/
│   ├── index.html                       # Loads codesign assets
│   ├── pane.js                          # Tab lifecycle & 'codesign' tab registration
│   ├── app.js                           # Tab picker & workspace state serialization
│   └── palette.js                       # Command palette entry
│
└── packages/
    ├── codesign-canvas/                 # Package 1: Pure UI Canvas & Engine
    │   ├── package.json                 # Name: @codesign/canvas
    │   ├── index.js                     # ESM / CJS entrypoint exporting mountCodesignCanvas
    │   ├── src/
    │   │   ├── engine.js                # Viewport transform, pan, zoom, device frames
    │   │   ├── annotator.js             # Visual pin drop, element highlight, lasso
    │   │   ├── inspector.js             # DOM tree inspection, computed CSS styles
    │   │   ├── components.js            # Floating toolbar, feedback cards, sign-off bar
    │   │   └── protocol-client.js       # EventSource & REST client communicating with server
    │   └── styles/
    │       └── codesign.css             # Theme-aware styles (compatible with Meowtrix CSS vars)
    │
    └── codesign-server/                 # Package 2: Pure Node.js MCP & Spec Engine
        ├── package.json                 # Name: @codesign/server
        ├── index.js                     # Exports createCodesignRouter, createMcpHandler
        └── src/
            ├── mcp-transport.js         # SSE stream & JSON-RPC message handling (/mcp)
            ├── mcp-tools.js             # Implementations for codesign_* tools
            ├── spec-manager.js          # File I/O for .codesign/spec.html & feedback.json
            └── events.js                # EventEmitter relaying spec updates & sign-offs
```

---

## 3. Package 1 Specification: `@codesign/canvas`

### 3.1 Metadata (`packages/codesign-canvas/package.json`)
```json
{
  "name": "@codesign/canvas",
  "version": "0.1.0",
  "description": "Interactive visual canvas, annotator, and living spec viewer for AI-driven design",
  "main": "index.js",
  "files": [
    "index.js",
    "src/",
    "styles/"
  ],
  "keywords": ["codesign", "spec", "design", "canvas", "annotation", "mcp"],
  "author": "",
  "license": "MIT"
}
```

### 3.2 Public API (`packages/codesign-canvas/index.js`)

The package exports a single factory function that mounts into any arbitrary DOM element:

```javascript
/**
 * Mounts a CoDesign Canvas into the specified container element.
 * 
 * @param {HTMLElement} container - The DOM node to render the canvas inside
 * @param {Object} options - Configuration options
 * @param {string} options.apiBase - Base URL for CoDesign endpoints (e.g. '/api/codesign')
 * @param {string} [options.workingDir] - Project root directory for spec resolution
 * @param {Function} [options.onFeedbackCreated] - Callback when user drops a comment
 * @param {Function} [options.onSignOff] - Callback when user signs off
 * @returns {CodesignCanvasInstance}
 */
export function mountCodesignCanvas(container, options = {}) {
  // Returns controller instance
}
```

### 3.3 Controller Instance Interface (`CodesignCanvasInstance`)
```typescript
interface CodesignCanvasInstance {
  setDevice(device: 'responsive' | 'desktop' | 'tablet' | 'mobile'): void;
  setMode(mode: 'preview' | 'inspect' | 'annotate'): void;
  setZoom(zoomPercent: number): void;
  reloadSpec(): Promise<void>;
  loadFeedback(): Promise<void>;
  destroy(): void;
}
```

### 3.4 Key Submodules in `packages/codesign-canvas/src/`

#### A. `engine.js` (Canvas & Viewport)
* Manages an infinite artboard with transform matrix `matrix(scale, 0, 0, scale, panX, panY)`.
* Supports device frame presets:
  * `desktop`: 1440 × 900
  * `tablet`: 768 × 1024
  * `mobile`: 390 × 844
  * `responsive`: 100% × 100%
* Embeds an `<iframe>` hosting the living spec (`${apiBase}/spec/raw?t=${Date.now()}`).
* Handles Wheel / Pinch zoom and Space + Drag pan gestures.

#### B. `annotator.js` (Visual Comments & Pins)
* Creates an absolute overlay positioned directly above the spec iframe.
* Listens for click events in `annotate` mode:
  1. Calculates normalized coordinates `(x / iframeWidth, y / iframeHeight)`.
  2. Queries underlying iframe DOM node using `document.elementFromPoint(clientX, clientY)` to extract CSS selector and text snippet.
  3. Displays a floating comment composer.
  4. Posts feedback item to `${apiBase}/feedback`.
* Renders numbered circular pin markers (`#1`, `#2`) that stay locked to their relative positions during zooming and panning.

#### C. `inspector.js` (DOM & Style Inspection)
* In `inspect` mode, provides hover outline bounds over iframe elements.
* Extracts computed styles (colors, font size, padding, margin, border, flex/grid properties).
* Displays a compact HUD card next to the cursor showing element dimensions and typography.

#### D. `components.js` (Toolbar, Drawer, Sign-Off Bar)
* **Canvas Toolbar**: Device selector dropdown, Zoom In/Out/Reset buttons, Mode toggles (Preview / Inspect / Annotate).
* **Feedback Drawer**: Collapsible list of active, resolved, and pending feedback items. Clicking an item centers the canvas on that pin.
* **Sign-Off Bar**: Shows status badge (`Drafting`, `Awaiting Review`, `Approved`) and the prominent "Approve & Sign Off" button.

---

## 4. Package 2 Specification: `@codesign/server`

### 4.1 Metadata (`packages/codesign-server/package.json`)
```json
{
  "name": "@codesign/server",
  "version": "0.1.0",
  "description": "Model Context Protocol (MCP) server & storage service for living specs",
  "main": "index.js",
  "files": [
    "index.js",
    "src/"
  ],
  "dependencies": {
    "express": "^4.18.2"
  },
  "license": "MIT"
}
```

### 4.2 Public API (`packages/codesign-server/index.js`)

Exports a factory returning an Express router and an event emitter:

```javascript
const express = require('express');
const { createMcpHandler } = require('./src/mcp-transport');
const { SpecManager } = require('./src/spec-manager');
const { CodesignEvents } = require('./src/events');

/**
 * Creates the CoDesign Express router and backend service.
 * 
 * @param {Object} options
 * @param {Function} options.resolveWorkspaceDir - Function(req) returning the active project directory
 * @param {Object} [options.wss] - Optional WebSocket server instance for broadcasting
 * @returns {{ router: express.Router, events: EventEmitter }}
 */
function createCodesignRouter(options = {}) {
  // ...
}

module.exports = { createCodesignRouter };
```

### 4.3 REST & SSE Endpoints Mounted

All routes are mounted under `/api/codesign` (or custom prefix):

| Method | Path | Description |
| :--- | :--- | :--- |
| `GET` | `/mcp` | SSE connection endpoint for AI agents (Claude Code, Cursor, AGY CLI). |
| `POST` | `/mcp/message` | JSON-RPC message endpoint for MCP client tool calls. |
| `GET` | `/spec/raw` | Serves the current `.codesign/spec.html` as `text/html`. |
| `GET` | `/spec/meta` | Returns metadata (`title`, `version`, `lastModified`, `approved`). |
| `GET` | `/feedback` | Returns list of feedback items from `.codesign/feedback.json`. |
| `POST` | `/feedback` | Appends a new user comment/pin to `.codesign/feedback.json`. |
| `POST` | `/feedback/resolve` | Marks specified feedback IDs as resolved. |
| `POST` | `/signoff` | Approves current spec revision, unblocking `codesign_await_signoff`. |
| `GET` | `/events` | Server-Sent Events stream for frontend UI live updates. |

### 4.4 MCP Tools Implementation (`src/mcp-tools.js`)

The MCP server implements the 5 standard tools:

#### 1. `codesign_create_spec`
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "title": { "type": "string", "description": "Title of the design spec" },
      "spec_html": { "type": "string", "description": "Full HTML/CSS/Tailwind/JS document content" },
      "device_target": { "type": "string", "enum": ["responsive", "desktop", "mobile"] }
    },
    "required": ["title", "spec_html"]
  }
  ```
* **Execution**:
  1. Writes `spec_html` directly to `<workspaceDir>/.codesign/spec.html`.
  2. Initializes `<workspaceDir>/.codesign/spec.json` with metadata.
  3. Emits `spec:updated` event, which triggers the UI canvas to reload.
  4. Returns success message and local review URL.

#### 2. `codesign_refresh_spec`
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "spec_html": { "type": "string", "description": "Updated HTML content" },
      "change_summary": { "type": "string", "description": "Summary of changes made" }
    },
    "required": ["spec_html"]
  }
  ```
* **Execution**:
  1. Overwrites `<workspaceDir>/.codesign/spec.html`.
  2. Appends `change_summary` to revision history.
  3. Emits `spec:updated` event to the canvas.

#### 3. `codesign_get_feedback`
* **Input Schema**:
  ```json
  { "type": "object", "properties": { "status": { "type": "string", "enum": ["all", "open", "resolved"] } } }
  ```
* **Execution**: Reads `<workspaceDir>/.codesign/feedback.json` and returns structured array of user pins, selectors, and comments.

#### 4. `codesign_await_signoff`
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "timeout_seconds": { "type": "number", "default": 600 }
    }
  }
  ```
* **Execution**:
  1. Holds the MCP request in a pending Promise.
  2. Resolves immediately when the human clicks "Approve & Sign Off" in the CoDesign tab (`POST /api/codesign/signoff`).
  3. If user submits annotations/comments instead, returns the new feedback items so the agent can iterate.

#### 5. `codesign_resolve_feedback`
* **Input Schema**:
  ```json
  {
    "type": "object",
    "properties": {
      "feedback_ids": { "type": "array", "items": { "type": "string" } },
      "resolution_note": { "type": "string" }
    },
    "required": ["feedback_ids"]
  }
  ```
* **Execution**: Updates `<workspaceDir>/.codesign/feedback.json`, changing `status` from `"open"` to `"resolved"`.

---

## 5. Meowtrix Monorepo Integration

### 5.1 Root Workspace Configuration (`meowtrix/package.json`)
Update root `package.json` to enable npm workspaces:

```json
{
  "name": "meowtrix",
  "version": "1.26.6",
  "workspaces": [
    "packages/*"
  ],
  "dependencies": {
    "@codesign/canvas": "*",
    "@codesign/server": "*",
    "...existing dependencies..."
  }
}
```

### 5.2 Server Mounting (`meowtrix/server.js`)
In `server.js`, mount the `@codesign/server` router alongside `mountAiRoutes`:

```javascript
// ── CoDesign Living Spec & MCP Service ────────────────────────────────────────
const { createCodesignRouter } = require('@codesign/server');

const { router: codesignRouter, events: codesignEvents } = createCodesignRouter({
  resolveWorkspaceDir: (req) => {
    // Return the workspace directory from query/header, or default to current host directory
    return req.query.dir || req.headers['x-codesign-dir'] || process.cwd();
  },
  wss // Pass Meowtrix WebSocket server for cross-session broadcasts
});

app.use('/api/codesign', codesignRouter);

// Serve @codesign/canvas static assets directly for the frontend
app.use('/vendor/codesign', express.static(path.join(__dirname, 'packages', 'codesign-canvas')));
```

### 5.3 Static Script & Link Tags (`meowtrix/public/index.html`)
Add the CoDesign stylesheet and script loader right before `pane.js`:

```html
  <link rel="stylesheet" href="/vendor/codesign/styles/codesign.css">
  ...
  <script src="/vendor/codesign/index.js" type="module"></script>
```
*(Or bundle `packages/codesign-canvas` into an IIFE/UMD build loaded via `<script src="/vendor/codesign/dist/codesign.js"></script>` to match Meowtrix's non-bundler ES script model).*

### 5.4 Tab Registration (`meowtrix/public/pane.js`)

1. **Tab Icon**: Add `'codesign'` to `getTabIconSvg(type)`:
```javascript
case 'codesign':
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>`;
```

2. **Tab Model**: Add `codesignDir` to the `tab` object in `addTab()`:
```javascript
const tab = {
  id,
  type,
  tabEl,
  viewEl,
  label,
  // ... existing fields ...
  codesignDir: type === 'codesign' ? existingDir : null,
  // ...
};
```

3. **Tab Initializer Branch**:
```javascript
else if (type === 'editor') initEditorTab(tab, viewEl, existingDir);
else if (type === 'agent') {
  if (typeof initAgentTab === 'function') initAgentTab(tab, viewEl, existingDir);
}
else if (type === 'codesign') {
  initCodesignTab(tab, viewEl, existingDir);
}
else initBrowserTab(tab, viewEl, label, existingUrl);
```

4. **Tab Constructor Implementation (`initCodesignTab`)**:
```javascript
function initCodesignTab(tab, viewEl, dir) {
  viewEl.classList.add('codesign-view');
  tab.codesignDir = dir || '';
  if (dir && tab.label && !tab.isCustomLabel) {
    tab.label.textContent = `Spec: ${basename(dir)}`;
  }

  // Mount the canvas engine from @codesign/canvas
  if (typeof window.mountCodesignCanvas === 'function') {
    tab.canvasInstance = window.mountCodesignCanvas(viewEl, {
      apiBase: '/api/codesign',
      workingDir: tab.codesignDir,
      onFeedbackCreated: () => saveSessionState(),
      onSignOff: () => {
        if (typeof showToast === 'function') showToast('Design approved & signed off!');
      }
    });
  }

  tab.onActivate = () => {
    tab.canvasInstance?.reloadSpec();
  };

  tab.onClose = () => {
    tab.canvasInstance?.destroy();
  };
}
```

### 5.5 Tab Type Picker & Workspace Persistence (`meowtrix/public/app.js`)

1. **Tab Type Picker (`showTabTypePicker`)**:
Add `'CoDesign Canvas'` to the picker items:
```javascript
[
  ['Terminal', 'terminal'],
  ['SSH', 'ssh'],
  ['AI Agent', 'agent'],
  ['CoDesign', 'codesign'],
  ['Browser', 'browser'],
  ['Code editor', 'editor']
].forEach(([text, type]) => {
  // ...
  btn.addEventListener('click', async () => {
    closeAll();
    if (type === 'codesign') {
      const dir = await promptForFolder();
      if (!dir) return;
      addTab(pane, 'codesign', undefined, undefined, undefined, dir);
    } else if (type === 'editor') {
      const dir = await promptForFolder();
      if (!dir) return;
      addTab(pane, 'editor', undefined, undefined, undefined, dir);
    } else {
      addTab(pane, type);
    }
    saveSessionState();
  });
});
```

2. **Workspace State Serialization (`captureWorkspaceState`)**:
Persist `codesignDir`:
```javascript
codesignDir: t.type === 'codesign' ? (t.codesignDir || '') : null,
```

3. **Workspace State Restoration (`restoreWorkspaceState`)**:
Pass `codesignDir` when rebuilding tabs from serialized state:
```javascript
const tab = addTab(
  pane,
  tabState.type,
  tabState.id,
  tabState.ptyId,
  tabState.browserUrl,
  tabState.editorDir || tabState.codesignDir,
  // ...
);
```

4. **Command Palette (`meowtrix/public/palette.js`)**:
Add a command:
```javascript
{
  id: 'tab:new-codesign',
  title: 'New CoDesign canvas tab',
  category: 'Tabs',
  action: async () => {
    if (!activePane) return;
    const dir = await promptForFolder();
    if (!dir) return;
    addTab(activePane, 'codesign', undefined, undefined, undefined, dir);
    saveSessionState();
  }
}
```

---

## 6. Living Spec Workflow: Step-by-Step Walkthrough

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Meowtrix Window Layout                          │
├──────────────────────────────────┬─────────────────────────────────────┤
│ Pane 1: Terminal Tab             │ Pane 2: CoDesign Canvas Tab         │
│ (Running Claude Code)            │ (Mounted via @codesign/canvas)      │
│                                  │                                     │
│ 1. User prompts:                 │                                     │
│    "Design a DoorDash home page" │                                     │
│                                  │                                     │
│ 2. Claude writes:                │ 3. Canvas auto-renders spec HTML:   │
│    .codesign/spec.html           │    ┌──────────────────────────────┐ │
│                                  │    │ 📱 DoorDash Living Spec      │ │
│ 4. Claude invokes MCP tool:      │    │ [Hero Carousel]              │ │
│    codesign_refresh_spec(...)    │    │ [Restaurant Grid]            │ │
│                                  │    │                              │ │
│ 5. Claude invokes MCP tool:      │    │ User clicks to drop pin:     │ │
│    codesign_await_signoff(...)   │    │ 🔴 #1: "Make badge smaller"  │ │
│    (Waiting for signoff...)      │    └──────────────────────────────┘ │
│                                  │                                     │
│ 6. Tool returns feedback! ◄──────┴── User clicks "Send Feedback"       │
│                                                                        │
│ 7. Claude modifies spec.html &   │ 8. Canvas updates instantly!        │
│    calls codesign_resolve(...)   │                                     │
│                                  │                                     │
│ 9. Claude awaits signoff again   │ 10. User clicks "Sign Off"!         │
│ 11. Claude reports: Finished!    │                                     │
└──────────────────────────────────┴─────────────────────────────────────┘
```

1. **Workspace Setup**:
   The workspace project directory has `.mcp.json` pointing to:
   ```json
   {
     "mcpServers": {
       "codesign": {
         "type": "sse",
         "url": "http://127.0.0.1:9123/api/codesign/mcp"
       }
     }
   }
   ```
2. **Drafting Phase**:
   Claude Code drafts the UI, writing to `.codesign/spec.html` and calling `codesign_create_spec`.
3. **Visual Feedback Phase**:
   The developer inspects the living spec in the CoDesign tab, switches between mobile/desktop device viewports, and drops comment pins with CSS annotations.
4. **Resolution Phase**:
   Claude reads the feedback items, updates the spec code, marks the comments resolved with `codesign_resolve_feedback`, and presents the final build.
5. **Sign-Off**:
   The user clicks "Approve & Sign Off". The `codesign_await_signoff` tool call resolves with `{ approved: true }`.

---

## 7. Migration & Implementation Checklist

A coding agent implementing this design should execute the following steps in sequence:

### Phase 1: Package Scaffolding
- [ ] Configure `workspaces: ["packages/*"]` in `/Volumes/DATA/GitHub/meowtrix/package.json`.
- [ ] Create `packages/codesign-canvas/` and port `src/core/` and `src/js/renderer-view.js` from `prototype-02` into clean modules.
- [ ] Create `packages/codesign-server/` with Express SSE transport and `codesign_*` MCP tool handlers.
- [ ] Run `npm install` in Meowtrix root to verify workspace symlinks in `node_modules/@codesign/*`.

### Phase 2: Server Mounting
- [ ] In `meowtrix/server.js`, import and mount `createCodesignRouter` at `/api/codesign`.
- [ ] Serve `/vendor/codesign` from `packages/codesign-canvas`.
- [ ] Verify `curl -N http://127.0.0.1:9123/api/codesign/mcp` receives SSE initialization headers.

### Phase 3: Frontend Tab Integration
- [ ] Include CoDesign script & stylesheet in `meowtrix/public/index.html`.
- [ ] Add `'codesign'` tab icon in `getTabIconSvg()` in `meowtrix/public/pane.js`.
- [ ] Implement `initCodesignTab()` in `meowtrix/public/pane.js`.
- [ ] Add `'CoDesign'` option to `showTabTypePicker()` in `meowtrix/public/app.js`.
- [ ] Add state persistence for `codesignDir` in `captureWorkspaceState()` / `restoreWorkspaceState()`.
- [ ] Add palette command in `meowtrix/public/palette.js`.

### Phase 4: E2E Verification
- [ ] Open Meowtrix (`npm start`).
- [ ] Click `+` and select **CoDesign**. Select a project directory.
- [ ] Verify CoDesign Canvas tab loads with device toolbar and blank spec canvas.
- [ ] Run test script simulating an agent calling `codesign_create_spec`.
- [ ] Verify spec renders live on the canvas, pins can be dropped, and sign-off unblocks the agent.
