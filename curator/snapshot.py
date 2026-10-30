from .github import quote
from .policy import Stop, eligible, successful_runs


def snapshot(api, config, checkpoints, number):
    item = api.get(f"/issues/{number}")
    eligible(item, config)
    if any(label["name"] == "deferred" for label in item["labels"]):
        raise Stop("deferred; a maintainer must remove the deferred label to resume")
    pr, receipt = None, []
    if "pull_request" in item:
        pr = api.get(f"/pulls/{number}")
        if pr.get("draft"):
            raise Stop("draft PR")
        if pr["state"] != "open" or pr["user"]["login"].lower() not in config["authors"]:
            raise Stop("PR no longer eligible")
        workflows = {}
        for spec in config["pipelines"]:
            workflow = api.get("/actions/workflows/" + quote(spec["path"].split("/")[-1]))
            if workflow["path"] != spec["path"] or workflow["state"] != "active":
                raise Stop("unexpected or disabled workflow")
            runs = api.pages(f"/actions/workflows/{workflow['id']}/runs?event=pull_request&head_sha={pr['head']['sha']}", "workflow_runs")
            jobs = {}
            if runs:
                latest = max(runs, key=lambda r: (r["run_number"], r["run_attempt"]))
                if latest["status"] == "completed" and latest["conclusion"] == "success":
                    jobs[str(latest["id"])] = api.pages(f"/actions/runs/{latest['id']}/jobs?filter=all", "jobs")
            workflows[spec["path"]] = {"id": workflow["id"], "runs": runs, "jobs": jobs}
        receipt = successful_runs(pr, workflows, config)
        # Additional legacy statuses cannot hide behind green Actions workflows.
        statuses = api.pages(f"/commits/{pr['head']['sha']}/statuses")
        latest_status = {}
        for status in statuses:
            key = status["context"].lower()
            if key not in latest_status or status["id"] > latest_status[key]["id"]:
                latest_status[key] = status
        if any(s["state"] != "success" for s in latest_status.values()):
            raise Stop("additional commit status not successful")
        # Ruleset requirements must actually be present, not inferred from workflow success.
        rules = api.get("/rules/branches/" + quote(pr["base"]["ref"]))
        checks = api.pages(f"/commits/{pr['head']['sha']}/check-runs?filter=latest", "check_runs")
        for rule in rules:
            if rule["type"] != "required_status_checks":
                continue
            for requirement in rule["parameters"]["required_status_checks"]:
                name, app = requirement["context"], requirement.get("integration_id")
                matches = [c for c in checks if c["name"] == name and (not app or c["app"]["id"] == app)]
                if matches:
                    check = max(matches, key=lambda c: c["id"])
                    if check["status"] != "completed" or check["conclusion"] != "success":
                        raise Stop("required check unsuccessful: " + name)
                elif name.lower() not in latest_status or app:
                    raise Stop("required check missing: " + name)
        current = api.get(f"/pulls/{number}")
        if (current["head"]["sha"], current["base"]["sha"]) != (pr["head"]["sha"], pr["base"]["sha"]):
            raise Stop("PR changed during CI gate")
    comments = api.pages(f"/issues/{number}/comments")
    events = list(comments)
    if pr:
        events += api.pages(f"/pulls/{number}/reviews")
        events += api.pages(f"/pulls/{number}/comments")
    status_comment, previous = checkpoints.current(comments, number)
    return {"item": item, "pr": pr, "ci": receipt, "events": events, "comments": comments,
            "status_comment": status_comment, "previous": previous,
            "fingerprint": checkpoints.fingerprint(item, pr, events)}


def validate_scope(result, snap, config, checkpoints):
    if result["kind"] not in {"feature", "disputed"} or result["state"] not in {"continue", "ready"}:
        return
    # Explicit same-revision decisions are deterministic; conflicting decisions block.
    head = snap["pr"]["head"]["sha"] if snap["pr"] else "issue"
    previous = snap.get("previous") or {}
    previous_decisions = set(previous.get("assessment", {}).get("scope_decisions", []))
    accepted, rejected = set(), set()
    for e in snap["events"]:
        if e.get("user", {}).get("login", "").lower() not in config["maintainers"] or checkpoints.decode(e, snap["item"]["number"]):
            continue
        lines = (e.get("body") or "").splitlines()
        if f"/curator scope accept {head}" in lines:
            accepted.add(e["id"])
        if e["id"] in previous_decisions and f"/curator scope accept {previous.get('head')}" in lines:
            # Luna/Sol must explicitly cite the same acceptance after inspecting
            # the supplied delta. A SHA change alone does not change product scope.
            accepted.add(e["id"])
        if f"/curator scope reject {head}" in lines:
            rejected.add(e["id"])
        if previous.get("head") and f"/curator scope reject {previous['head']}" in lines:
            rejected.add(e["id"])
    if rejected or not accepted or not set(result["scope_decisions"]) & accepted:
        result.update(state="needs-maintainer-decision", blockers=["Explicit, unconflicted maintainer scope acceptance is required."])
        result["body"] += f"\n\nScope gate: @klaudworks or @huacnlee must record `/curator scope accept {head}` after resolving any conflicting scope decision."
