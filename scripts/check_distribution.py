#!/usr/bin/env python3
"""Keep standalone browser pages and the retired demo builder out of source."""
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
tracked = subprocess.check_output(["git", "ls-files", "-z"], cwd=root).decode().split("\0")
forbidden = []
for name in filter(None, tracked):
    path = Path(name)
    if (path.suffix.lower() in {".html", ".htm", ".webarchive"}
            or path.parts[0] in {"web", "demo", "demos", "internal-demo"}
            or path.name == "build-space.py"):
        forbidden.append(name)
if forbidden:
    raise SystemExit("Development-demo files must stay outside the product repository:\n" + "\n".join(forbidden))
print("Distribution boundary verified: no standalone browser pages or hosted-demo builder are tracked.")
