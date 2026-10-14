"""The platform supplies an app-scoped PostgreSQL connection and CA certificate."""
import os
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row


def connection():
    certificate = os.environ.get("PGSSLROOTCERT") or os.environ["PG_CA_CERT_PATH"]
    return psycopg.connect(
        os.environ["DATABASE_URL"],
        sslmode="verify-full",
        sslrootcert=certificate,
        connect_timeout=5,
        row_factory=dict_row,
    )


def ready():
    with connection() as conn:
        session = conn.execute("SELECT current_user AS role, pg_backend_pid() AS pid").fetchone()
        tls = conn.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = %s", (session["pid"],)).fetchone()
        count = conn.execute("SELECT count(*) AS count FROM publishing_checks").fetchone()
        if not session["role"] or not tls or not tls["ssl"]:
            raise RuntimeError("database_tls_required")
    return {"databaseTls": True, "recordCount": count["count"]}


def records(keyword):
    with connection() as conn:
        rows = conn.execute(
            "SELECT id,title,created_at FROM publishing_checks "
            "WHERE title ILIKE %s ORDER BY created_at DESC LIMIT 100",
            ("%" + keyword + "%",),
        ).fetchall()
    return [{"id": str(row["id"]), "title": row["title"],
             "created_at": row["created_at"].isoformat()} for row in rows]


def create(title):
    with connection() as conn:
        row = conn.execute(
            "INSERT INTO publishing_checks(id,title) VALUES(%s,%s) RETURNING id,title",
            (uuid4(), title),
        ).fetchone()
    return {"id": str(row["id"]), "title": row["title"]}
