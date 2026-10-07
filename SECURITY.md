# Security Policy

## Supported versions

Security fixes are applied to the latest release on `main` and to current Docker image tags (`latest` and semver tags published from CI). Older releases are not backported by default.

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report privately via one of:

- GitHub Security Advisories: [Report a vulnerability](https://github.com/Web-SyncPlay/Web-SyncPlay/security/advisories/new)
- Contact the maintainer: [@Yasamato](https://github.com/Yasamato)

Include a clear description, impact, and steps to reproduce if possible. You should receive an acknowledgement within a few days. We will coordinate a fix and disclosure timeline with you.

## Scope

In scope: the Web-SyncPlay application, its HTTP/WebSocket APIs, Docker image build, and GitHub Actions workflows in this repository.

Out of scope: third-party services (Docker Hub, STUN providers, yt-dlp upstreams), self-hosted deployment misconfiguration, and issues that only affect outdated/unsupported deployments.
