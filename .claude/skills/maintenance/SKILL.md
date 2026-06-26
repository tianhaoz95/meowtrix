---
name: maintenance
description: Run the Meowtrix repo's routine maintenance pass — verify (and fix) the Playwright E2E suite, recapture the landing-page showcase screenshots, and check that README.md, CONTRIBUTING.md, and the website docs (user guide + developer docs) still match the code. Use when asked to "do maintenance", "run the maintenance pass", "check the repo is healthy", or before cutting a release.
---

# Meowtrix maintenance

A repeatable health pass for this repo. Run the steps in order; each is independent enough to run on its own if the user only asks for part of it. Always run from the repo root.

This skill is shared across Claude Code, Codex, and Antigravity (the latter two via symlinks — see "Cross-agent symlinks" at the end). Edit only `.claude/skills/maintenance/SKILL.md`; the others point at it.

## 1. E2E tests — verify, fix if red

```bash
npm run test:e2e
```

- The suite lives in `tests/` and runs across chromium, firefox, and webkit (`playwright.config.js`). It boots the server itself via the Playwright `webServer` config, so you don't start anything manually.
- If it's green, report that and move on.
- If it's red:
  1. Read the failure output and the relevant spec in `tests/meowtrix.spec.js`.
  2. Decide whether the **code** or the **test** is wrong. Tests assert real product behavior (toolbar layout, tab pickers, settings, command palette, session overlay) — a test failing usually means recent frontend/server changes drifted from it. Fix the side that's actually wrong; don't just relax the assertion to make it pass.
  3. Re-run until green. Use `npx playwright test <file>:<line>` to iterate on a single failing test faster, then do a full `npm run test:e2e` to confirm.
- Reports land in `playwright-report/` and `test-results/` (both gitignored, both wiped at the start of each run).

## 2. Recapture landing-page screenshots

The showcase screenshots on the website are generated, not hand-made:

```bash
npm run screenshots
```

- This drives `screenshots/screenshots.spec.js` via `playwright.screenshots.config.js` (chromium only, longer timeout). It builds the full 3-pane demo layout (editor + terminal + browser) and writes:
  - `website/assets/screenshot-dark.png`
  - `website/assets/screenshot-light.png`
- These are the images shown on `website/index.html`. Recapture them whenever the UI's look changed (theme, toolbar, layout, fonts).
- To eyeball the result, run `./preview-website.sh` (add `--capture` to recapture first) and open http://localhost:5173.
- If the capture spec itself breaks (e.g. a selector it clicks was renamed), fix the spec the same way as the E2E suite — it exercises real selectors.
- After regenerating, `git diff --stat website/assets` to confirm the PNGs actually changed; commit them if so.

## 3. Docs freshness check — update if stale

Check each of these against the current code/behavior and update anything that's drifted. Don't rewrite for style — only correct things that are now **wrong or missing**.

| File | What it documents | Common drift to check |
|------|-------------------|-----------------------|
| `README.md` | Install, Docker, service, update/uninstall, quick start, keyboard shortcuts, settings, "How it works" | New CLI flags, changed default `PORT` (9123), new settings, new keyboard shortcuts, install/service steps |
| `CONTRIBUTING.md` | Prerequisites, setup, project layout, dev guidelines, testing, PR flow | Project layout section vs. real files; test commands; Node/dep versions |
| `website/docs/index.html` | **User Guide** (end-user features) | New tab types, settings, palette commands, mobile bar, scheduled-Enter, self-update |
| `website/dev/index.html` | **Developer Docs** (architecture) | Should track `CLAUDE.md`'s architecture section — server responsibilities, PTY lifecycle, endpoints |

How to do the check efficiently:
- Treat `CLAUDE.md` as the source of truth for architecture and commands — it's kept current with the code. Diff the docs against it and against `package.json` (version, scripts, deps).
- Cross-check concrete facts that rot easily: the default port, the `npm` script names (`start`, `test:e2e`, `screenshots`), CLI flags (`--network`/`-n`, `--host`, `--service`), endpoint paths, and the keyboard-shortcut table.
- For each file, list what's stale before editing, then make minimal corrections.

## Wrap-up

Report a short summary: E2E result (and any fixes), whether screenshots changed, and which docs were updated (or "all current"). Per the repo's versioning guideline, if you changed shipped code/docs, bump the `version` in `package.json` (semver) — this drives the release draft tag.

## Cross-agent symlinks

This skill is exposed to the other agents the repo uses, all pointing back at this one file (relative symlinks, committed):

- **Codex** — `.codex/skills/maintenance` → `../../.claude/skills/maintenance` (Codex reads the same `SKILL.md` format).
- **Antigravity** — `.agents/workflows/maintenance.md` → `../../.claude/skills/maintenance/SKILL.md` (Antigravity's local-workflow path is `.agents/workflows/`).

To recreate them from the repo root:

```bash
mkdir -p .codex/skills .agents/workflows
ln -snf ../../.claude/skills/maintenance .codex/skills/maintenance
ln -snf ../../.claude/skills/maintenance/SKILL.md .agents/workflows/maintenance.md
```
