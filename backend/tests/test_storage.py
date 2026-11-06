"""Local file storage: streamed, atomic, hashed writes under safe keys."""
from __future__ import annotations

import hashlib

import pytest

from app.settings import AppSettings
from app.storage import LocalStorage, StorageError, get_storage, key_for, safe_part


def test_files_are_streamed_hashed_and_readable(tmp_path):
    storage = LocalStorage(tmp_path)
    chunks = [b"PK\x03\x04", b"x" * 100_000, b"end"]

    def fill(out):
        for chunk in chunks:  # how download_file writes: chunk by chunk
            out.write(chunk)

    stored = storage.save("matters/mat_1/exports/exp_1/package.zip", fill)
    data = b"".join(chunks)
    assert (stored.size, stored.sha256) == (len(data), hashlib.sha256(data).hexdigest())
    assert storage.exists(stored.key)
    with storage.open(stored.key) as f:
        assert f.read() == data
    assert storage.path(stored.key) == tmp_path / "matters" / "mat_1" / "exports" / "exp_1" / "package.zip"


def test_a_failed_write_leaves_nothing_behind(tmp_path):
    storage = LocalStorage(tmp_path)
    storage.save("a/report.zip", lambda out: out.write(b"the good one"))

    def broken(out):
        out.write(b"half a fi")
        raise ConnectionError("download cut off")

    with pytest.raises(ConnectionError):
        storage.save("a/report.zip", broken)
    with storage.open("a/report.zip") as f:
        assert f.read() == b"the good one"  # the earlier complete file is untouched
    assert [p.name for p in (tmp_path / "a").iterdir()] == ["report.zip"]  # no partial file left

    with pytest.raises(ConnectionError):
        storage.save("b/new.zip", broken)
    assert not storage.exists("b/new.zip")


def test_saving_again_replaces_and_delete_is_idempotent(tmp_path):
    storage = LocalStorage(tmp_path)
    storage.save("x/f.bin", lambda out: out.write(b"one"))
    assert storage.save("x/f.bin", lambda out: out.write(b"two!")).size == 4
    storage.delete("x/f.bin")
    storage.delete("x/f.bin")
    assert not storage.exists("x/f.bin")


@pytest.mark.parametrize("key", ["../etc/passwd", "/abs/path", "a//b", "", "a/../b", "a/.hidden", "a/b c"])
def test_unsafe_keys_are_refused(tmp_path, key):
    with pytest.raises(StorageError):
        LocalStorage(tmp_path).save(key, lambda out: out.write(b"x"))


def test_untrusted_names_are_made_safe():
    assert safe_part("Reports M-2026-0142 (1).zip") == "Reports_M-2026-0142_1_.zip"
    assert safe_part("..") == "file" and safe_part("../../x") == "x"
    assert key_for("matters", "mat_1", "previews", "run 2", "report.zip") == "matters/mat_1/previews/run_2/report.zip"


def test_settings_choose_the_directory(tmp_path):
    storage = get_storage(AppSettings(storage_dir=tmp_path / "store"))
    storage.save("k/v.txt", lambda out: out.write(b"hi"))
    assert (tmp_path / "store" / "k" / "v.txt").read_bytes() == b"hi"
