"""Shared fixtures for the web app tests. Unit tests use SQLite; tests marked `postgres` run only
when SEARCHTRAIL_TEST_DATABASE_URL points at a Postgres database (CI sets it)."""
from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.db import models  # noqa: F401  (registers the tables)
from app.db.base import Base

POSTGRES_URL = os.environ.get("SEARCHTRAIL_TEST_DATABASE_URL")


def pytest_configure(config):
    config.addinivalue_line("markers", "postgres: needs SEARCHTRAIL_TEST_DATABASE_URL (a Postgres database)")


def pytest_collection_modifyitems(config, items):
    if POSTGRES_URL:
        return
    skip = pytest.mark.skip(reason="set SEARCHTRAIL_TEST_DATABASE_URL to run Postgres tests")
    for item in items:
        if "postgres" in item.keywords:
            item.add_marker(skip)


@pytest.fixture
def sessions(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}")
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    engine.dispose()


@pytest.fixture
def pg_sessions():
    engine = create_engine(POSTGRES_URL)
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, expire_on_commit=False)
    Base.metadata.drop_all(engine)
    engine.dispose()
