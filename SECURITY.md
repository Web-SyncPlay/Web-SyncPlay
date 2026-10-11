# Security Policy

## Supported versions

Security fixes land on `main` and on current Docker image tags (`latest` and
semver tags such as `3.0.0` / `3.0` published from CI). The supported major line
is **3.x**. Older majors (including **2.x**) are not backported by default.

## Reporting a vulnerability

**Do not** open a public GitHub issue for security vulnerabilities.

Report privately via:

- GitHub Security Advisories: [Report a vulnerability](https://github.com/Web-SyncPlay/Web-SyncPlay/security/advisories/new)
- Maintainer: [@Yasamato](https://github.com/Yasamato)

Include a clear description, impact, and steps to reproduce if possible. You should receive an acknowledgement within a few days. We will coordinate a fix and disclosure timeline with you.

## Scope

**In scope:** the Web-SyncPlay application, its HTTP/WebSocket APIs, Docker image build, and GitHub Actions workflows in this repository.

**Out of scope:** third-party services (Docker Hub, STUN providers, yt-dlp upstreams), self-hosted deployment misconfiguration, and issues that only affect outdated or unsupported deployments.
