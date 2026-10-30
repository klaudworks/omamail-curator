"""Trusted VM entry point. Input contains evidence, never executable configuration."""
import base64
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.parse

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from curator.prompts import SYSTEM, GUIDE_PAGES, guide, stage_prompt
from curator.policy import assessment

MODELS = {"completeness": "openai/gpt-6-luna#xhigh", "final": "openai/gpt-6.1-sol#xhigh"}


def wait_for_evidence(workspace):
    """Allow transient local API timeouts while the location starts, before inference."""
    deadline = time.monotonic() + 120
    endpoint = "/api/mcp?location[directory]=" + urllib.parse.quote(str(workspace), safe="")
    while True:
        try:
            warm = subprocess.run([str(Path.home() / ".local/bin/opencode-vm"), "api", "get", endpoint],
                                  cwd=workspace, capture_output=True, text=True, timeout=120)
            catalog = json.loads(warm.stdout) if warm.returncode == 0 else None
        except (ValueError, subprocess.TimeoutExpired):
            catalog = None
        if isinstance(catalog, dict):
            if catalog.get("location", {}).get("directory") != str(workspace):
                raise RuntimeError("Evidence MCP location mismatch")
            servers = [s for s in catalog.get("data", []) if s.get("name") == "curator"]
            if servers and servers[0]["status"]["status"] == "connected":
                return
            if servers and servers[0]["status"]["status"] == "failed":
                raise RuntimeError("Evidence MCP connection failed")
        if time.monotonic() > deadline:
            raise RuntimeError("Evidence MCP startup timed out; no model was started")
        time.sleep(0.5)


def main():
    os.umask(0o077)
    request = json.load(sys.stdin)
    if abs(time.time() - request["host_time"]) > 120:
        raise RuntimeError("Guest clock drift exceeds 120 seconds")
    phase = request["phase"]
    model = MODELS[phase]
    parent = Path.home() / ".local/state/omamail-curator/jobs"
    parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=parent) as temp:
        workspace = Path(temp)
        evidence = workspace / "evidence"
        evidence.mkdir()
        total = 0
        for name, encoded in request["files"].items():
            target = (evidence / name).resolve()
            if not target.is_relative_to(evidence) or target == evidence:
                raise ValueError("Unsafe evidence path")
            data = base64.b64decode(encoded, validate=True)
            total += len(data)
            if total > 128 * 1024 * 1024:
                raise ValueError("Evidence limit exceeded")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        mode_manifest = evidence / "source-executables.json"
        if mode_manifest.exists():
            for name in json.loads(mode_manifest.read_text()):
                target = (evidence / name).resolve()
                if not target.is_relative_to(evidence) or not target.is_file():
                    raise ValueError("Unsafe executable manifest")
                target.chmod(0o755)
        rules = [{"action": "*", "resource": "*", "effect": "deny"},
                 {"action": "curator_*", "resource": "*", "effect": "allow"}]
        cfg = {"$schema": "https://opencode.ai/config.json", "model": "openai/gpt-6-luna",
               "default_agent": "curator", "snapshots": False,
               "policies": [{"action": "provider.use", "resource": "*", "effect": "deny"},
                            {"action": "provider.use", "resource": "openai", "effect": "allow"}],
                "agents": {"curator": {"mode": "primary", "system": SYSTEM, "permissions": rules}},
               "mcp": {"servers": {"curator": {"type": "local", "command": ["/usr/bin/python3", str(ROOT / "curator/evidence_tools.py")],
                    "environment": {"CURATOR_EVIDENCE": str(evidence)}, "codemode": False}}}}
        (workspace / "opencode.json").write_text(json.dumps(cfg))
        for page in GUIDE_PAGES:
            guide(page)  # Fail before inference if deployment omitted a linked guide.
        # V2 location activation is asynchronous; wait for its MCP catalog before
        # starting inference instead of allowing a tool-less model turn.
        wait_for_evidence(workspace)
        prompt = stage_prompt(phase)
        if request.get("luna"):
            (evidence / "luna.json").write_text(json.dumps(request["luna"], indent=2))
            prompt += "\nLuna's non-authoritative assessment is available as luna.json.\n"
        p = subprocess.run([str(Path.home() / ".local/bin/opencode-vm"), "run", "--agent", "curator",
                            "--model", model, "--format", "json", "--title", "Omamail curator " + phase, prompt],
                            cwd=workspace, capture_output=True, text=True)
        events = []
        for line in p.stdout.splitlines():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if isinstance(event, dict):
                events.append(event)
        sessions = sorted({e["sessionID"] for e in events if e.get("sessionID")})
        errors = [e for e in events if e.get("type") == "error"]
        if p.returncode or errors or len(sessions) != 1:
            # Error content may contain contributor data: private controller log only.
            raise RuntimeError("Model turn failed: " + json.dumps(errors)[:2000] + p.stderr[:1000])
        texts = [e["part"]["text"] for e in events if e.get("type") == "text" and e.get("part", {}).get("text")]
        if not texts:
            raise RuntimeError("Model returned no text")
        result = assessment(json.loads(texts[-1]), phase)
        tools = [e for e in events if e.get("type") == "tool_use"]
        inspected = {e.get("part", {}).get("state", {}).get("input", {}).get("path") for e in tools
                     if e.get("part", {}).get("tool") == "curator_inspect"
                     and e.get("part", {}).get("state", {}).get("status") == "completed"}
        item_input = json.loads((evidence / "input.json").read_text())
        criteria = ["base/AGENTS.md"] + (["base/CONTRIBUTING.md"] if item_input["pr"] else [])
        required = {"input.json"} | {name for name in criteria if name in request["files"]}
        if not required <= inspected:
            raise RuntimeError("Required evidence was not inspected through working tools")
        guides = {e.get("part", {}).get("state", {}).get("input", {}).get("page") for e in tools
                  if e.get("part", {}).get("tool") == "curator_guide"
                  and e.get("part", {}).get("state", {}).get("status") == "completed"}
        required_guides = {"REVIEW.md", "REPORT.md", "PRS.md" if item_input["pr"] else "ISSUES.md"}
        if item_input["pr"]:
            required_guides.add("EVIDENCE.md")
        if not required_guides <= guides:
            raise RuntimeError("Required runtime guides were not read")
        if any(e.get("part", {}).get("state", {}).get("status") == "error" for e in tools):
            if result["state"] in {"continue", "ready"}:
                raise RuntimeError("Tool failure cannot yield a passing gate")
        print(json.dumps({"ok": True, "model": model, "session": sessions[0], "assessment": result,
                          "tool_count": len(tools), "verified_tools": True, "events": events}), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"ok": False, "error": type(error).__name__ + ": " + str(error)}), flush=True)
        sys.exit(1)
