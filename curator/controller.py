import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
import time
from .evidence import collect
from .github import GitHub
from .policy import CONTRACT_VERSION, Pause, Stop, assessment, eligible
from .publisher import Publisher
from .snapshot import snapshot, validate_scope
from .state import Checkpoints


def model(config, files, phase, logdir, luna=None):
    request = {"phase": phase, "host_time": time.time(), "files": files, "luna": luna}
    p = subprocess.run(config["transport"], input=json.dumps(request), capture_output=True, text=True)
    (logdir / (phase + "-transport.log")).write_text(p.stderr)
    try:
        response = json.loads(p.stdout)
    except ValueError:
        raise Pause("Guest transport returned no valid result") from None
    (logdir / (phase + ".json")).write_text(json.dumps(response, indent=2))
    if p.returncode or not response.get("ok"):
        raise Pause("Guest/model error: " + response.get("error", "transport failed")[:2000])
    expected = "openai/gpt-6-luna#xhigh" if phase == "completeness" else "openai/gpt-6.1-sol#xhigh"
    if response.get("model") != expected or not response.get("session", "").startswith("ses_") or response.get("verified_tools") is not True:
        raise Pause("Invalid model/session identity")
    return assessment(response["assessment"], phase), {"model": expected, "session": response["session"], "verified_tools": True}


def process(api, config, checkpoints, number, dry_run=False, gate_only=False):
    publisher = Publisher(api, config, checkpoints)
    try:
        snap = snapshot(api, config, checkpoints, number)
    except Stop:
        item = api.get(f"/issues/{number}")
        try:
            eligible(item, config)
            if not dry_run and not gate_only:
                publisher.invalidate(item)
        except Stop:
            pass
        raise
    if gate_only:
        return {"number": number, "gate": "eligible", "ci": snap["ci"], "models_started": 0}
    if snap["previous"] and snap["previous"].get("contract_version") == CONTRACT_VERSION and snap["previous"]["fingerprint"] == snap["fingerprint"]:
        previous = snap["previous"]
        if dry_run:
            return {"number": number, "state": "unchanged", "models_started": 0}
        result = publisher.publish(snap, previous["assessment"], previous["phase"], previous["sessions"])
        return {**result, "reused": True, "models_started": 0}
    if not dry_run:
        publisher.invalidate(snap["item"])
    logdir = Path(config["state_dir"]) / "runs" / (time.strftime("%Y%m%dT%H%M%SZ", time.gmtime()) + f"-{number}-" + secrets.token_hex(3))
    logdir.mkdir(parents=True, mode=0o700)
    with tempfile.TemporaryDirectory(prefix="evidence-", dir=logdir) as temp:
        files = collect(snap, config, temp, checkpoints)
        publisher.fresh(snap)
        result, luna_session = model(config, files, "completeness", logdir)
        validate_scope(result, snap, config, checkpoints)
        phase, sessions = "completeness", [luna_session]
        if result["state"] == "continue":
            if not snap["pr"]:
                raise Pause("Issue incorrectly requested PR review")
            publisher.fresh(snap)
            result, final_session = model(config, files, "final", logdir, result)
            if final_session["session"] == luna_session["session"]:
                raise Pause("Final review must use a fresh session")
            sessions.append(final_session)
            phase = "final"
        output = {"number": number, "phase": phase, "assessment": result, "sessions": sessions}
        (logdir / "result.json").write_text(json.dumps(output, indent=2))
        if dry_run:
            return {**output, "dry_run": True}
        return publisher.publish(snap, result, phase, sessions)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--item", type=int)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--gate-only", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    config = json.loads(Path(args.config).read_text())
    state = Path(config["state_dir"])
    state.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (state / "sweep.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state": "another sweep is active"}))
            return
        keyfile = state / "checkpoint.key"
        if not keyfile.exists():
            with keyfile.open("xb") as f:
                f.write(secrets.token_bytes(32))
        token_file = Path(config["token_file"])
        if token_file.stat().st_mode & 0o077:
            raise Pause("Token file must be private (0600)")
        api = GitHub(token_file.read_text().strip(), config["repository"])
        identity = api.request("GET", "/user")
        if identity.get("login", "").lower() != config["publisher_login"]:
            raise Pause("Token identity does not match configured publisher")
        checkpoints = Checkpoints(keyfile.read_bytes(), config["repository"], config["publisher_login"])
        items = ([{"number": args.item}] if args.item else api.pages("/issues?state=open&sort=created&direction=asc"))
        for item in items:
            if not args.item:
                try:
                    eligible(item, config)
                except Stop:
                    continue
            try:
                result = process(api, config, checkpoints, item["number"], args.dry_run, args.gate_only)
            except Stop as error:
                result = {"number": item["number"], "state": "stopped", "reason": str(error), "models_started": 0}
            print(json.dumps(result), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Pause as error:
        print(json.dumps({"state": "paused", "reason": str(error)}), flush=True)
        raise SystemExit(1)
