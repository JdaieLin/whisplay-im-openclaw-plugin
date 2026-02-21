# whisplay-im OpenClaw Channel

`whisplay-im` is an IM channel adapter for OpenClaw, used to integrate with the Whisplay Chatbot device bridge interface.

- OpenClaw pulls user messages: `GET /whisplay-im/poll`
- OpenClaw sends reply messages: `POST /whisplay-im/send`
- Optional authentication supported: `Authorization: Bearer <token>`

## Contents

- `whisplay-im/index.js`: OpenClaw channel plugin implementation
- `whisplay-im/openclaw.channel.json`: OpenClaw channel metadata
- `whisplay-im/openclaw.plugin.json`: plugin metadata
- `whisplay-im/SKILL.md`: protocol contract

## Installation

This channel is a JavaScript OpenClaw plugin. No Python runtime is required.

### 1) Place plugin in OpenClaw extensions

Set `plugins.installs.whisplay-im.sourcePath` in your `~/.openclaw/openclaw.json` to:

`/absolute/path/to/whisplay-im-openclaw-plugin/whisplay-im`

Or copy `whisplay-im/index.js` into your installed extension directory:

`~/.openclaw/extensions/whisplay-im/index.js`

### 1.1) Complete `openclaw.json` example

Use this as a complete, copy-ready example for `~/.openclaw/openclaw.json` (focused on `whisplay-im` related settings):

```json
{
	"plugins": {
		"allow": [
			"whisplay-im"
		],
		"installs": {
			"whisplay-im": {
				"sourcePath": "/absolute/path/to/whisplay-im-openclaw-plugin/whisplay-im"
			}
		}
	},
	"channels": {
		"whisplay-im": {
			"enabled": true,
			"accounts": {
				"default": {
					"ip": "192.168.1.50:18888",
					"token": "",
					"waitSec": 60
				}
			}
		}
	}
}
```

Notes:

- Replace `sourcePath` with your real absolute path.
- `ip` supports both `host:port` and `http://host:port`.
- Keep `token` as empty string if your device API does not require auth.
- `accounts.default` should match the account id used by channel runtime status.
- Device settings must be configured under `accounts.<id>` only.
- Top-level `channels.whisplay-im.ip/token/waitSec` is deprecated and not supported.

### 1.2) Multi-device / multi-account `accounts` example

If you connect multiple Whisplay devices, configure multiple account ids under `channels.whisplay-im.accounts`:

```json
{
	"channels": {
		"whisplay-im": {
			"enabled": true,
			"accounts": {
				"default": {
					"name": "Default Device",
					"ip": "192.168.1.50:18888",
					"token": "",
					"waitSec": 60
				},
				"home": {
					"name": "Home",
					"ip": "192.168.1.51:18888",
					"token": "home-token",
					"waitSec": 25
				},
				"office": {
					"name": "Office",
					"ip": "10.0.10.20:18888",
					"token": "office-token",
					"waitSec": 20
				}
			}
		}
	}
}
```

Notes:

- `default` is recommended as the primary account id.
- Account ids (`default`, `home`, `office`) become runtime account identifiers in channel status/logs.
- `accounts.<id>.name` is used in Chat conversation labels (for example: `whisplay (Office)`).
- You can use any stable id names; avoid spaces and keep them short.
- No top-level device fallback: every active account must define its own `ip`.

### 2) Restart gateway

```bash
openclaw gateway restart
```

### 3) Verify plugin is loaded

```bash
openclaw channels status
```

You should see `Whisplay IM` in configured/running channels.

## OpenClaw Page Configuration

Configure channel accounts in `~/.openclaw/openclaw.json` under `channels.whisplay-im.accounts`.

Minimum required structure:

```json
{
	"channels": {
		"whisplay-im": {
			"enabled": true,
			"accounts": {
				"default": {
					"ip": "192.168.1.50:18888"
				}
			}
		}
	}
}
```

Optional per-account fields: `name`, `token`, `waitSec` (default `60`), `enabled`.

## Local Debugging

### 1) Poll user messages

```bash
curl -X GET \
	-H "Authorization: Bearer <token>" \
	"http://<device-host>:18888/whisplay-im/poll?waitSec=60"
```

### 2) Send reply messages

```bash
curl -X POST \
	-H "Authorization: Bearer <token>" \
	-H "Content-Type: application/json" \
	-d '{"reply":"Hello, I am OpenClaw","emoji":"🤖"}' \
	"http://<device-host>:18888/whisplay-im/send"
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
