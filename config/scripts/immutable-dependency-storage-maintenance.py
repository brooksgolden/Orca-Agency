"""Consolidate immutable Linux release dependencies without removing any path."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time


RELEASE_NAME = re.compile(r"repair-[a-f0-9]{12}-[0-9]+")
SKIPPED_DIRECTORIES = (".cache", "cache", "tmp", "temp", "logs")


def remaining(deadline):
    seconds = deadline - time.monotonic()
    if seconds <= 0:
        raise TimeoutError("maintenance deadline reached")
    return seconds


def candidate_roots(root, current_link, protected, keep, age_seconds, now=None):
    now = time.time() if now is None else now
    if root.is_symlink() or root.resolve() != root or not root.is_dir():
        raise ValueError("release root must be an existing canonical directory")
    current = current_link.resolve(strict=True)
    if current.parent != root:
        raise ValueError("current release must belong to the release root")
    releases = [p for p in root.iterdir() if p.is_dir() and not p.is_symlink()]
    excluded = {p for p in sorted(releases, key=lambda p: p.stat().st_mtime, reverse=True)[:keep]}
    excluded.update(protected)
    excluded.add(current)
    result = []
    for release in releases:
        if release in excluded or not RELEASE_NAME.fullmatch(release.name):
            continue
        if now - release.stat().st_mtime < age_seconds:
            continue
        dependencies = release / "node_modules"
        if dependencies.is_symlink() or not dependencies.is_dir():
            continue
        if dependencies.resolve() != dependencies:
            raise ValueError("dependency root has a symlink ancestor")
        result.append(dependencies)
    return sorted(result)


def find_large_files(roots, minimum_size, deadline, maximum_files):
    if not roots:
        return []
    args = ["find", *(str(p) for p in roots), "-xdev", "-type", "d", "("]
    for index, name in enumerate(SKIPPED_DIRECTORIES):
        if index:
            args.append("-o")
        args.extend(["-name", name])
    args.extend([")", "-prune", "-o", "-type", "f", "-size", f"+{minimum_size - 1}c", "-print0"])
    result = subprocess.run(args, capture_output=True, check=True, timeout=min(45, remaining(deadline)))
    paths = sorted(Path(os.fsdecode(raw)) for raw in result.stdout.split(b"\0") if raw)
    if len(paths) > maximum_files:
        raise ValueError("file budget exceeded; no changes applied")
    return paths


def file_identity(path):
    info = path.lstat()
    if path.resolve() != path or not stat.S_ISREG(info.st_mode):
        raise ValueError("dependency path must be a canonical regular file")
    if info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError("dependency is writable by runtime users; no changes applied")
    return info, (info.st_size, info.st_mtime_ns, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid)


def fingerprints(paths, deadline):
    result = {}
    hashes = {}
    for path in paths:
        remaining(deadline)
        info, identity = file_identity(path)
        key = (info.st_dev, info.st_ino)
        if key not in hashes:
            digest = hashlib.sha256()
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    remaining(deadline)
                    digest.update(chunk)
            hashes[key] = digest.hexdigest()
        result[path] = (identity, hashes[key])
    return result, len(hashes)


def maintain(args):
    started = time.monotonic()
    deadline = started + args.deadline_seconds
    root = args.release_root
    protected = set(args.protected_release)
    if any(p.parent != root or p.resolve() != p or not p.is_dir() for p in protected):
        raise ValueError("protected releases must be existing canonical children of the root")
    current_before = args.current_link.resolve(strict=True)
    roots = candidate_roots(root, args.current_link, protected, args.keep, args.minimum_age_hours * 3600)
    paths = find_large_files(roots, args.minimum_file_bytes, deadline, args.maximum_files)
    before, before_inodes = fingerprints(paths, deadline)
    if len(paths) < 2:
        return {"status": "completed", "roots": len(roots), "files": len(paths), "changed": False}
    # Reserve time to verify the result, even if the native tool reaches its own bound.
    tool_timeout = min(75, remaining(deadline) - 45)
    if tool_timeout <= 0:
        raise TimeoutError("insufficient verification time; no changes applied")
    roots_now = candidate_roots(root, args.current_link, protected, args.keep, args.minimum_age_hours * 3600)
    if roots_now != roots or args.current_link.resolve(strict=True) != current_before:
        raise ValueError("release membership changed; no changes applied")
    if any(file_identity(p)[1] != fingerprint[0] for p, fingerprint in before.items()):
        raise ValueError("dependency metadata changed; no changes applied")
    command = [
        "hardlink", "--method=memcmp", "--respect-name", "--respect-xattrs",
        "--cache-size", "16MiB", "--io-size", "64KiB",
    ]
    if not args.apply:
        command.append("--dry-run")
    command.extend(str(p) for p in paths)
    free_before = shutil.disk_usage(root).free
    timed_out = False
    try:
        tool = subprocess.run(command, capture_output=True, text=True, timeout=tool_timeout)
        tool_code = tool.returncode
        summary = tool.stdout[-2000:]
    except subprocess.TimeoutExpired:
        timed_out = True
        tool_code = None
        summary = "native comparison reached its time bound"
    after, after_inodes = fingerprints(paths, deadline)
    if before != after:
        raise ValueError("dependency verification failed")
    if args.current_link.resolve(strict=True) != current_before:
        raise ValueError("live release changed during maintenance")
    return {
        "status": "completed" if tool_code == 0 else "incomplete",
        "apply": args.apply, "roots": len(roots), "files": len(paths),
        "verifiedFiles": len(after), "uniqueFilesBefore": before_inodes,
        "uniqueFilesAfter": after_inodes, "toolExit": tool_code,
        "toolTimedOut": timed_out, "toolSummary": summary,
        "freeBytesBefore": free_before, "freeBytesAfter": shutil.disk_usage(root).free,
        "seconds": round(time.monotonic() - started, 2),
    }


def main():
    if sys.platform != "linux":
        raise RuntimeError("this maintenance command requires Linux")
    import fcntl

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--current-link", type=Path, required=True)
    parser.add_argument("--protected-release", type=Path, action="append", default=[])
    parser.add_argument("--receipt-directory", type=Path, required=True)
    parser.add_argument("--keep", type=int, default=10)
    parser.add_argument("--minimum-age-hours", type=int, default=3)
    parser.add_argument("--minimum-file-bytes", type=int, default=1048576)
    parser.add_argument("--maximum-files", type=int, default=5000)
    parser.add_argument("--deadline-seconds", type=int, default=150)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if args.keep < 2 or args.minimum_age_hours < 3 or args.minimum_file_bytes < 1048576:
        parser.error("keep at least two releases, a three-hour age, and files of at least 1 MiB")
    if not 1 <= args.maximum_files <= 5000 or not 60 <= args.deadline_seconds <= 150:
        parser.error("file and deadline budgets are outside safe bounds")
    args.receipt_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (args.receipt_directory / "maintenance.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"status": "already_running"}))
            return 0
        try:
            result = maintain(args)
        except Exception as error:
            result = {"status": "failed", "error": type(error).__name__, "detail": str(error)}
        result["at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        temporary = args.receipt_directory / "latest.json.tmp"
        temporary.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
        temporary.replace(args.receipt_directory / "latest.json")
        print(json.dumps({key: value for key, value in result.items() if key != "toolSummary"}))
        return 0 if result["status"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
