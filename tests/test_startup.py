import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from curator.guest import wait_for_evidence


class Startup(unittest.TestCase):
    workspace = Path("/assigned-job")

    def response(self, directory="/assigned-job", status="connected"):
        return subprocess.CompletedProcess([], 0, json.dumps({
            "location": {"directory": directory}, "data": [{"name": "curator", "status": {"status": status}}]}), "")

    def test_local_api_timeout_and_empty_response_recover_before_inference(self):
        responses = [subprocess.CompletedProcess([], 1, "", "local API timeout"),
                     subprocess.CompletedProcess([], 0, "", ""), self.response()]
        with patch("curator.guest.subprocess.run", side_effect=responses) as run, patch("curator.guest.time.sleep"):
            wait_for_evidence(self.workspace)
        self.assertEqual(run.call_count, 3)
        self.assertTrue(all(call.args[0][1:3] == ["api", "get"] for call in run.call_args_list))

    def test_unavailable_catalog_stops_without_inference(self):
        with patch("curator.guest.subprocess.run", return_value=subprocess.CompletedProcess([], 1, "", "timeout")) as run, patch("curator.guest.time.monotonic", side_effect=[0, 121]):
            with self.assertRaisesRegex(RuntimeError, "no model was started"):
                wait_for_evidence(self.workspace)
        self.assertEqual(run.call_args.args[0][1:3], ["api", "get"])

    def test_wrong_location_or_failed_connection_never_passes(self):
        for response in [self.response(directory="/another-job"), self.response(status="failed")]:
            with patch("curator.guest.subprocess.run", return_value=response), self.assertRaises(RuntimeError):
                wait_for_evidence(self.workspace)
