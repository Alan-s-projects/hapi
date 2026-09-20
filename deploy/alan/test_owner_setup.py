import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest


spec = importlib.util.spec_from_file_location("owner_setup", Path(__file__).with_name("owner-setup.py"))
owner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owner)


class OwnerSetupTests(unittest.TestCase):
    def test_usernames(self):
        for name in ("exampleuser", "owner_2", "owner-pc"):
            self.assertTrue(owner.username_valid(name))
        for name in ("ab", "root\nother", "a;whoami", "a'", "../x", "pending_enrollment", "a" * 33):
            self.assertFalse(owner.username_valid(name))

    def test_only_disabled_unprivileged_bootstrap_is_replaceable(self):
        self.assertTrue(owner.bootstrap_only({"users": {"pending_enrollment": {"disabled": True, "groups": []}}}))
        for users in ({}, {"exampleuser": {"disabled": False}},
                      {"pending_enrollment": {"disabled": False}},
                      {"pending_enrollment": {"disabled": True, "groups": ["owner"]}},
                      {"pending_enrollment": {"disabled": True}, "exampleuser": {"disabled": True}}):
            self.assertFalse(owner.bootstrap_only({"users": users}))

    def test_digest_only_accepts_expected_algorithm_and_cost(self):
        digest = b"$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$aGFzaA"
        self.assertEqual(owner.parse_digest(b"Enter Password: \r\nDigest: " + digest + b"\r\n"), digest.decode())
        for output in (b"password", b"Digest: $sha512$foo", b"Digest: " + digest.replace(b"t=3", b"t=1"),
                       b"Digest: " + digest + b"\nDigest: " + digest + b"\n"):
            with self.assertRaises(RuntimeError):
                owner.parse_digest(output)

    def test_rendered_database_contains_only_new_owner(self):
        result = json.loads(owner.render_owner("exampleuser", "sample-digest"))
        self.assertEqual(set(result["users"]), {"exampleuser"})
        user = result["users"]["exampleuser"]
        self.assertFalse(user["disabled"])
        self.assertEqual(user["groups"], ["owner"])
        self.assertEqual(user["email"], "exampleuser@example.invalid")

    def test_atomic_write_is_private_and_replaces_only_target(self):
        with tempfile.TemporaryDirectory(prefix="hapi-owner-test-") as folder:
            target = Path(folder) / "users.yml"
            untouched = Path(folder) / "other.txt"
            untouched.write_text("preserve")
            owner.atomic_write(target, b"new-value", os.getuid(), os.getgid())
            self.assertEqual(target.read_bytes(), b"new-value")
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertEqual(untouched.read_text(), "preserve")
            self.assertEqual(len(list(Path(folder).iterdir())), 2)


if __name__ == "__main__":
    unittest.main()
