import os
from pathlib import Path

from flask import Flask, jsonify, request
from werkzeug.exceptions import BadRequest, RequestEntityTooLarge

import database

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 2048
IDENTITY = {"release": "python-flask-v1", "language": "Python", "framework": "Flask"}
HTML = Path(__file__).with_name("index.html").read_text()


@app.get("/")
def root():
    return HTML, 200, {"Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store"}


@app.get("/readyz")
@app.get("/healthz")
def health():
    try:
        state = database.ready()
        return jsonify({**IDENTITY, "status": "ready", **state})
    except Exception:
        return jsonify({**IDENTITY, "status": "unavailable"}), 503


@app.get("/api/release")
def release():
    return jsonify({**IDENTITY, "commitSha": os.environ.get("SOURCE_COMMIT_SHA")})


@app.get("/api/checks")
def read_checks():
    try:
        keyword = request.args.get("keyword", "")[:100]
        items = database.records(keyword)
        return jsonify({**IDENTITY, "count": len(items), "keyword": keyword, "records": items})
    except Exception:
        return jsonify({**IDENTITY, "error": "temporarily_unavailable"}), 503


@app.post("/api/checks")
def add_check():
    if not request.content_type or not request.content_type.startswith("application/json"):
        return jsonify({"error": "json_required"}), 415
    try:
        body = request.get_json()
    except RequestEntityTooLarge:
        return jsonify({"error": "too_large"}), 413
    except BadRequest:
        return jsonify({"error": "invalid_json"}), 400
    title = body.get("title") if isinstance(body, dict) else None
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        return jsonify({"error": "invalid_title"}), 400
    try:
        return jsonify(database.create(title.strip())), 201
    except Exception:
        return jsonify({**IDENTITY, "error": "temporarily_unavailable"}), 503
