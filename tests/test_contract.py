import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from curator.policy import Pause, Stop, assessment, eligible, successful_runs
from curator.publisher import Publisher
from curator.snapshot import snapshot, validate_scope
from curator.state import Checkpoints
from curator.controller import process


CONFIG = {"repository": "test/repo", "authors": ["klaudworks"], "maintainers": ["klaudworks", "huacnlee"],
          "publisher_login": "klaudworks", "pipelines": [{"path": ".github/workflows/ci.yml", "jobs": ["Linux", "Mac"]}]}
SHA = "a" * 40
PR = {"number": 7, "draft": False, "state": "open", "user": {"login": "klaudworks"},
      "head": {"sha": SHA, "repo": {"id": 42}, "ref": "fix"}, "base": {"sha": "b" * 40, "ref": "main"}}
ITEM = {"number": 7, "node_id": "PR_test", "title": "Fix behavior", "body": "Reproduction and proof", "labels": [],
        "user": {"login": "klaudworks", "type": "User"}, "repository_url": "https://api.github.com/repos/test/repo",
        "state": "open", "locked": False, "pull_request": {}}
RUN = {"id": 101, "workflow_id": 11, "event": "pull_request", "head_sha": SHA, "run_number": 1, "run_attempt": 1,
       "status": "completed", "conclusion": "success", "head_repository": {"id": 42}, "head_branch": "fix",
       "pull_requests": [{"number": 7}], "html_url": "https://github.com/test/repo/actions/runs/101"}
JOBS = [{"id": 201, "name": "Linux", "status": "completed", "conclusion": "success"},
        {"id": 202, "name": "Mac", "status": "completed", "conclusion": "success"}]
RESULT = {"kind": "bug", "state": "needs-information", "body": "This fixes selection for calendar users. Please supply the missing hands-on check.",
          "security": "NOT VERIFIED", "blockers": ["hands-on check"], "scope_decisions": [], "malicious": False}


class API:
    def __init__(self):
        self.item, self.pr, self.run, self.jobs = map(copy.deepcopy, (ITEM, PR, RUN, JOBS))
        self.comments, self.reviews, self.effects = [], [], []
        self.fail_after_comment = False

    def get(self, path):
        values = {"/issues/7": self.item, "/pulls/7": self.pr,
                  "/actions/workflows/ci.yml": {"id": 11, "path": ".github/workflows/ci.yml", "state": "active"},
                  "/rules/branches/main": []}
        return copy.deepcopy(values[path])

    def pages(self, path, key=None):
        if path.startswith("/actions/workflows/"):
            return [copy.deepcopy(self.run)]
        if path.startswith("/actions/runs/"):
            return copy.deepcopy(self.jobs)
        if path == "/issues/7/comments":
            return copy.deepcopy(self.comments)
        if path == "/pulls/7/reviews":
            return copy.deepcopy(self.reviews)
        return []

    def mutate(self, method, path, payload=None):
        allowed = ((method == "POST" and path in {"/issues/7/comments", "/pulls/7/reviews", "/issues/7/labels"})
                   or (method == "PATCH" and path.startswith("/issues/comments/"))
                   or (method == "DELETE" and path.startswith("/issues/7/labels/")))
        assert allowed, (method, path)
        self.effects.append((method, path, payload))
        if path == "/issues/7/comments":
            self.comments.append({"id": len(self.comments) + 1000, "body": payload["body"], "user": ITEM["user"]})
            if self.fail_after_comment:
                self.fail_after_comment = False
                raise Pause("Response lost after server accepted comment")
        elif path.startswith("/issues/comments/"):
            self.comments[0]["body"] = payload["body"]
        elif path == "/pulls/7/reviews":
            assert payload["event"] == "COMMENT" and payload["commit_id"] == self.pr["head"]["sha"]
            self.reviews.append({"id": 2000, "user": ITEM["user"], **payload})
        elif method == "DELETE":
            self.item["labels"] = [l for l in self.item["labels"] if l["name"] != path.rsplit("/", 1)[-1]]
        elif path.endswith("/labels"):
            self.item["labels"] += [{"name": n} for n in payload["labels"]]


