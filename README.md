# whisplay-im OpenClaw Channel

`whisplay-im` is an IM channel adapter for OpenClaw, used to integrate with the Whisplay Chatbot device bridge interface.

- OpenClaw pulls user messages: `GET /whisplay-im/poll`
- OpenClaw sends reply messages: `POST /whisplay-im/send`
- Optional authentication supported: `Authorization: Bearer <token>`

## Contents

- `whisplay-im/whisplay_im_channel.py`: Channel implementation and CLI
- `whisplay-im/openclaw.channel.json`: OpenClaw config page field definitions (`ip`, `token`, `waitSec`)
- `whisplay-im/requirements.txt`: Dependencies

## Installation

```bash
cd whisplay-im
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## OpenClaw Page Configuration

Fill in the following fields on the OpenClaw channel config page:

- `ip` (required): Whisplay device address, supports `host:port` or `http://host:port`
- `token` (optional): Bearer token
- `waitSec` (optional, default: 30): polling wait time in seconds

Example:

- `ip`: `192.168.1.50:18888`
- `token`: leave empty or set to `xxxx`
- `waitSec`: `30`

## Local Debugging

### 1) Poll user messages

```bash
python whisplay_im_channel.py --ip 192.168.1.50:18888 --token "" poll --wait-sec 30
```

### 2) Send reply messages

```bash
python whisplay_im_channel.py --ip 192.168.1.50:18888 send --reply "Hello, I am OpenClaw" --emoji "🤖"
```

## OpenClaw Integration Notes

OpenClaw periodically runs `poll` to fetch the latest user input; after generating a response, it calls `send` to send it back to the Whisplay device.

1. Call `poll`: returns `null` when there is no new message.
2. If a message exists, read the `text` field as user input.
3. After inference, call `send`, put the response in `reply`, and optionally include `emoji`.

## Alignment with SKILL.md

This implementation follows the protocol in `openclaw/skills/whisplay-im/SKILL.md`:

- `GET /whisplay-im/poll?waitSec=<n>`
- `POST /whisplay-im/send`, Body: `{"reply":"...","emoji":"..."}`
- token is optional
