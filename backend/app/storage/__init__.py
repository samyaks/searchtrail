"""File storage for report files and downloaded export packages.

A small interface so WS-G can add blob storage later; today there is one implementation, a local
directory (SEARCHTRAIL_STORAGE_DIR, a Docker volume in deploy/docker-compose.yml).

  storage = get_storage(settings)
  stored = storage.save(key_for("matters", matter_id, "previews", run_id, file_name),
                        lambda out: gateway.download_file(url, out))
  stored.key, stored.size, stored.sha256

Files are streamed: `save` hands the writer a stream and never holds the whole file in memory. A file
appears under its key only once it is complete (written to a temporary name, then renamed), so a
crash mid-download never leaves a truncated file that looks finished. The SHA-256 is computed while
writing, so the log can record exactly which bytes were collected.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO, Protocol

from app.settings import AppSettings

_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$")


class StorageError(ValueError):
    pass


@dataclass(frozen=True)
class StoredFile:
    key: str
    size: int
    sha256: str


class Storage(Protocol):
    def save(self, key: str, fill: Callable[[BinaryIO], object]) -> StoredFile:
        """Call fill(stream) to write the file, then make it visible under `key` (replacing any file
        already there). If fill raises, nothing is stored and the error propagates."""
        ...

    def open(self, key: str) -> BinaryIO:
        ...

    def exists(self, key: str) -> bool:
        ...

    def delete(self, key: str) -> None:
        """Remove the file if it exists."""
        ...


def safe_part(name: str) -> str:
    """One path segment from untrusted text (a Purview file name, say): unsafe characters become '_'."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._-")[:200]
    return cleaned or "file"


def key_for(*parts: str) -> str:
    """A storage key from segments, each made safe with safe_part."""
    return "/".join(safe_part(p) for p in parts)


def check_key(key: str) -> str:
    parts = key.split("/")
    if not parts or not all(_PART.match(p) for p in parts):
        raise StorageError(f"Not a valid storage key: {key!r}. Build keys with key_for().")
    return key


class _HashingWriter:
    """What `fill` writes to: a file that counts bytes and hashes them as they pass."""

    def __init__(self, raw: BinaryIO):
        self.raw, self.size, self.hash = raw, 0, hashlib.sha256()

    def write(self, data: bytes) -> int:
        self.raw.write(data)
        self.hash.update(data)
        self.size += len(data)
        return len(data)

    def writable(self) -> bool:
        return True

    def flush(self) -> None:
        self.raw.flush()


class LocalStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root)

    def path(self, key: str) -> Path:
        """The file's location on disk (local storage only; parsing a report zip needs a real file)."""
        return self.root.joinpath(*check_key(key).split("/"))

    def save(self, key: str, fill: Callable[[BinaryIO], object]) -> StoredFile:
        dest = self.path(key)
        dest.parent.mkdir(parents=True, exist_ok=True)
        partial = dest.with_name(f".{dest.name}.{secrets.token_hex(4)}.part")
        try:
            with open(partial, "wb") as raw:
                writer = _HashingWriter(raw)
                fill(writer)  # type: ignore[arg-type]  - quacks like a binary stream for writing
                raw.flush()
                os.fsync(raw.fileno())
            os.replace(partial, dest)
        except BaseException:
            partial.unlink(missing_ok=True)
            raise
        return StoredFile(key=key, size=writer.size, sha256=writer.hash.hexdigest())

    def open(self, key: str) -> BinaryIO:
        return open(self.path(key), "rb")

    def exists(self, key: str) -> bool:
        return self.path(key).is_file()

    def delete(self, key: str) -> None:
        self.path(key).unlink(missing_ok=True)


def get_storage(settings: AppSettings) -> Storage:
    return LocalStorage(settings.storage_dir)
