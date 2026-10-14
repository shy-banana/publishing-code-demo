import json
import os
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse

import database

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
IDENTITY = {"release": "python-fastapi-v1", "language": "Python", "framework": "FastAPI"}
HTML = Path(__file__).with_name("index.html").read_text()


@app.get("/", response_class=HTMLResponse)
def root():
    return HTML


@app.get("/readyz")
@app.get("/healthz")
def health():
    try:
        state = database.ready()
        return {**IDENTITY, "status": "ready", **state}
    except Exception:
        return JSONResponse({**IDENTITY, "status": "unavailable"}, status_code=503)


@app.get("/api/release")
def release():
    return {**IDENTITY, "commitSha": os.environ.get("SOURCE_COMMIT_SHA")}


@app.get("/api/checks")
def read_checks(keyword: str = ""):
    try:
        keyword = keyword[:100]
        items = database.records(keyword)
        return {**IDENTITY, "count": len(items), "keyword": keyword, "records": items}
    except Exception:
        return JSONResponse({**IDENTITY, "error": "temporarily_unavailable"}, status_code=503)


@app.post("/api/checks")
async def add_check(request: Request):
    if not request.headers.get("content-type", "").startswith("application/json"):
        return JSONResponse({"error": "json_required"}, status_code=415)
    raw = bytearray()
    async for chunk in request.stream():
        raw.extend(chunk)
        if len(raw) > 2048:
            return JSONResponse({"error": "too_large"}, status_code=413)
    try:
        body = json.loads(raw)
    except (ValueError, UnicodeError):
        return JSONResponse({"error": "invalid_json"}, status_code=400)
    title = body.get("title") if isinstance(body, dict) else None
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        return JSONResponse({"error": "invalid_title"}, status_code=400)
    try:
        return JSONResponse(database.create(title.strip()), status_code=201)
    except Exception:
        return JSONResponse({**IDENTITY, "error": "temporarily_unavailable"}, status_code=503)
