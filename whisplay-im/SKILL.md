---
name: whisplay-im
description: HTTP bridge in Whisplay device for IM-style chat.
metadata:
  openclaw:
    emoji: "🤖"
    os:
      - linux
      - darwin
    requires:
      bins:
        - curl
---

# whisplay-im Bridge

## Overview

Use `whisplay-im` to connect OpenClaw to a Whisplay device as a pure IM bridge.
The device pushes ASR text into the bridge. OpenClaw polls for new messages and sends replies back for TTS playback.

## Inputs to collect

- Bridge base URL (host/port)
- Auth token for `Authorization: Bearer <token>` (optional)
- `waitSec` for long-polling (optional)

## Actions

### Poll for a new message

```bash
curl -X GET \
  -H "Authorization: Bearer <token>" \
  "http://<device-host>:18888/whisplay-im/poll?waitSec=30"
```

### Send reply to device

```bash
curl -X POST \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"reply":"Hello from OpenClaw","emoji":"🦞"}' \
  http://<device-host>:18888/whisplay-im/send
```

## Notes

- `poll` returns an empty payload when no message is available.
- `send` supports optional `emoji`.
