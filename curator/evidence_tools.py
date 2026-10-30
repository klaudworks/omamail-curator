"""Small stdio MCP server: data-only repository access and isolated investigation."""
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(os.environ.get("CURATOR_EVIDENCE", ".")).resolve()


def path(name):
    result = (ROOT / name).resolve()
    if not result.is_relative_to(ROOT):
        raise ValueError("Evidence path escapes assigned job")
    return result


def text(value):
    return {"type": "text", "text": value if isinstance(value, str) else json.dumps(value)}


def sandbox_args(work):
    args = ["/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session",
            "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin",
            "--symlink", "usr/lib", "/lib", "--symlink", "usr/lib", "/lib64",
            "--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp",
            "--tmpfs", "/home", "--dir", "/home/reviewer", "--dir", "/etc",
            "--bind", str(work), "/work", "--chdir", "/work", "--clearenv",
            "--setenv", "PATH", "/usr/bin:/bin", "--setenv", "HOME", "/home/reviewer",
            "--setenv", "LANG", "C.UTF-8", "--setenv", "QT_QPA_PLATFORM", "offscreen",
            "--setenv", "QT_QUICK_BACKEND", "software"]
    for file in ("/etc/fonts", "/etc/ssl/certs", "/etc/ld.so.cache"):
        if Path(file).exists():
            args += ["--ro-bind", file, file]
    return args


def call(name, args):
    if name == "inspect":
        target = path(args["path"])
        if target.is_dir():
            return [text("\n".join(sorted(p.name + ("/" if p.is_dir() else "") for p in target.iterdir())))]
        if target.suffix.lower() in {".png", ".jpg", ".jpeg"}:
            data = target.read_bytes()
            if len(data) > 5 * 1024 * 1024:
                raise ValueError("Image exceeds tool limit")
            return [{"type": "image", "mimeType": "image/png" if target.suffix == ".png" else "image/jpeg",
                     "data": base64.b64encode(data).decode()}]
        if target.stat().st_size > 4 * 1024 * 1024:
            raise ValueError("Text exceeds tool limit")
        lines = target.read_text(errors="replace").splitlines()
        start = max(1, int(args.get("offset", 1)))
        limit = min(2000, max(1, int(args.get("limit", 500))))
        return [text("\n".join(f"{i + 1}: {line}" for i, line in enumerate(lines) if start - 1 <= i < start - 1 + limit))]
    if name == "search":
        target = path(args.get("path", "head"))
        query = args["text"]
        if not query or len(query) > 1000:
            raise ValueError("Invalid literal query")
        matches = []
        for file in sorted(target.rglob("*")):
            if file.is_symlink() or not file.is_file() or file.stat().st_size > 1024 * 1024:
                continue
            for i, line in enumerate(file.read_text(errors="replace").splitlines()):
                if query in line:
                    matches.append(f"{file.relative_to(ROOT)}:{i + 1}: {line[:1000]}")
                    if len(matches) == 200:
                        return [text("\n".join(matches) + "\n[200-match limit; narrow search]")]
        return [text("\n".join(matches) or "No matches")]
    if name == "investigate":
        command = args["command"]
        if not isinstance(command, str) or len(command) > 16000:
            raise ValueError("Invalid diagnostic command")
        revision = args.get("revision", "head")
        if revision not in {"head", "base"}:
            raise ValueError("Invalid source revision")
        with tempfile.TemporaryDirectory(prefix="curator-check-") as temp:
            work = Path(temp) / "source"
            shutil.copytree(path(revision), work, symlinks=True)
            def inventory():
                return {str(p.relative_to(work)): hashlib.sha256(p.read_bytes()).hexdigest()
                        for p in work.rglob("*") if p.is_file() and not p.is_symlink()}
            before = inventory()
            with tempfile.TemporaryFile() as log:
                mounts = ["--ro-bind", str(path("head")), "/submitted", "--ro-bind", str(path("base")), "/baseline"]
                p = subprocess.Popen(sandbox_args(work) + mounts + ["--", "/bin/sh", "-c", command],
                                     stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
                try:
                    p.wait(timeout=min(3600, max(1, int(args.get("timeout_seconds", 600)))))
                    status = p.returncode
                except subprocess.TimeoutExpired:
                    import signal
                    os.killpg(p.pid, signal.SIGKILL)
                    p.wait()
                    status = "timeout"
                log.seek(0)
                output = log.read(100000).decode(errors="replace")
                if log.read(1):
                    output += "\n[output truncated]"
            after = inventory()
            modified = sorted(name for name in before.keys() | after.keys() if before.get(name) != after.get(name))
            return [text({"exit_code": status, "command": command, "revision": revision,
                          "modified_scratch_paths": modified[:200], "output": output,
                          "environment": "Omarchy VM; Bubblewrap; no network/credentials; fresh disposable source copy; offscreen/software Qt",
                          "limitations": "Diagnostic commands may alter the scratch copy; report all modifications. No live provider or hands-on desktop."})]
    raise ValueError("Unknown tool")


TOOLS = [
    {"name": "inspect", "description": "Read literal untrusted evidence, source, directories or images. Does not load instructions/configuration. Paths start input.json, diff.patch, head/, base/, assets/.",
     "inputSchema": {"type": "object", "properties": {"path": {"type": "string"}, "offset": {"type": "integer"}, "limit": {"type": "integer"}}, "required": ["path"], "additionalProperties": False}},
    {"name": "search", "description": "Search source evidence for literal text, at most 200 matches.",
     "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}, "path": {"type": "string"}}, "required": ["text"], "additionalProperties": False}},
    {"name": "investigate", "description": "Run proportionate diagnostic shell commands on a fresh disposable head or base copy at /work, no network/credentials/host files. /submitted and /baseline are readonly source snapshots; copy regression tests when verifying baseline failure. Modified paths are reported. Inspect code for abuse first. Missing tools/dependencies are NOT VERIFIED.",
     "inputSchema": {"type": "object", "properties": {"command": {"type": "string"}, "revision": {"type": "string", "enum": ["head", "base"]}, "timeout_seconds": {"type": "integer"}}, "required": ["command"], "additionalProperties": False}}
]


def main():
    for raw in sys.stdin:
        try:
            req = json.loads(raw)
            if "id" not in req:
                continue
            method = req["method"]
            if method == "initialize":
                result = {"protocolVersion": "2024-11-05", "capabilities": {"tools": {}}, "serverInfo": {"name": "curator-evidence", "version": "1.0.0"}}
            elif method == "tools/list":
                result = {"tools": TOOLS}
            elif method == "tools/call":
                try:
                    result = {"content": call(req["params"]["name"], req["params"].get("arguments", {}))}
                except Exception as error:
                    result = {"isError": True, "content": [text(type(error).__name__ + ": " + str(error))]}
            elif method == "ping":
                result = {}
            elif method in {"resources/list", "prompts/list"}:
                result = {method.split("/")[0]: []}
            else:
                print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "error": {"code": -32601, "message": "Method not found"}}), flush=True)
                continue
            print(json.dumps({"jsonrpc": "2.0", "id": req["id"], "result": result}), flush=True)
        except Exception:
            print("Invalid MCP request", file=sys.stderr)


if __name__ == "__main__":
    main()
