"""
Live dashboard server — reads the RAW EXCEL workbooks directly.

  python3 app.py            ->  http://localhost:5001

The two Excel files in data/ are the source of truth. Edit them (or drop in
new versions with the same names) and the change shows up on the next page
load — the server re-reads the workbooks whenever their modified-time or size
changes. Nothing is cached to a JSON file on disk.

Endpoints:
  GET /               dashboard UI
  GET /api/data       merged dataset, rebuilt in memory if the Excel changed
  POST /api/refresh   force a re-read of the workbooks now
"""

import json
import os
import threading
from datetime import datetime

from flask import Flask, jsonify, request, send_from_directory

import process_data

app = Flask(__name__, static_folder="static", static_url_path="")

# in-memory cache: (payload_json_string, source_signature)
_cache = {"json": None, "sig": None}
_lock = threading.Lock()


def get_payload(force: bool = False) -> str:
    """Return the merged dataset as a JSON string, rebuilding from the raw
    Excel workbooks whenever they have changed on disk (or force=True)."""
    sig = process_data.source_signature()
    with _lock:
        if force or _cache["json"] is None or _cache["sig"] != sig:
            payload = process_data.build()
            _cache["json"] = json.dumps(payload)
            _cache["sig"] = sig
        return _cache["json"]


@app.route("/")
def index():
    return send_from_directory("static", "index.html")


@app.route("/api/data")
def api_data():
    try:
        body = get_payload()
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500
    return app.response_class(body, mimetype="application/json")


@app.route("/api/events", methods=["POST"])
def api_events():
    """Add a manual interval marker (appends a row to data/GL Events.xlsx)."""
    data = request.get_json(force=True, silent=True) or {}
    icb = str(data.get("icb", "")).strip()
    date = str(data.get("date", "")).strip()
    category = str(data.get("category", "ALL")).strip().upper() or "ALL"
    description = str(data.get("description", "")).strip()

    if not icb or not date or not description:
        return jsonify({"error": "icb, date and description are required"}), 400
    try:
        datetime.strptime(date, "%Y-%m-%d")
    except ValueError:
        return jsonify({"error": "date must be YYYY-MM-DD"}), 400
    if category not in process_data.EVENT_CATEGORIES:
        category = "ALL"

    process_data.append_event(icb, date, category, description)
    get_payload(force=True)  # rebuild so the new event is in the next response
    return jsonify({"status": "ok"})


@app.route("/api/refresh", methods=["POST"])
def api_refresh():
    try:
        body = get_payload(force=True)
    except FileNotFoundError as e:
        return jsonify({"error": str(e)}), 500
    return jsonify({"status": "ok", "generated_at": json.loads(body)["generated_at"]})


if __name__ == "__main__":
    print(f"Reading guidelines : {process_data.GL_XLSX}")
    print(f"Reading performance: {process_data.PERF_XLSX}")
    get_payload()  # warm the cache (and surface missing-file errors) at startup
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)), debug=False)
