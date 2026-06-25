# Contributing to Meowtrix

Thanks for your interest in improving Meowtrix! 🐾 This guide covers how to set up
a dev environment, the conventions the codebase follows, and how to get a change
merged.

## Code of conduct

Be respectful and constructive. We want this to be a welcoming project for
contributors of all backgrounds and experience levels.

## Getting started

### Prerequisites

Meowtrix runs on the **host machine** (macOS or Linux). A source checkout needs:

- **Node.js 18+** and **npm**
- **git**
- **A C/C++ build toolchain** to compile `node-pty` natively:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`)
  - **Linux:** `build-essential` (or `gcc`/`make`) and `python3`

### Setup

```bash
git clone https://github.com/tianhaoz95/meowtrix.git
cd meowtrix
npm install        # compiles node-pty natively
npm start          # run on PORT (default 9123)
```

For day-to-day development use the hot-reload launcher, which runs the server
under `nodemon` and reloads the browser on changes:

```bash
./start.sh         # sets HOTRELOAD=1
```

Alternatively, a [Dev Container](https://containers.dev) config lives in
`.devcontainer/` — open the repo in VS Code or GitHub Codespaces and "Reopen in
Container" to get the toolchain preinstalled, then run `npm start`.

## Project layout

Meowtrix is deliberately small and build-step-free:

- **`server.js`** — the single Node server: serves `public/`, the settings/session
  REST API, the embedding proxy, the file/git APIs, and the WebSocket that
  multiplexes PTY sessions.
- **`public/`** — the frontend: plain global-scope ES scripts loaded via `<script>`
  tags in `index.html` (**no bundler, no modules**). Load order matters; functions
  are shared through the global scope.
- **`bin/mtx`** — the small host CLI that talks to the browser over private OSC
  sequences.
- **`tests/`** — Playwright end-to-end tests.

`CLAUDE.md` documents the full architecture (PTY lifecycle, session coordination,
scheduled-Enter timers, self-update, the embedding proxy, and the frontend module
map). **Read it before making non-trivial changes** — it explains *why* things are
shaped the way they are.

## Development guidelines

- **No build step.** The frontend is plain ES served directly from `public/`. After
  editing frontend code, reload the page (or use `./start.sh` for auto-reload).
  Don't introduce a bundler or a module system without discussion.
- **Global-scope frontend.** Cross-file calls are plain function references, not
  imports. Respect the load order in `index.html`.
- **Match the surrounding style.** Keep naming, comment density, and idioms
  consistent with the file you're editing.
- **Bump the version.** When you make a change, boost the `version` in
  [`package.json`](package.json) following [semantic versioning](https://semver.org/).
  The release workflow uses this version to name the release draft when pushed to
  `main`.
- **Keep the security model intact.** Meowtrix has no built-in auth and gives
  whoever can reach it a shell — see [`SECURITY.md`](SECURITY.md). Don't widen the
  default network exposure or weaken the localhost-first defaults without a clear
  rationale.
- **Update the docs.** If you change architecture or behavior, update `CLAUDE.md`,
  the `README.md`, and the developer docs as appropriate.

## Testing

Meowtrix uses [Playwright](https://playwright.dev) for end-to-end tests in `tests/`.

```bash
npm run test:e2e          # run the e2e suite
npm run test:e2e:ui       # run with the Playwright UI
npm run test:e2e:docker   # run the suite in Docker
```

Please run the e2e suite before opening a PR, and add or update tests for behavior
you change.

## Submitting changes

1. **Fork** the repository and create a branch off `main` for your change.
2. **Make focused commits** with clear messages describing what changed and why.
3. **Bump the version** in `package.json` (see above).
4. **Run the tests** (`npm run test:e2e`) and make sure they pass.
5. **Open a pull request** against `main`. Describe the change, the motivation, and
   any testing you did. Link any related issues.

Small, focused PRs are easier to review and land faster than large ones. If you're
planning a substantial change, consider opening an issue first to discuss the
approach.

## Reporting bugs and requesting features

Open an issue on GitHub. For bugs, include:

- What you expected to happen and what actually happened
- Steps to reproduce
- Your OS, Node.js version, and how you're running Meowtrix (manual launcher,
  `--service`, Docker, etc.)

For **security vulnerabilities**, do **not** open a public issue — follow the
disclosure process in [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the
[MIT License](LICENSE) that covers the project.
