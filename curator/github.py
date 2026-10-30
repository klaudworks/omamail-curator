"""Fixed-origin GitHub client. No model-selected endpoints or credentials."""
import json
import urllib.error
import urllib.parse
import urllib.request
from .policy import Pause


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, token, repository):
        self.token = token
        self.repository = repository
        self.prefix = "/repos/" + repository
        self.opener = urllib.request.build_opener(NoRedirect)

    def request(self, method, path, payload=None):
        if not path.startswith(self.prefix + "/") and not (method == "GET" and path == "/user"):
            raise Pause("GitHub repository boundary violation")
        request = urllib.request.Request("https://api.github.com" + path,
            data=None if payload is None else json.dumps(payload).encode(), method=method,
            headers={"Authorization": "Bearer " + self.token, "Accept": "application/vnd.github+json",
                     "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "omamail-curator",
                     "Content-Type": "application/json"})
        try:
            with self.opener.open(request, timeout=60) as response:
                raw = response.read(32 * 1024 * 1024 + 1)
                if len(raw) > 32 * 1024 * 1024:
                    raise Pause("GitHub response too large")
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as error:
            # Do not log token-bearing request objects or response bodies.
            raise Pause(f"GitHub HTTP {error.code}: {method} {path}") from None
        except (OSError, ValueError) as error:
            raise Pause("GitHub transport/JSON failure: " + type(error).__name__) from None

    def get(self, path):
        return self.request("GET", self.prefix + path)

    def pages(self, path, key=None):
        values = []
        page = 1
        while True:
            result = self.get(path + ("&" if "?" in path else "?") + f"per_page=100&page={page}")
            batch = result[key] if key else result
            if not isinstance(batch, list):
                raise Pause("Invalid paginated response")
            values.extend(batch)
            if len(batch) < 100:
                if key and "total_count" in result and len(values) < result["total_count"]:
                    raise Pause("Incomplete GitHub pagination")
                return values
            page += 1

    def mutate(self, method, path, payload=None):
        # Only Publisher calls this; it supplies literal endpoint families.
        return self.request(method, self.prefix + path, payload)


def quote(value):
    return urllib.parse.quote(str(value), safe="")