class Contract(unittest.TestCase):
    def setUp(self):
        self.api = API()
        self.cp = Checkpoints(b"test-key", "test/repo", "klaudworks")
        self.publisher = Publisher(self.api, CONFIG, self.cp)

    def snap(self):
        return snapshot(self.api, CONFIG, self.cp, 7)

    def test_author_opener_not_actor(self):
        self.api.item["user"]["login"] = "someone-else"
        self.api.item["actor"] = {"login": "klaudworks"}
        with self.assertRaises(Stop):
            self.snap()
        self.assertFalse(self.api.effects)

    def test_gate_all_nonsuccess_states(self):
        for outcome in [None, "failure", "cancelled", "timed_out", "neutral", "skipped", "action_required"]:
            with self.subTest(outcome=outcome):
                self.api.run["conclusion"] = outcome
                with self.assertRaises(Stop):
                    self.snap()
                self.assertFalse(self.api.effects)

    def test_green_run_cannot_hide_missing_or_red_job(self):
        for jobs in [[], JOBS[:1], [JOBS[0], {**JOBS[1], "conclusion": "cancelled"}]]:
            self.api.jobs = jobs
            with self.assertRaises(Stop):
                self.snap()

    def test_newer_pending_run_dominates_old_success(self):
        source = {"id": 11, "runs": [RUN, {**RUN, "id": 102, "run_number": 2, "status": "in_progress", "conclusion": None}], "jobs": {"101": JOBS}}
        with self.assertRaises(Stop):
            successful_runs(PR, {".github/workflows/ci.yml": source}, CONFIG)

    def test_latest_partial_rerun_reuses_same_run_success(self):
        source = {"id": 11, "runs": [{**RUN, "run_attempt": 2}], "jobs": {"101": [JOBS[0], {**JOBS[1], "conclusion": "failure"}, {**JOBS[1], "id": 203}]}}
        self.assertEqual(successful_runs(PR, {".github/workflows/ci.yml": source}, CONFIG)[0]["attempt"], 2)

    def test_fork_association_requires_repository_and_branch(self):
        self.api.run.update(pull_requests=[], head_repository={"id": 999})
        with self.assertRaises(Stop):
            self.snap()
        self.api.run["head_repository"] = {"id": 42}
        self.assertEqual(self.snap()["ci"][0]["sha"], SHA)

    def test_old_head_cannot_satisfy_gate(self):
        self.api.pr["head"]["sha"] = "c" * 40
        with self.assertRaises(Stop):
            self.snap()

    def test_drafts_and_closed_stop(self):
        self.api.pr["draft"] = True
        with self.assertRaises(Stop):
            self.snap()
        self.api.item["state"] = "closed"
        with self.assertRaises(Stop):
            self.snap()

    def test_issues_have_no_pipeline_gate(self):
        del self.api.item["pull_request"]
        self.assertIsNone(self.snap()["pr"])

    def test_stale_publication_has_no_effect(self):
        snap = self.snap()
        self.api.pr["head"]["sha"] = "d" * 40
        with self.assertRaises(Stop):
            self.publisher.publish(snap, RESULT, "completeness", [])
        self.assertFalse(self.api.effects)

    def test_author_rechecked_before_publish(self):
        snap = self.snap()
        self.api.item["user"]["login"] = "other"
        with self.assertRaises(Stop):
            self.publisher.publish(snap, RESULT, "completeness", [])
        self.assertFalse(self.api.effects)

    def test_lost_comment_response_recovers_without_duplicate(self):
        snap = self.snap()
        self.api.fail_after_comment = True
        with self.assertRaises(Pause):
            self.publisher.publish(snap, RESULT, "completeness", [])
        self.publisher.publish(self.snap(), RESULT, "completeness", [])
        self.assertEqual(len(self.api.comments), 1)
        self.assertEqual([l["name"] for l in self.api.item["labels"]], ["needs-information"])

    def test_ready_is_comment_only_and_idempotent(self):
        result = {**RESULT, "state": "ready", "security": "PASS", "blockers": []}
        self.publisher.publish(self.snap(), result, "final", [])
        self.publisher.publish(self.snap(), result, "final", [])
        self.assertEqual(len(self.api.comments), 1)
        self.assertEqual(len(self.api.reviews), 1)
        self.assertEqual(self.api.reviews[0]["event"], "COMMENT")
        self.assertEqual(self.api.item["labels"], [{"name": "review-ready"}])

    def test_signed_automation_not_human_input(self):
        before = self.snap()["fingerprint"]
        self.publisher.publish(self.snap(), RESULT, "completeness", [])
        self.assertEqual(self.snap()["fingerprint"], before)
        self.api.comments.append({"id": 9999, "body": "I tested this by hand", "user": ITEM["user"]})
        self.assertNotEqual(self.snap()["fingerprint"], before)

    def test_forged_checkpoint_not_accepted(self):
        self.publisher.publish(self.snap(), RESULT, "completeness", [])
        self.api.comments[0]["body"] = self.api.comments[0]["body"].replace("v1:", "v1:x", 1)
        self.assertIsNone(self.snap()["previous"])

    def test_final_schema_cannot_authorize_missing_security(self):
        for phase, security in [("completeness", "PASS"), ("final", "NOT VERIFIED"), ("final", "BLOCK")]:
            with self.assertRaises(Pause):
                assessment({**RESULT, "state": "ready", "security": security, "blockers": []}, phase)
        with self.assertRaises(Pause):
            assessment({**RESULT, "target": "another/repo"}, "completeness")

    def test_feature_scope_and_conflicting_decisions(self):
        result = {**RESULT, "kind": "feature", "state": "continue", "blockers": [], "scope_decisions": [99]}
        snap = self.snap()
        validate_scope(result, snap, CONFIG, self.cp)
        self.assertEqual(result["state"], "needs-maintainer-decision")
        snap["events"].append({"id": 99, "body": "/curator scope accept " + SHA, "user": ITEM["user"]})
        result["state"] = "continue"
        validate_scope(result, snap, CONFIG, self.cp)
        self.assertEqual(result["state"], "continue")
        snap["events"].append({"id": 100, "body": "/curator scope reject " + SHA, "user": {"login": "huacnlee"}})
        validate_scope(result, snap, CONFIG, self.cp)
        self.assertEqual(result["state"], "needs-maintainer-decision")

    def test_red_ci_stops_before_model_and_removes_readiness_only(self):
        self.api.run["conclusion"] = "failure"
        self.api.item["labels"] = [{"name": "review-ready"}]
        with patch("curator.controller.model") as model:
            with self.assertRaises(Stop):
                process(self.api, CONFIG, self.cp, 7)
            model.assert_not_called()
        self.assertEqual(self.api.effects, [("DELETE", "/issues/7/labels/review-ready", None)])

    def test_incomplete_pr_never_starts_final_review(self):
        with tempfile.TemporaryDirectory() as temp, patch("curator.controller.collect", return_value={}), patch("curator.controller.model", return_value=(RESULT, {"session": "ses_luna"})) as model:
            result = process(self.api, {**CONFIG, "state_dir": temp}, self.cp, 7)
            self.assertEqual(result["state"], "needs-information")
            self.assertEqual(model.call_count, 1)

    def test_model_failure_does_not_publish(self):
        with tempfile.TemporaryDirectory() as temp, patch("curator.controller.collect", return_value={}), patch("curator.controller.model", side_effect=Pause("subscription exhausted")):
            with self.assertRaises(Pause):
                process(self.api, {**CONFIG, "state_dir": temp}, self.cp, 7)
        self.assertFalse(self.api.effects)

    def test_unchanged_input_reuses_checkpoint(self):
        self.publisher.publish(self.snap(), RESULT, "completeness", [])
        with patch("curator.controller.model") as model:
            result = process(self.api, CONFIG, self.cp, 7)
            model.assert_not_called()
        self.assertTrue(result["reused"])


if __name__ == "__main__":
    unittest.main()
