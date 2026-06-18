#!/usr/bin/env bash
# One-time setup for Sampada's CAS import parser.
# Creates a local Python virtualenv and installs `casparser`.
#
#   bash server/tools/cas/setup.sh
#
# Notes:
# - casparser >= 1.x (full demat stocks + mutual funds) needs Python >= 3.10.
#   On Python 3.9 you get casparser 0.7.4 (mutual funds only) — still useful.
# - `cryptography` (a casparser dependency) needs prebuilt wheels or a Rust
#   toolchain. We create the venv with --system-site-packages so it can reuse a
#   cryptography already provided by the system/Anaconda Python and avoid building.
set -e
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV="$HERE/.venv"
PYBIN="${PYTHON:-python3}"

echo "→ Creating venv at $VENV (python: $($PYBIN --version 2>&1))"
"$PYBIN" -m venv --system-site-packages "$VENV"
PY="$VENV/bin/python"
"$PY" -m pip install -q --upgrade pip

echo "→ Installing casparser…"
if "$PY" -m pip install -q casparser 2>/dev/null; then
  echo "✓ Installed casparser (full)"
else
  echo "… wheel build failed (likely cryptography). Falling back to reuse system cryptography."
  "$PY" -m pip install -q --no-deps casparser casparser-isin
  "$PY" -m pip install -q "pydantic>=2,<3" "pdfminer.six==20221105" rapidfuzz \
    "rich>=13.5,<14" "colorama>=0.4.6" click python-dateutil
fi

echo "→ Verifying…"
"$PY" -c "import casparser; print('✓ casparser', casparser.__version__, 'ready')"
"$PY" "$HERE/parse_cas.py" --self-test >/dev/null && echo "✓ sidecar self-test passed"
echo "Done. CAS import is enabled."
