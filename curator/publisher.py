from .policy import CONTRACT_VERSION, Stop, LABELS, assessment, eligible, digest
from .snapshot import snapshot, validate_scope


class Publisher:
    def __init__(self, api, config, checkpoints):
        self.api, self.config, self.checkpoints = api, config, checkpoints

    def fresh(self, snap):
        current = snapshot(self.api, self.config, self.checkpoints, snap["item"]["number"])
        if current["fingerprint"] != snap["fingerprint"] or current["ci"] != snap["ci"]:
            raise Stop("publication inputs changed; discard stale result")
        return current

    def invalidate(self, item):
        """Deterministic housekeeping only: stale readiness must not survive red CI."""
        eligible(item, self.config)
        number = item["number"]
        if any(label["name"] == "review-ready" for label in item["labels"]):
            self.api.mutate("DELETE", f"/issues/{number}/labels/review-ready")

    def publish(self, snap, result, phase, sessions):
        assessment(result, phase)
        expected = ["openai/gpt-6-luna#xhigh"] + (["openai/gpt-6.1-sol#xhigh"] if phase == "final" else [])
        if ([s.get("model") for s in sessions] != expected or any(s.get("verified_tools") is not True for s in sessions)
                or len({s.get("session") for s in sessions}) != len(expected)):
            raise Stop("Publication requires verified selected-model sessions and evidence tools")
        validate_scope(result, snap, self.config, self.checkpoints)
        current = self.fresh(snap)
        n = snap["item"]["number"]
        sha = snap["pr"]["head"]["sha"] if snap["pr"] else None
        if result["state"] in {"continue", "ready"} and not snap["pr"]:
            raise Stop("issue cannot become PR-ready")
        warning = ""
        criteria_changed = snap.get("criteria_changed", (snap.get("previous") or {}).get("criteria_changed", False))
        if criteria_changed:
            warning = "\n\n**⚠️ THIS PR CHANGES THE RULES USED TO REVIEW IT**\nReview proposed criteria separately; execution and publication authority remain the curator policy."
        titles = {"continue": "Review in progress", "needs-information": "A check is still needed",
                  "needs-maintainer-decision": "A product decision is needed", "blocked": "An issue needs attention",
                  "ready": "Ready for maintainer review", "handoff": "Ready for next steps",
                  "support": "Suggested next step", "verified-fixed": "The fix is verified"}
        checks = " · ".join(f"[CI {i + 1}]({c['url']})" for i, c in enumerate(snap["ci"]))
        receipt = (f"[Commit {sha[:7]}](https://github.com/{self.config['repository']}/commit/{sha})" if sha else "")
        if checks:
            receipt += " · Checks passed: " + checks
        report = ("## " + titles[result["state"]] + "\n\n" + result["body"] + warning
                  + f"\n\n**Security: {result['security']}**"
                  + (" · " + receipt if receipt else "")
                  + "\n\n_Automated by [omamail-curator](https://github.com/klaudworks/omamail-curator)._")
        payload = {"type": "status", "contract_version": CONTRACT_VERSION, "repository": self.config["repository"], "number": n,
                   "fingerprint": snap["fingerprint"], "head": sha, "base": snap["pr"]["base"]["sha"] if snap["pr"] else None,
                   "phase": phase, "assessment": result, "sessions": sessions,
                   "criteria_changed": criteria_changed, "report_hash": digest(report)}
        body = report + "\n\n" + self.checkpoints.encode(payload)
        if len(body.encode()) > 65000:
            raise Stop("status checkpoint exceeds GitHub comment size")
        existing = current["status_comment"]
        if not existing or existing["body"] != body:
            self.fresh(snap)
            if existing:
                self.api.mutate("PATCH", f"/issues/comments/{existing['id']}", {"body": body})
            else:
                self.api.mutate("POST", f"/issues/{n}/comments", {"body": body})
        if phase == "final":
            identity = {"type": "review", "repository": self.config["repository"], "number": n,
                        "fingerprint": snap["fingerprint"], "head": sha, "report_hash": digest(report)}
            reviews = self.api.pages(f"/pulls/{n}/reviews")
            if not any(self.checkpoints.decode(r, n, "review") == identity for r in reviews):
                self.fresh(snap)
                self.api.mutate("POST", f"/pulls/{n}/reviews", {"commit_id": sha, "event": "COMMENT",
                    "body": report + "\n\n" + self.checkpoints.encode(identity)})
        wanted = {result["state"]} & LABELS
        if result["state"] == "ready":
            wanted = {"review-ready"}
        elif result["state"] == "blocked":
            wanted = {"needs-maintainer-decision" if result["malicious"] or result["security"] == "BLOCK" else "needs-information"}
        current = self.fresh(snap)
        actual = {l["name"] for l in current["item"]["labels"]}
        for label in sorted((actual & LABELS) - wanted):
            self.fresh(snap)
            self.api.mutate("DELETE", f"/issues/{n}/labels/{label}")
        if wanted - actual:
            self.fresh(snap)
            self.api.mutate("POST", f"/issues/{n}/labels", {"labels": sorted(wanted - actual)})
        try:
            self.fresh(snap)
        except Stop:
            self.invalidate(self.api.get(f"/issues/{n}"))
            raise
        return {"number": n, "state": result["state"], "head": sha, "phase": phase}
