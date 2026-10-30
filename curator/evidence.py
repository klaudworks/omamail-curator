"""Collect public immutable source and bounded GitHub attachments, without execution."""
import base64
import io
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import urllib.parse
import urllib.request
from .policy import Pause


def command(args, cwd=None):
    env = {"PATH": os.environ["PATH"], "HOME": "/nonexistent", "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_CONFIG_GLOBAL": "/dev/null", "GIT_TERMINAL_PROMPT": "0", "LANG": "C.UTF-8"}
    p = subprocess.run(args, cwd=cwd, env=env, capture_output=True, timeout=180)
    if p.returncode:
        raise Pause("Source collection failed: " + p.stderr.decode(errors="replace")[:500])
    return p.stdout


class AttachmentRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlparse(newurl)
        if parsed.scheme != "https" or parsed.hostname not in {"github.com", "user-attachments.githubusercontent.com", "github-production-user-asset-6210df.s3.amazonaws.com"} or parsed.username:
            raise ValueError("Attachment redirect origin rejected")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def collect(snap, config, directory, checkpoints):
    directory = Path(directory)
    repo = directory / "source.git"
    command(["git", "-c", "core.hooksPath=/dev/null", "init", "--bare", str(repo)])
    pr = snap["pr"]
    revisions = {"head": pr["head"]["sha"], "base": pr["base"]["sha"]} if pr else {"head": "HEAD", "base": "HEAD"}
    for sha in set(revisions.values()):
        if sha != "HEAD" and not re.fullmatch(r"[0-9a-f]{40}", sha):
            raise Pause("Invalid source revision")
        command(["git", "-c", "core.hooksPath=/dev/null", "--git-dir", str(repo), "fetch", "--depth=1", "https://github.com/" + config["repository"] + ".git", sha])
    if not pr:
        revisions = dict.fromkeys(revisions, command(["git", "--git-dir", str(repo), "rev-parse", "FETCH_HEAD"]).decode().strip())
    files, omitted, executables = {}, [], []
    for name, sha in revisions.items():
        archive = command(["git", "--git-dir", str(repo), "archive", sha])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar:
                if member.isfile():
                    if member.size > 4 * 1024 * 1024:
                        omitted.append(name + "/" + member.name)
                        continue
                    files[name + "/" + member.name] = base64.b64encode(tar.extractfile(member).read()).decode()
                    if member.mode & 0o111:
                        executables.append(name + "/" + member.name)
                elif not member.isdir():
                    omitted.append(name + "/" + member.name + " (link/special file)")
    diff = command(["git", "--git-dir", str(repo), "diff", "--no-ext-diff", "--no-textconv", revisions["base"], revisions["head"]])
    if len(diff) > 4 * 1024 * 1024:
        raise Pause("Diff exceeds bounded evidence ingestion")
    files["diff.patch"] = base64.b64encode(diff).decode()
    paths = command(["git", "--git-dir", str(repo), "diff", "--name-only", revisions["base"], revisions["head"]]).decode().splitlines()
    snap["criteria_changed"] = any(p.endswith(("AGENTS.md", "CONTRIBUTING.md")) or p.startswith(".opencode/") for p in paths)
    events = [e for e in snap["events"] if not checkpoints.decode(e, snap["item"]["number"])]
    context = {"item": {k: snap["item"].get(k) for k in ("number", "title", "body", "html_url", "user")},
               "eligibility": {"repository": config["repository"], "opener_verified": True, "state": "open", "draft": False if pr else None,
                               "ci_gate": "passed" if pr else "not applicable to issues"},
               "revisions": revisions, "pr": bool(pr), "ci": snap["ci"], "discussion": events,
               "previous": snap["previous"], "changed_files": paths, "criteria_changed": snap["criteria_changed"],
               "omitted_source": omitted, "assets": [], "maintainers": config["maintainers"]}
    urls = sorted(set(re.findall(r"https://github\.com/user-attachments/assets/[0-9a-f-]{36}", json.dumps(context))))
    opener = urllib.request.build_opener(AttachmentRedirect)
    for index, url in enumerate(urls):
        asset = {"url": url}
        try:
            with opener.open(url, timeout=60) as response:
                data = response.read(32 * 1024 * 1024 + 1)
            if len(data) > 32 * 1024 * 1024:
                raise ValueError("attachment exceeds 32 MiB")
            if data.startswith(b"\x89PNG\r\n\x1a\n"):
                ext = ".png"
            elif data.startswith(b"\xff\xd8\xff"):
                ext = ".jpg"
            elif b"ftyp" == data[4:8]:
                ext = ".mp4"
            else:
                raise ValueError("unsupported attachment type")
            name = f"assets/{index}{ext}"
            if ext != ".mp4":
                files[name] = base64.b64encode(data).decode()
                asset["path"] = name
            else:
                video = directory / f"video-{index}.mp4"
                video.write_bytes(data)
                frame_dir = directory / f"frames-{index}"
                frame_dir.mkdir()
                # No network protocols. Decode video in a separate process with a tool deadline.
                result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe", "-i", str(video),
                    "-vf", "fps=1/4,scale=1280:-2", "-frames:v", "8", str(frame_dir / "%02d.png")],
                    env={"PATH": os.environ["PATH"]}, capture_output=True, timeout=60)
                if result.returncode:
                    raise ValueError("video decoding failed")
                asset["sampled_frames"] = []
                for frame in sorted(frame_dir.glob("*.png")):
                    name = f"assets/{index}-frame-{frame.name}"
                    files[name] = base64.b64encode(frame.read_bytes()).decode()
                    asset["sampled_frames"].append(name)
                asset["limitations"] = "Sampled frames every four seconds, at most eight; not full playback or verification of motion/audio."
        except Exception as error:
            asset["unavailable"] = type(error).__name__ + ": " + str(error)[:200]
        context["assets"].append(asset)
    files["input.json"] = base64.b64encode(json.dumps(context, indent=2).encode()).decode()
    files["source-executables.json"] = base64.b64encode(json.dumps(executables).encode()).decode()
    if sum(len(v) for v in files.values()) > 128 * 1024 * 1024:
        raise Pause("Evidence package exceeds bounded ingestion limit")
    return files
