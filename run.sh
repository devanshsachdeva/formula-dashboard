#!/bin/bash
# Launch the dashboard with a Python that actually has the required packages
# (avoids "ModuleNotFoundError: No module named 'flask'" when a terminal's
#  default python3 is the bare system one).
cd "$(dirname "$0")"

for PY in /opt/anaconda3/bin/python3 python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
  if command -v "$PY" >/dev/null 2>&1 && "$PY" -c "import flask, pandas, openpyxl" 2>/dev/null; then
    echo "Using $(command -v "$PY")"
    exec "$PY" app.py
  fi
done

echo "No Python with flask+pandas+openpyxl found." >&2
echo "Install them with:  python3 -m pip install -r requirements.txt" >&2
exit 1
