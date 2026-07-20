"""Tiny idempotent schema patches for databases created before a column existed.

The project uses create_all() rather than Alembic; this covers the additive
changes so existing volumes and SQLite files keep working after an upgrade.
"""

import logging
import re

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

log = logging.getLogger("smartsplit.migrate")

# table -> column -> DDL type + default
ADDITIONS = {
    "users": {
        "email_verified": "BOOLEAN NOT NULL DEFAULT FALSE",
        "google_sub": "VARCHAR",
        "avatar_url": "VARCHAR",
        "username": "VARCHAR",
        "theme": "VARCHAR NOT NULL DEFAULT 'system'",
    },
    "groups": {
        "simplify_debts": "BOOLEAN NOT NULL DEFAULT TRUE",
    },
    "activities": {
        "payload": "TEXT",
        "undone": "BOOLEAN NOT NULL DEFAULT FALSE",
        "undo_of_id": "INTEGER",
    },
}


def run(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in ADDITIONS.items():
            if table not in existing_tables:
                continue
            present = {c["name"] for c in inspector.get_columns(table)}
            for column, ddl in columns.items():
                if column in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                log.info("Added %s.%s", table, column)

        # OTP-only accounts have no password, so the column must be nullable.
        if "users" in existing_tables and engine.dialect.name == "postgresql":
            conn.execute(text("ALTER TABLE users ALTER COLUMN hashed_password DROP NOT NULL"))

        # ALTER TABLE ADD COLUMN doesn't carry the model's index along.
        if "users" in existing_tables:
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_sub ON users (google_sub)")
            )
            _backfill_usernames(conn)
            conn.execute(
                text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username)")
            )


def _backfill_usernames(conn) -> None:
    """Give pre-existing accounts a handle derived from their email."""
    rows = conn.execute(
        text("SELECT id, email FROM users WHERE username IS NULL ORDER BY id")
    ).fetchall()
    if not rows:
        return

    taken = {
        r[0] for r in conn.execute(
            text("SELECT username FROM users WHERE username IS NOT NULL")
        ).fetchall()
    }
    for uid, email in rows:
        base = re.sub(r"[^a-z0-9_.]", "", (email or "").split("@")[0].lower()) or "user"
        base = base[:24].strip(".") or "user"
        if len(base) < 3:
            base = f"{base}user"
        candidate, n = base, 1
        while candidate in taken:
            n += 1
            candidate = f"{base}{n}"
        taken.add(candidate)
        conn.execute(
            text("UPDATE users SET username = :u WHERE id = :i"), {"u": candidate, "i": uid}
        )
        log.info("Backfilled username %s for user %s", candidate, uid)
