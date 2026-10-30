"""Deterministic gates shared by discovery, execution and publication."""
import hashlib
import json
import re


class Stop(Exception):
    """An item is ineligible or a prerequisite is not met."""


class Pause(Exception):
    """Stop the sweep on operational/model failures; never use another provider."""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def eligible(item, config):
    if item.get("repository_url") != "https://api.github.com/repos/" + config["repository"]:
        raise Stop("repository mismatch")
    if item.get("user", {}).get("login", "").lower() not in config["authors"]:
        raise Stop("author not allowed")
    if item.get("state") != "open" or item.get("locked"):
        raise Stop("item closed or locked")


def successful_runs(pr, workflows, config):
    """Input is complete, workflow-specific API output, never success-filtered."""
    receipt = []
    for spec in config["pipelines"]:
        source = workflows[spec["path"]]
        candidates = []
        for run in source["runs"]:
            if (run["workflow_id"] != source["id"] or run["event"] != "pull_request"
                    or run["head_sha"] != pr["head"]["sha"]):
                continue
            associated = any(p["number"] == pr["number"] for p in run.get("pull_requests", []))
            # Fork runs may omit pull_requests. Require both repository ID and branch.
            if not run.get("pull_requests"):
                associated = (run.get("head_repository", {}).get("id") == pr["head"]["repo"]["id"]
                              and run.get("head_branch") == pr["head"]["ref"])
            if associated:
                candidates.append(run)
        if not candidates:
            raise Stop("CI missing: " + spec["path"])
        run = max(candidates, key=lambda r: (r["run_number"], r["run_attempt"]))
        if run["status"] != "completed" or run["conclusion"] != "success":
            raise Stop(f"CI not successful: {spec['path']} ({run['status']}/{run['conclusion']})")
        jobs = source["jobs"].get(str(run["id"]), [])
        latest = {}
        for job in jobs:
            if job["name"] not in latest or job["id"] > latest[job["name"]]["id"]:
                latest[job["name"]] = job
        if not latest or any(j["status"] != "completed" or j["conclusion"] != "success" for j in latest.values()):
            raise Stop("CI job missing or unsuccessful: " + spec["path"])
        for pattern in spec["jobs"]:
            if not any(re.fullmatch(pattern, name) for name in latest):
                raise Stop("CI expected job missing: " + pattern)
        receipt.append({"path": spec["path"], "id": run["id"], "attempt": run["run_attempt"],
                        "sha": run["head_sha"], "url": run["html_url"],
                        "status": run["status"], "conclusion": run["conclusion"],
                        "jobs": [{k: job[k] for k in ("id", "name", "status", "conclusion")}
                                 for job in sorted(latest.values(), key=lambda j: j["name"])]})
    return receipt


STATES = {"continue", "needs-information", "needs-maintainer-decision", "blocked", "ready", "handoff", "support", "verified-fixed"}
LABELS = {"needs-information", "needs-maintainer-decision", "review-ready"}
CONTRACT_VERSION = 5


def assessment(value, phase):
    required = {"kind", "scope", "state", "summary", "findings", "next_step", "security", "blockers", "scope_decisions", "malicious"}
    if not isinstance(value, dict) or set(value) != required:
        raise Pause("Invalid model output fields")
    if value["kind"] not in {"bug", "feature", "disputed", "support"} or value["state"] not in STATES:
        raise Pause("Invalid model decision")
    if value["scope"] not in {"routine", "fundamental", "uncertain"}:
        raise Pause("Invalid product-scope assessment")
    if value["security"] not in {"PASS", "BLOCK", "NOT VERIFIED"} or type(value["malicious"]) is not bool:
        raise Pause("Invalid security decision")
    if not isinstance(value["summary"], str) or not 20 <= len(value["summary"]) <= 400:
        raise Pause("Invalid report summary")
    if (not isinstance(value["findings"], list) or not 1 <= len(value["findings"]) <= 3
            or any(not isinstance(s, str) or not 1 <= len(s) <= 400 for s in value["findings"])):
        raise Pause("Invalid report findings")
    step = value["next_step"]
    if (not isinstance(step, dict) or set(step) != {"owner", "action"}
            or step["owner"] not in {"author", "maintainer", "none"}
            or not isinstance(step["action"], str) or not 10 <= len(step["action"]) <= 600):
        raise Pause("Invalid next step")
    if value["state"] in {"needs-information", "needs-maintainer-decision", "blocked", "ready"} and step["owner"] == "none":
        raise Pause("Actionable states must name who acts next")
    if value["state"] in {"needs-maintainer-decision", "ready"} and step["owner"] != "maintainer":
        raise Pause("Maintainer state requires a maintainer next step")
    if not isinstance(value["blockers"], list) or any(not isinstance(s, str) for s in value["blockers"]):
        raise Pause("Invalid blocker list")
    if not isinstance(value["scope_decisions"], list) or any(type(i) is not int for i in value["scope_decisions"]):
        raise Pause("Invalid scope references")
    if value["malicious"] and value["state"] != "blocked":
        raise Pause("Detected attack must stop the item")
    if value["state"] == "ready" and (phase != "final" or value["security"] != "PASS" or value["blockers"]):
        raise Pause("Readiness requires a final, unblocked security pass")
    if value["state"] == "continue" and (phase != "completeness" or value["blockers"] or value["malicious"]):
        raise Pause("Invalid stage continuation")
    return value
