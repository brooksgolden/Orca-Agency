import importlib.util
from pathlib import Path
import os
from types import SimpleNamespace
import tempfile
import time
import unittest
from unittest.mock import patch


SPEC = importlib.util.spec_from_file_location(
    "maintenance", Path(__file__).with_name("immutable-dependency-storage-maintenance.py")
)
maintenance = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(maintenance)


@unittest.skipUnless(os.name == "posix", "native hardlink acceptance runs on Linux")
class StorageMaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="orca-dependency-maintenance-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve() / "releases"
        self.root.mkdir()
        self.releases = []
        self.old = time.time() - 100000
        for index in range(14):
            release = self.root / f"repair-{index:012x}-{index + 1}"
            (release / "node_modules").mkdir(parents=True)
            self.releases.append(release)
        self.link = self.root.parent / "current-web"
        self.link.symlink_to(self.releases[0], target_is_directory=True)
        for index in [2, 3]:
            path = self.releases[index] / "node_modules" / "large.bin"
            path.write_bytes(b"x" * 1048576)
            path.chmod(0o640)
            os.utime(path, (self.old, self.old))
        self.reset_dates()
        self.args = SimpleNamespace(
            release_root=self.root, current_link=self.link,
            protected_release=[self.releases[1]], keep=10,
            minimum_age_hours=3, minimum_file_bytes=1048576,
            maximum_files=5000, deadline_seconds=60, apply=True,
        )

    def reset_dates(self):
        for index, release in enumerate(self.releases):
            os.utime(release, (self.old + index, self.old + index))

    def files(self):
        return [self.releases[index] / "node_modules" / "large.bin" for index in [2, 3]]

    def test_keeps_current_newest_and_protected_releases(self):
        roots = maintenance.candidate_roots(
            self.root, self.link, {self.releases[1]}, 10, 10800
        )
        self.assertEqual(roots, [self.releases[index] / "node_modules" for index in [2, 3]])

    def test_actual_consolidation_preserves_contents_and_metadata(self):
        before, count = maintenance.fingerprints(self.files(), time.monotonic() + 20)
        self.assertEqual(count, 2)
        result = maintenance.maintain(self.args)
        after, count = maintenance.fingerprints(self.files(), time.monotonic() + 20)
        self.assertEqual(before, after)
        self.assertEqual(count, 1)
        self.assertEqual(result["verifiedFiles"], 2)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(maintenance.maintain(self.args)["uniqueFilesAfter"], 1)

    def test_dry_run_changes_no_inode(self):
        self.args.apply = False
        before = [p.stat().st_ino for p in self.files()]
        maintenance.maintain(self.args)
        self.assertEqual(before, [p.stat().st_ino for p in self.files()])

    def test_mutable_dependency_is_refused_before_changes(self):
        self.files()[0].chmod(0o666)
        with self.assertRaisesRegex(ValueError, "writable by runtime"):
            maintenance.maintain(self.args)
        self.assertNotEqual(*(p.stat().st_ino for p in self.files()))

    def test_file_budget_is_enforced_before_changes(self):
        self.args.maximum_files = 1
        with self.assertRaisesRegex(ValueError, "file budget"):
            maintenance.maintain(self.args)

    def test_symlinked_dependency_root_is_never_traversed(self):
        target = self.releases[2] / "node_modules"
        other = self.root.parent / "external-dependencies"
        target.rename(other)
        target.symlink_to(other, target_is_directory=True)
        self.reset_dates()
        roots = maintenance.candidate_roots(self.root, self.link, set(), 10, 10800)
        self.assertNotIn(target, roots)

    def test_recent_release_is_excluded(self):
        os.utime(self.releases[2], None)
        roots = maintenance.candidate_roots(self.root, self.link, set(), 10, 10800)
        self.assertNotIn(self.releases[2] / "node_modules", roots)

    def test_external_current_release_is_refused(self):
        self.link.unlink()
        self.link.symlink_to(self.root.parent, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "current release"):
            maintenance.maintain(self.args)

    def test_cache_files_are_not_selected(self):
        cache = self.releases[2] / "node_modules" / ".cache"
        cache.mkdir()
        cached = cache / "large.bin"
        cached.write_bytes(b"y" * 1048576)
        self.reset_dates()
        roots = maintenance.candidate_roots(self.root, self.link, set(), 10, 10800)
        files = maintenance.find_large_files(roots, 1048576, time.monotonic() + 20, 5000)
        self.assertNotIn(cached, files)

    def test_verification_detects_changed_content(self):
        original = maintenance.subprocess.run

        def run(command, **kwargs):
            if command[0] != "hardlink":
                return original(command, **kwargs)
            path = self.files()[0]
            path.write_bytes(b"z" * 1048576)
            return SimpleNamespace(returncode=0, stdout="")

        with patch.object(maintenance.subprocess, "run", side_effect=run):
            with self.assertRaisesRegex(ValueError, "verification failed"):
                maintenance.maintain(self.args)


if __name__ == "__main__":
    unittest.main()
