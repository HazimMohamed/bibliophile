#!/usr/bin/env python3
"""
dev.py — run Bibliophile backend + frontend together with prefixed, colorized output.

Usage:
    python3 dev.py
    ./dev.py          (after chmod +x dev.py)
"""

import os
import shutil
import signal
import subprocess
import sys
import threading
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent

# ── ANSI helpers ──────────────────────────────────────────────────────────────

RESET  = "\033[0m"
BOLD   = "\033[1m"
DIM    = "\033[2m"

# BE: warm orange  FE: soft blue
BE_COLOR = "\033[38;5;215m"   # #ffaf5f
FE_COLOR = "\033[38;5;111m"   # #87afff
OK_COLOR = "\033[38;5;114m"   # #87d787 green
ERR_COLOR= "\033[38;5;203m"   # #ff5f5f red

def _ts() -> str:
    return DIM + datetime.now().strftime("%H:%M:%S") + RESET

def _label(color: str, name: str) -> str:
    return color + BOLD + f"[{name}]" + RESET

BE_LABEL = _label(BE_COLOR, "backend ")
FE_LABEL = _label(FE_COLOR, "frontend")

def status(msg: str) -> None:
    print(f"  {OK_COLOR}{BOLD}{msg}{RESET}", flush=True)

def err(msg: str) -> None:
    print(f"  {ERR_COLOR}{BOLD}{msg}{RESET}", flush=True)

# ── Command resolution ────────────────────────────────────────────────────────

def _resolve_backend_cmd() -> list[str]:
    """Return the uvicorn command, preferring a local .venv."""
    venv_uvicorn = ROOT / ".venv" / "bin" / "uvicorn"
    if venv_uvicorn.exists():
        return [str(venv_uvicorn), "backend.main:app", "--reload"]
    # Fall back to python -m uvicorn (works with whatever python3 is active)
    return [sys.executable, "-m", "uvicorn", "backend.main:app", "--reload"]

def _resolve_frontend_cmd() -> list[str]:
    npm = shutil.which("npm")
    if not npm:
        err("npm not found in PATH — cannot start frontend")
        sys.exit(1)
    return [npm, "run", "dev"]

# ── Stream reader thread ──────────────────────────────────────────────────────

def _pipe_output(proc: subprocess.Popen, label: str, color: str) -> None:
    """Read lines from proc.stdout and print them with prefix + timestamp."""
    lbl = _label(color, label)
    for raw in proc.stdout:
        line = raw.rstrip("\n")
        if not line:
            continue
        print(f"{_ts()}  {lbl}  {line}", flush=True)

# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print()
    status("Bibliophile dev server starting…")
    print()

    be_cmd = _resolve_backend_cmd()
    fe_cmd = _resolve_frontend_cmd()

    status(f"BE  {' '.join(be_cmd)}")
    status(f"FE  {' '.join(fe_cmd)}")
    print()

    procs: list[subprocess.Popen] = []

    def _start(cmd: list[str], cwd: Path) -> subprocess.Popen:
        return subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            env={**os.environ, "FORCE_COLOR": "1", "PYTHONUNBUFFERED": "1"},
        )

    be_proc = _start(be_cmd, ROOT)
    fe_proc = _start(fe_cmd, ROOT / "frontend")
    procs.extend([be_proc, fe_proc])

    # One thread per process to drain stdout without blocking
    be_thread = threading.Thread(
        target=_pipe_output, args=(be_proc, "backend ", BE_COLOR), daemon=True
    )
    fe_thread = threading.Thread(
        target=_pipe_output, args=(fe_proc, "frontend", FE_COLOR), daemon=True
    )
    be_thread.start()
    fe_thread.start()

    def _shutdown(signum=None, frame=None) -> None:
        print()
        status("Shutting down…")
        for p in procs:
            if p.poll() is None:
                p.terminate()
        for p in procs:
            try:
                p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                p.kill()
        status("Done.")
        sys.exit(0)

    signal.signal(signal.SIGINT,  _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    # Block until both processes exit (or Ctrl+C)
    be_proc.wait()
    fe_proc.wait()

    # If we get here a process exited on its own
    for p, name in [(be_proc, "backend"), (fe_proc, "frontend")]:
        if p.returncode not in (0, -15):   # -15 = SIGTERM
            err(f"{name} exited with code {p.returncode}")
    _shutdown()


if __name__ == "__main__":
    main()
