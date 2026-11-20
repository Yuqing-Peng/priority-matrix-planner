import argparse
import json
import re
import sqlite3
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB = Path(__file__).resolve().parent / "planner.db"

URGENCY = {"urgent", "not-urgent"}
IMPORTANCE = {"important", "not-important"}
STATUS = {"notStarted", "inProgress", "completed"}
DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
MAX_BODY = 1_000_000

SCHEMA = """
CREATE TABLE IF NOT EXISTS tasks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    time        INTEGER NOT NULL DEFAULT 0,
    urgency     TEXT NOT NULL,
    importance  TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'other',
    deadline    TEXT,
    status      TEXT NOT NULL DEFAULT 'notStarted',
    completed   INTEGER NOT NULL DEFAULT 0,
    position    INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""

class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message

class Store:
    def __init__(self, db_path):
        self.db_path = str(db_path)
        with self._connect() as conn:
            conn.executescript(SCHEMA)

    def _connect(self):
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        return conn

    def list_tasks(self, completed):
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE completed = ? ORDER BY position, rowid",
                (1 if completed else 0,),
            ).fetchall()
        return [self._row_to_task(r) for r in rows]

    def replace_tasks(self, tasks, completed):
        clean = [validate_task(t, completed) for t in tasks]
        ids = [t["id"] for t in clean]
        if len(ids) != len(set(ids)):
            raise ApiError(HTTPStatus.BAD_REQUEST, "duplicate task ids")
        conn = self._connect()
        try:
            with conn:
                conn.execute("DELETE FROM tasks WHERE completed = ?", (1 if completed else 0,))
                conn.executemany("DELETE FROM tasks WHERE id = ?", [(i,) for i in ids])
                conn.executemany(
                    """INSERT INTO tasks (id, name, time, urgency, importance, category,
                                          deadline, status, completed, position)
                       VALUES (:id, :name, :time, :urgency, :importance, :category,
                               :deadline, :status, :completed, :position)""",
                    [dict(t, position=i) for i, t in enumerate(clean)],
                )
        finally:
            conn.close()
        return self.list_tasks(completed)

    def upsert_task(self, task):
        t = validate_task(task, bool(task.get("completed")))
        conn = self._connect()
        try:
            with conn:
                pos = conn.execute("SELECT COALESCE(MAX(position) + 1, 0) FROM tasks").fetchone()[0]
                conn.execute(
                    """INSERT INTO tasks (id, name, time, urgency, importance, category,
                                          deadline, status, completed, position)
                       VALUES (:id, :name, :time, :urgency, :importance, :category,
                               :deadline, :status, :completed, :position)
                       ON CONFLICT(id) DO UPDATE SET
                         name=excluded.name, time=excluded.time, urgency=excluded.urgency,
                         importance=excluded.importance, category=excluded.category,
                         deadline=excluded.deadline, status=excluded.status,
                         completed=excluded.completed""",
                    dict(t, position=pos),
                )
        finally:
            conn.close()
        return t

    def delete_task(self, task_id):
        conn = self._connect()
        try:
            with conn:
                cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        finally:
            conn.close()
        return cur.rowcount > 0

    @staticmethod
    def _row_to_task(r):
        task = {
            "id": r["id"],
            "name": r["name"],
            "time": r["time"],
            "urgency": r["urgency"],
            "importance": r["importance"],
            "category": r["category"],
            "deadline": r["deadline"] or "",
            "status": r["status"],
        }
        if r["completed"]:
            task["completed"] = True
        return task

    def get_kv(self, key):
        with self._connect() as conn:
            row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else None

    def set_kv(self, key, value):
        if not isinstance(value, dict):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"{key} must be a JSON object")
        conn = self._connect()
        try:
            with conn:
                conn.execute(
                    "INSERT INTO kv (key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, json.dumps(value)),
                )
        finally:
            conn.close()
        return value

    def delete_kv(self, key):
        conn = self._connect()
        try:
            with conn:
                conn.execute("DELETE FROM kv WHERE key = ?", (key,))
        finally:
            conn.close()

    def state(self):
        return {
            "tasks": self.list_tasks(completed=False),
            "completedTasks": self.list_tasks(completed=True),
            "settings": self.get_kv("settings"),
            "timers": self.get_kv("timers") or {},
        }

def validate_task(raw, completed):
    if not isinstance(raw, dict):
        raise ApiError(HTTPStatus.BAD_REQUEST, "task must be a JSON object")

    def text(field, default=None, max_len=500):
        value = raw.get(field, default)
        if value is None:
            return None
        if not isinstance(value, str):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"task.{field} must be a string")
        return value.strip()[:max_len]

    task_id = text("id", max_len=100)
    name = text("name")
    if not task_id or not name:
        raise ApiError(HTTPStatus.BAD_REQUEST, "task.id and task.name are required")

    try:
        seconds = int(raw.get("time") or 0)
    except (TypeError, ValueError):
        raise ApiError(HTTPStatus.BAD_REQUEST, "task.time must be an integer (seconds)")

    urgency = text("urgency")
    importance = text("importance")
    if urgency not in URGENCY:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"task.urgency must be one of {sorted(URGENCY)}")
    if importance not in IMPORTANCE:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"task.importance must be one of {sorted(IMPORTANCE)}")

    status = text("status") or ("completed" if completed else "notStarted")
    if status not in STATUS:
        status = "notStarted"

    return {
        "id": task_id,
        "name": name,
        "time": max(seconds, 0),
        "urgency": urgency,
        "importance": importance,
        "category": text("category") or "other",
        "deadline": deadline if DATE_RE.fullmatch(deadline := text("deadline", max_len=10) or "") else None,
        "status": "completed" if completed else status,
        "completed": 1 if completed else 0,
    }

class Handler(SimpleHTTPRequestHandler):
    store: Store = None

    BLOCKED_PREFIXES = ("/backend", "/.")

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._api("GET", path)
        if any(path.startswith(p) for p in self.BLOCKED_PREFIXES):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path.startswith("/api/") or any(path.startswith(p) for p in self.BLOCKED_PREFIXES):
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_POST(self):
        self._api("POST", urlparse(self.path).path)

    def do_PUT(self):
        self._api("PUT", urlparse(self.path).path)

    def do_DELETE(self):
        self._api("DELETE", urlparse(self.path).path)

    def _api(self, method, path):
        try:
            parts = [p for p in path.split("/") if p][1:]
            result = self._dispatch(method, parts)
            if isinstance(result, tuple):
                self._send(HTTPStatus.OK, result[1], result[0])
            elif result is None:
                self._send(HTTPStatus.NO_CONTENT, b"")
            else:
                self._json(HTTPStatus.OK, result)
        except ApiError as e:
            self._json(e.status, {"error": e.message})
        except Exception as e:
            self.log_error("API error: %r", e)
            self._json(HTTPStatus.INTERNAL_SERVER_ERROR, {"error": "internal server error"})

    def _dispatch(self, method, parts):
        s = self.store
        route = (method, *parts)

        if route == ("GET", "health"):
            return {"status": "ok"}
        if route == ("GET", "state"):
            return s.state()
        if route == ("GET", "bootstrap.js"):
            body = "window.__PLANNER_STATE__ = " + json.dumps(s.state()) + ";\n"
            return ("application/javascript; charset=utf-8", body.encode("utf-8"))

        if route == ("GET", "tasks"):
            return s.list_tasks(completed=False)
        if route == ("PUT", "tasks"):
            return s.replace_tasks(self._body(list), completed=False)
        if route == ("POST", "tasks"):
            return s.upsert_task(self._body(dict))
        if method == "DELETE" and len(parts) == 2 and parts[0] == "tasks":
            if not s.delete_task(parts[1]):
                raise ApiError(HTTPStatus.NOT_FOUND, "task not found")
            return None

        if route == ("GET", "completed-tasks"):
            return s.list_tasks(completed=True)
        if route == ("PUT", "completed-tasks"):
            return s.replace_tasks(self._body(list), completed=True)
        if route == ("DELETE", "completed-tasks"):
            s.replace_tasks([], completed=True)
            return None

        for key in ("settings", "timers"):
            if route == ("GET", key):
                return s.get_kv(key) or {}
            if route == ("PUT", key):
                return s.set_kv(key, self._body(dict))
            if route == ("DELETE", key):
                s.delete_kv(key)
                return None

        raise ApiError(HTTPStatus.NOT_FOUND, f"no route for {method} /api/{'/'.join(parts)}")

    def _body(self, expected_type):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ApiError(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "request body too large")
        try:
            data = json.loads(self.rfile.read(length) or b"null")
        except json.JSONDecodeError:
            raise ApiError(HTTPStatus.BAD_REQUEST, "invalid JSON")
        if not isinstance(data, expected_type):
            raise ApiError(HTTPStatus.BAD_REQUEST, f"expected a JSON {expected_type.__name__}")
        return data

    def _json(self, status, payload):
        self._send(status, json.dumps(payload).encode("utf-8"), "application/json; charset=utf-8")

    def _send(self, status, body, content_type="text/plain"):
        self.send_response(status)
        if body:
            self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body and self.command != "HEAD":
            self.wfile.write(body)

def main(argv=None):
    parser = argparse.ArgumentParser(description="Priority Matrix Planner local server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--db", default=str(DEFAULT_DB), help="SQLite database file")
    args = parser.parse_args(argv)

    Handler.store = Store(args.db)
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(ROOT)))
    print(f"Priority Matrix Planner running at http://localhost:{args.port}  (db: {args.db})")
    print("Press Ctrl+C to stop.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping.")
    finally:
        server.server_close()
    return 0

if __name__ == "__main__":
    sys.exit(main())
