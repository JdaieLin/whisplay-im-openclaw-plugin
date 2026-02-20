from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from typing import Any, Optional


@dataclass
class WhisplayIMConfig:
    ip: str
    token: Optional[str] = None
    wait_sec: int = 30
    timeout_sec: int = 35

    @property
    def base_url(self) -> str:
        ip = self.ip.strip()
        if ip.startswith("http://") or ip.startswith("https://"):
            return ip.rstrip("/")
        return f"http://{ip.rstrip('/')}"


class WhisplayIMChannel:
    def __init__(self, config: WhisplayIMConfig):
        try:
            import requests  # type: ignore
        except ModuleNotFoundError as exc:
            raise RuntimeError("missing dependency: requests; run `pip install -r requirements.txt`") from exc

        self._requests = requests
        self.config = config
        self.session = requests.Session()

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        token = (self.config.token or "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        return headers

    def poll(self, wait_sec: Optional[int] = None) -> Optional[dict[str, Any]]:
        wait = self.config.wait_sec if wait_sec is None else wait_sec
        response = self.session.get(
            f"{self.config.base_url}/whisplay-im/poll",
            params={"waitSec": wait},
            headers=self._headers(),
            timeout=self.config.timeout_sec,
        )
        response.raise_for_status()

        payload = self._safe_json(response)
        if not payload:
            return None

        message = payload.get("message")
        messages = payload.get("messages")
        if not message and messages and isinstance(messages, list):
            latest = messages[-1]
            if isinstance(latest, dict):
                message = latest.get("content")

        if not message:
            return None

        return {
            "text": message,
            "messages": messages,
            "raw": payload,
        }

    def send(self, reply: str, emoji: Optional[str] = None) -> dict[str, Any]:
        body: dict[str, Any] = {"reply": reply}
        if emoji:
            body["emoji"] = emoji

        response = self.session.post(
            f"{self.config.base_url}/whisplay-im/send",
            headers=self._headers(),
            data=json.dumps(body, ensure_ascii=False),
            timeout=self.config.timeout_sec,
        )
        response.raise_for_status()
        return self._safe_json(response)

    @staticmethod
    def _safe_json(response: Any) -> dict[str, Any]:
        if not response.text.strip():
            return {}
        try:
            data = response.json()
            if isinstance(data, dict):
                return data
            return {"data": data}
        except ValueError:
            return {"text": response.text}


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="whisplay-im-channel")
    parser.add_argument("--ip", required=True, help="bridge ip or host:port")
    parser.add_argument("--token", default="", help="optional bearer token")
    parser.add_argument("--wait-sec", type=int, default=30, help="poll waitSec")
    parser.add_argument("--timeout-sec", type=int, default=35, help="http timeout")

    sub = parser.add_subparsers(dest="action", required=True)

    poll = sub.add_parser("poll", help="poll one message")
    poll.add_argument("--wait-sec", type=int, default=None)

    send = sub.add_parser("send", help="send reply")
    send.add_argument("--reply", required=True)
    send.add_argument("--emoji", default=None)

    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    channel = WhisplayIMChannel(
        WhisplayIMConfig(
            ip=args.ip,
            token=args.token or None,
            wait_sec=args.wait_sec,
            timeout_sec=args.timeout_sec,
        )
    )

    if args.action == "poll":
        result = channel.poll(wait_sec=args.wait_sec)
        print(json.dumps(result, ensure_ascii=False))
        return

    if args.action == "send":
        result = channel.send(reply=args.reply, emoji=args.emoji)
        print(json.dumps(result, ensure_ascii=False))
        return

    parser.error(f"unsupported action: {args.action}")


if __name__ == "__main__":
    main()
