"""Signed checkpoints in GitHub comments; no durable work queue."""
import base64
import hashlib
import hmac
import json
import re
from .policy import digest

MARK = re.compile(r"<!-- omamail-curator:v1:([A-Za-z0-9_-]+):([0-9a-f]{64}) -->")


class Checkpoints:
    def __init__(self, key, repository, login):
        self.key, self.repository, self.login = key, repository, login

    def encode(self, payload):
        raw = base64.urlsafe_b64encode(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).decode().rstrip("=")
        sig = hmac.new(self.key, raw.encode(), hashlib.sha256).hexdigest()
        return f"<!-- omamail-curator:v1:{raw}:{sig} -->"

    def decode(self, event, number, kind=None):
        if event.get("user", {}).get("login", "").lower() != self.login:
            return None
        matches = MARK.findall(event.get("body") or "")
        if len(matches) != 1:
            return None
        raw, sig = matches[0]
        if not hmac.compare_digest(sig, hmac.new(self.key, raw.encode(), hashlib.sha256).hexdigest()):
            return None
        try:
            data = json.loads(base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)))
        except (ValueError, UnicodeError):
            return None
        if data.get("repository") != self.repository or data.get("number") != number:
            return None
        if kind and data.get("type") != kind:
            return None
        visible = (event.get("body") or "").split("\n\n<!-- omamail-curator:v1:", 1)[0]
        if data.get("report_hash") != digest(visible):
            return None
        return data

    def current(self, comments, number):
        found = [(c, self.decode(c, number, "status")) for c in comments]
        found = [(c, p) for c, p in found if p]
        return max(found, key=lambda pair: pair[0]["id"]) if found else (None, None)

    def fingerprint(self, item, pr, events):
        relevant = [{k: e.get(k) for k in ("id", "body", "updated_at", "state", "commit_id", "user")}
                    for e in events if not self.decode(e, item["number"]) and e.get("user", {}).get("type") != "Bot"]
        return digest({"id": item["node_id"], "title": item["title"], "body": item.get("body"),
                       "head": pr["head"]["sha"] if pr else None, "base": pr["base"]["sha"] if pr else None,
                       "events": relevant})
