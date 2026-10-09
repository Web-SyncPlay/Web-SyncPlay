---
name: Feature request
about: Propose an improvement to Web-SyncPlay
title: "[FEAT] "
labels: enhancement
assignees: ""
---

## Problem

What user or operator need is unmet today?

## Proposed solution

How should Web-SyncPlay address it? Keep the description concrete (UI, API, realtime, media path).

## Alternatives considered

Other approaches you tried or rejected, and why.

## Scope notes

Web-SyncPlay is a **synced watch-party** app (shared playback, playlist, roles, local/remote media). Features outside that core need a clear justification, for example:

- **TURN** — ICE is STUN-only by design; UDP-blocked clients use HTTP local-media relay, not SFU. Propose TURN only with a concrete topology or failure case STUN/relay cannot cover.
- **Chat / social** — the room action log covers operational context; full chat or messaging is out of scope unless it clearly serves sync or room operation.

See [README.md](../../README.md) for architecture and deployment constraints. Multi-replica SFU limits: [Multi-replica operations (SFU)](../../README.md#multi-replica-operations-sfu).
