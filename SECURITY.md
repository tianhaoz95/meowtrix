# Security Policy

## Threat model — read this first

Meowtrix is a **remote workspace that gives whoever can reach it a shell on the
host machine**, plus full read/write access to the host filesystem (via the code
editor's file API) and the ability to run arbitrary commands in PTYs. There is
**no built-in authentication, authorization, or encryption.** Anyone who can open
a WebSocket to the server has the same power as the user who started it.

Treat the server's network address as a credential. Protecting it is the
operator's responsibility, not the application's.

### What this means in practice

- **Localhost is the safe default, and it is the default.** With no flags the
  server binds to `127.0.0.1`, reachable only from the same machine. Reach it
  remotely over an **SSH tunnel** (`ssh -L 9123:localhost:9123 host`) or a
  similarly authenticated/encrypted channel.
- **Network exposure is an explicit opt-in.** `--network`/`-n` (binds
  `0.0.0.0`), `--host <addr>`, or the `HOST` env var open the server to the LAN
  or beyond. Do this only on a trusted network, ideally behind a reverse proxy
  that adds authentication and TLS.
- **A `--service` install binds to all interfaces (`HOST=0.0.0.0`) by default.**
  An auto-starting launchd/systemd service is network-reachable out of the box.
  To scope it back to localhost, set `HOST=127.0.0.1` in the unit and reload it.
- **Tunnels (ngrok, Cloudflare Tunnel, etc.) publish your shell to the public
  internet.** If you expose Meowtrix this way, put authentication in front of it.
- **The embedding proxy (`/proxy`) strips frame-blocking headers and fetches
  arbitrary URLs server-side.** Anyone who can reach the server can use it as an
  open-ish proxy from the host's network position. Keep it off untrusted
  networks.

If you are running Meowtrix exposed to a network you do not fully control without
an added auth layer, that is a misconfiguration, not a vulnerability in Meowtrix.

## Supported versions

This is a single-application project distributed from `main`. Security fixes land
on `main` and ship in the next release. Please run the latest release (the
built-in self-update keeps a service install current).

| Version | Supported          |
| ------- | ------------------ |
| Latest `main` / release | ✅ |
| Older releases | ❌ (please update) |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately via GitHub's **Security Advisories**:
<https://github.com/tianhaoz95/meowtrix/security/advisories/new>

When reporting, please include:

- A description of the issue and its impact.
- Steps to reproduce (proof-of-concept if possible).
- The Meowtrix version (`package.json` `version`) and how it was run
  (manual launcher vs. `--service`, network flags, any proxy/tunnel in front).
- Whether the issue requires network exposure or is exploitable from the
  loopback-only default.

### What's in scope

Bugs that break the documented security model, for example:

- Path traversal or escape in the file API (`/api/fs/*`) or git endpoints
  (`/api/git/*`) beyond the opened root.
- The embedding proxy being abusable to reach internal hosts in ways that
  bypass the intended use (SSRF beyond what an operator who controls access
  would expect).
- A way to execute code or read/write files **without** already being able to
  reach the server — e.g. a crafted page, OSC sequence, or malicious repo that
  pivots into the host.
- Crashes or memory issues triggerable by an attacker who is *not* otherwise
  authorized.

### What's out of scope

These follow directly from the threat model above and are **not** vulnerabilities:

- "There's no login / password / auth." Correct, by design — see the threat
  model. Add your own auth layer if you expose it.
- "Anyone who reaches the server gets a shell / can read my files / can run
  `mtx`." That is the entire purpose of the tool.
- "Running with `--network` on an untrusted LAN let someone in." That is an
  operator configuration choice.
- The self-update performing a `git pull` when triggered — anyone who can
  trigger it already has a shell on the host.

### Response expectations

This is a small, best-effort open-source project. We aim to acknowledge reports
within a few days and to address confirmed issues in a reasonable timeframe, but
no formal SLA is promised. Coordinated disclosure is appreciated — please give us
a chance to ship a fix before publishing details.

## Hardening checklist for operators

- Prefer the **localhost default + SSH tunnel** over binding to a network.
- If you must expose it, put it **behind a reverse proxy** that enforces
  authentication and TLS, and restrict source IPs (firewall / security group).
- Don't run a public tunnel without auth in front of it.
- Run Meowtrix as a **dedicated, least-privileged user**, not root — its shells
  inherit that user's full permissions.
- Review the `HOST` value in any `--service` unit; default it to `127.0.0.1`
  unless remote reach is intended.
- Keep up to date so security fixes apply.
