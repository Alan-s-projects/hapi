import importlib.util
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location("browser_enrollment", Path(__file__).with_name("prepare-browser-enrollment.py"))
enrollment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(enrollment)
link_spec = importlib.util.spec_from_file_location("owner_reset", Path(__file__).with_name("request-owner-reset.py"))
reset = importlib.util.module_from_spec(link_spec)
link_spec.loader.exec_module(reset)


class BrowserEnrollmentTests(unittest.TestCase):
    def test_notification_is_replaced_not_appended(self):
        self.assertEqual(reset.new_notification(b'longer old notification', b'new message'), 'new message')
        self.assertEqual(reset.new_notification(b'', b'new message'), 'new message')
        for old, current in ((b'same', b'same'), (b'old', b''), (b'old', b'x' * 65537)):
            with self.assertRaises(RuntimeError):
                reset.new_notification(old, current)

    def test_reset_delivery_rejects_stale_or_wrong_user(self):
        claims = {'username': 'exampleuser', 'iat': 1000, 'exp': 1300}
        self.assertEqual(reset.validate_delivery_claims(claims, 'exampleuser', 1000, 1001), 1300)
        for changed in ({**claims, 'username': 'someone_else'}, {**claims, 'iat': 900},
                        {**claims, 'exp': 999}, {**claims, 'exp': 3000}):
            with self.assertRaises(RuntimeError):
                reset.validate_delivery_claims(changed, 'exampleuser', 1000, 1001)

    def test_link_extraction_is_scoped_to_exact_portal_and_reset_action(self):
        root = 'https://example.com/auth'
        link = root + '/reset-password/step2?token=aaa.bbb.ccc'
        self.assertEqual(reset.extract_link('link: ' + link + '\n' + link, root), link)
        for text in ('https://attacker.invalid/auth/reset-password/step2?token=aaa.bbb.ccc',
                     root + '/revoke/reset-password?token=aaa.bbb.ccc',
                     link + '\n' + root + '/reset-password/step2?token=other.token.value'):
            with self.assertRaises(RuntimeError):
                reset.extract_link(text, root)

    def test_mount_check_uses_enforced_mount_flags(self):
        inspection = {"HostConfig": {"ReadonlyRootfs": True}, "Mounts": [
            {"Destination": "/config", "RW": False},
            {"Destination": "/run/secrets", "RW": False},
            {"Destination": "/data", "RW": True},
        ]}
        self.assertTrue(enrollment.mounts_are_safe(inspection))
        inspection["Mounts"][0]["RW"] = True
        self.assertFalse(enrollment.mounts_are_safe(inspection))

    def test_minimal_mutation_preserves_authentication_policy_and_secrets(self):
        config = {
            "authentication_backend": {"file": {"path": "/config/users.yml"}, "password_reset": {"disable": True}},
            "access_control": {"default_policy": "deny", "rules": [{"policy": "two_factor"}]},
            "webauthn": {"enable_passkey_login": False, "selection_criteria": {"user_verification": "required"}},
            "session": {"remember_me": -1},
        }
        result = enrollment.browser_config(config)
        self.assertEqual(config["authentication_backend"]["file"]["path"], "/config/users.yml")
        self.assertEqual(result["authentication_backend"]["file"]["path"], "/data/users.yml")
        self.assertFalse(result["authentication_backend"]["password_reset"]["disable"])
        self.assertFalse(result["authentication_backend"]["password_change"]["disable"])
        for key in ("access_control", "webauthn", "session"):
            self.assertEqual(result[key], config[key])
        self.assertEqual(result["password_policy"]["standard"]["min_length"], 16)


if __name__ == "__main__":
    unittest.main()
