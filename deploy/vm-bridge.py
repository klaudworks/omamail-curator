#!/usr/bin/env python3
"""Run beside the existing QEMU runner. Preserve the authenticated overlay.

Accept one JSON guest request on stdin; stdout is only the guest response.
No publication credential crosses this bridge.
"""
import contextlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import sys
import time

root = Path(os.environ.get("OMARCHY_VM_HOME", Path.home() / "omamail-vm"))


def main():
    os.umask(0o077)
    request = json.load(sys.stdin)
    with (root / "curator-bridge.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        spec = importlib.util.spec_from_file_location("runner", root / "runner.py")
        runner = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(runner)
        runner_ssh_args = runner.ssh_args
        def isolated_ssh_args(data, run):
            # Everything needed is explicit in the runner. Ignore host/user SSH
            # configuration, including OrbStack's config ownership across a
            # systemd user namespace (PrivateTmp).
            args = runner_ssh_args(data, run)
            return args[:1] + ["-F", "/dev/null"] + args[1:]
        runner.ssh_args = isolated_ssh_args
        data, run = runner.state()
        if not runner.running(run):
            launch = json.loads((run / "launch.json").read_text())
            subprocess.run(launch["argv"], check=True, stdout=sys.stderr)
        with contextlib.redirect_stdout(sys.stderr):
            runner.wait_ready(180)
        ssh = runner.ssh_args(data, run)

        def guest(parts, **kwargs):
            return subprocess.run(ssh + [shlex.join(parts)], **kwargs)

        now = guest(["date", "+%s"], capture_output=True, text=True, timeout=15, check=True)
        if abs(time.time() - int(now.stdout.strip())) > 90:
            guest(["systemctl", "--user", "stop", "opencode-curator.service"], capture_output=True, timeout=60, check=True)
            guest(["sync"], capture_output=True, timeout=30, check=True)
            runner.qmp(run, "system_reset")
            time.sleep(5)
            with contextlib.redirect_stdout(sys.stderr):
                runner.wait_ready(180)
        work = run / "auth-network"
        try:
            with socket.create_connection(("127.0.0.1", 18931), timeout=3):
                pass
        except OSError:
            with (work / "proxy.log").open("ab") as log:
                subprocess.Popen(["tinyproxy", "-d", "-c", str(work / "tinyproxy.conf")],
                                 stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            deadline = time.monotonic() + 15
            while True:
                try:
                    with socket.create_connection(("127.0.0.1", 18931), timeout=1):
                        break
                except OSError:
                    if time.monotonic() > deadline:
                        raise RuntimeError("Model proxy unavailable")
                    time.sleep(0.2)
        control = str(work / "ssh.sock")
        subprocess.run(ssh[:-1] + ["-O", "exit", "-S", control, ssh[-1]], capture_output=True)
        subprocess.run(ssh[:-1] + ["-f", "-N", "-M", "-S", control, "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3", "-R", "127.0.0.1:18931:127.0.0.1:18931", ssh[-1]], check=True, stdout=sys.stderr)
        guest(["systemctl", "--user", "start", "opencode-curator.service"], check=True, stdout=sys.stderr, timeout=60)
        deadline = time.monotonic() + 120
        while True:
            health = guest(["opencode-vm", "api", "get", "/api/info"], capture_output=True, text=True, timeout=90)
            try:
                info = json.loads(health.stdout)
                if info["version"] == "2.2.1":
                    break
                raise RuntimeError("Unexpected OpenCode version")
            except (ValueError, KeyError):
                if time.monotonic() > deadline:
                    raise RuntimeError("OpenCode server unavailable")
                time.sleep(1)
        request["host_time"] = time.time()
        result = guest(["python3", "/home/omarchy/.local/share/omamail-curator/curator/guest.py"],
                       input=json.dumps(request), text=True)
        return result.returncode


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(json.dumps({"ok": False, "error": "VM bridge: " + type(error).__name__ + ": " + str(error)}))
        sys.exit(1)
