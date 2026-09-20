#!/usr/bin/env python3
"""Operator-assisted Authelia enrollment; run by the owner over an SSH TTY.

Uses the existing Authelia container and its native hidden password prompts.
Passwords are never passed in argv, environment variables, files or chat.
Requires Python 3 and PyYAML on the gateway host. Does not enable public routes.
"""

import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time


CONTAINER = "hapi-authelia"
CONFIG = "/config/configuration.yml"
DIGEST_PATTERN = re.compile(
    rb"(?:^|[\r\n])Digest: (\$argon2id\$v=19\$m=65536,t=3,p=4\$"
    rb"[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+)(?=[\r\n]|$)"
)


def username_valid(value):
    return bool(re.fullmatch(r"[a-z][a-z0-9_-]{2,31}", value)) and value != "pending_enrollment"


def parse_digest(output):
    matches = DIGEST_PATTERN.findall(output)
    if len(matches) != 1:
        raise RuntimeError("Authelia did not return exactly one expected Argon2id digest.")
    return matches[0].decode("ascii")


def render_owner(username, digest):
    if not username_valid(username):
        raise ValueError("Use 3-32 lowercase letters, digits, underscores or hyphens; start with a letter.")
    # JSON is a YAML subset and safely escapes both names and password hashes.
    return json.dumps({"users": {username: {
        "disabled": False,
        "displayname": username,
        "password": digest,
        # No SMTP is configured. This address is only a label in the private
        # filesystem notifier, never a real delivery destination.
        "email": username + "@example.invalid",
        "groups": ["owner"],
    }}}, indent=2) + "\n"


def bootstrap_only(database):
    users = database.get("users", {})
    return (set(users) == {"pending_enrollment"}
            and users["pending_enrollment"].get("disabled") is True
            and users["pending_enrollment"].get("groups", []) == [])


def load_users(path):
    import yaml
    result = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(result, dict) or not isinstance(result.get("users"), dict):
        raise RuntimeError("Unexpected users database structure; no changes made.")
    return result


def users_path(directory):
    import yaml
    config = yaml.safe_load((directory / "authelia" / "configuration.yml").read_text())
    configured = config["authentication_backend"]["file"]["path"]
    paths = {"/config/users.yml": directory / "authelia" / "users.yml",
             "/data/users.yml": directory / "authelia-data" / "users.yml"}
    if configured not in paths:
        raise RuntimeError("Unexpected users database path; refusing to guess.")
    return paths[configured]


def hash_interactively():
    print("Choose a unique password/passphrase of at least 16 characters.", flush=True)
    print("The next two hidden prompts come directly from Authelia.", flush=True)
    # Docker cannot infer the output size through our capture pipe. Set a
    # nonzero size inside its TTY so Authelia does not wrap each prompt letter.
    command = ["docker", "exec", "-it", CONTAINER, "sh", "-c",
               "stty cols 100 rows 30 && exec authelia crypto hash generate "
               "argon2 --memory 65536 --iterations 3 --parallelism 4"]
    # stdin is the owner's real SSH terminal. Docker's container TTY handles
    # echo suppression. Capture stdout so the resulting hash is not displayed.
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output = bytearray()
    try:
        while True:
            value = process.stdout.read(1)
            if not value:
                break
            output.extend(value)
            if len(output) > 32768:
                raise RuntimeError("Unexpected hashing output; no changes made.")
            for prompt in (b"Enter Password: ", b"Confirm Password: "):
                if output.endswith(prompt):
                    print(prompt.decode("ascii"), end="", flush=True)
            if value == b"\n":
                print(flush=True)
        if process.wait() != 0:
            raise RuntimeError("Password confirmation or hashing failed; no changes made. Please retry.")
        return parse_digest(bytes(output))
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        process.stdout.close()


