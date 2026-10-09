---
name: Bug report
about: Report incorrect behavior in Web-SyncPlay
title: "[BUG] "
labels: bug
assignees: ""
---

## Description

What went wrong? Include the room route if relevant (`/room/[id]`, `/embed`, `/player`, `/control`).

## Steps to reproduce

1.
2.
3.

## Expected behavior

What should have happened?

## Actual behavior

What happened instead? Include error messages or UI symptoms.

## Environment

- **Deployment:** [ ] web-syncplay.de  [ ] self-hosted Docker  [ ] local Bun (`bun run dev`)
- **Browser / version:**
- **OS:**
- **App version / image tag:** (commit SHA, `latest`, or semver if known)

## Logs and health (if relevant)

Paste redacted server logs, browser console errors, or `GET /api/health` output. For sync/WebRTC issues, note whether UDP 40000 is reachable and whether local media used SFU, P2P, or HTTP relay.

Do **not** report security vulnerabilities here — see [SECURITY.md](../../SECURITY.md).