def atomic_write(path, content, uid=1000, gid=1000):
    fd, temporary = tempfile.mkstemp(prefix=".owner-setup-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            os.fchmod(stream.fileno(), 0o600)
            os.fchown(stream.fileno(), uid, gid)
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def restart_and_check():
    subprocess.run(["docker", "restart", CONTAINER], check=True, stdout=subprocess.DEVNULL)
    for _ in range(45):
        result = subprocess.run(
            ["docker", "inspect", "--format", "{{.State.Health.Status}}", CONTAINER],
            check=True, capture_output=True, text=True,
        )
        if result.stdout.strip() == "healthy":
            return
        time.sleep(2)
    raise RuntimeError("Authelia did not become healthy; restoring the previous users file.")


def setup(directory):
    path = users_path(directory)
    original = path.read_bytes()
    original_stat = path.stat()
    database = load_users(path)
    if not bootstrap_only(database):
        raise RuntimeError("An account already exists or the bootstrap changed. Refusing to overwrite it.")
    username = input("Gateway username [owner]: ").strip() or "owner"
    if not username_valid(username):
        raise ValueError("Use 3-32 lowercase letters, digits, underscores or hyphens; start with a letter.")
    print("Recovery remains operator-assisted through SSH; self-service password reset is disabled.")
    print("Registration verification messages will be read privately with the 'code' command.")
    if input("Create this owner account? Type yes: ").strip().lower() != "yes":
        print("Canceled; no changes made.")
        return
    digest = hash_interactively()
    replacement = render_owner(username, digest).encode("utf-8")
    if path.read_bytes() != original:
        raise RuntimeError("The users file changed during setup; no changes made.")
    backups = directory / "bootstrap-backups"
    backups.mkdir(mode=0o700, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = backups / ("users.before-owner." + stamp + ".yml")
    with backup.open("xb") as stream:
        os.fchmod(stream.fileno(), 0o600)
        stream.write(original)
    try:
        atomic_write(path, replacement)
        validation = subprocess.run(
            ["docker", "exec", CONTAINER, "authelia", "validate-config", "--config", CONFIG],
            capture_output=True,
        )
        if validation.returncode != 0:
            raise RuntimeError("Configuration validation failed; restoring the previous users file.")
        restart_and_check()
    except BaseException:
        atomic_write(path, original, original_stat.st_uid, original_stat.st_gid)
        restart_and_check()
        raise
    print("Owner account created and Authelia is healthy. Username: " + username)
    print("Public HAPI access was NOT enabled. Password/passkey enrollment is still required.")
    print("Tell your setup assistant that account creation is complete; do not send the password.")


def show_code(directory):
    path = directory / "authelia-data" / "enrollment-notifications.txt"
    if not path.exists():
        print("No verification message yet. Request device registration in the browser first.")
        return
    print("Private enrollment messages: do not copy these codes or links into chat.")
    # Read a bounded tail. Never publish this file or automatically open a link.
    with path.open("rb") as stream:
        stream.seek(max(0, path.stat().st_size - 16384))
        tail = stream.read().decode("utf-8", errors="replace")
    print("\n".join(tail.splitlines()[-60:]))


def check(directory):
    users = load_users(users_path(directory))["users"]
    print("Enabled owner accounts: " + str(sum(
        not entry.get("disabled", False) and "owner" in entry.get("groups", [])
        for entry in users.values()
    )))
    print("Bootstrap-only state: " + str(bootstrap_only({"users": users})))
    print("Authelia configuration validation:")
    subprocess.run(["docker", "exec", CONTAINER, "authelia", "validate-config",
                    "--config", CONFIG], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["setup", "code", "check"])
    parser.add_argument("--directory", type=Path, default=Path("/opt/hapi-gateway"))
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error("Run through sudo on the gateway host.")
    directory = args.directory.resolve(strict=True)
    if args.mode in {"setup", "code"} and not (sys.stdin.isatty() and sys.stdout.isatty()):
        parser.error("This operation requires the owner's interactive terminal; use ssh -t.")
    if args.mode == "setup":
        with (directory / ".owner-setup.lock").open("a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            setup(directory)
    elif args.mode == "code":
        show_code(directory)
    else:
        check(directory)


if __name__ == "__main__":
    try:
        main()
    except (Exception, KeyboardInterrupt) as error:
        print("Setup stopped: " + str(error), file=sys.stderr)
        sys.exit(1)
