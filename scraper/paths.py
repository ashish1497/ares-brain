"""Filesystem layout for the course agent. Mirrors mcp/src/lib/paths.ts."""
import os
import re
from pathlib import Path

HOME = Path(os.environ.get("COURSE_AGENT_HOME", Path(__file__).resolve().parent.parent))


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower())
    return s.strip("-")


def courses_root() -> Path:
    return HOME / "courses"


def course_dir(slug: str) -> Path:
    return courses_root() / slug


def raw_dir(slug: str) -> Path:
    return course_dir(slug) / "raw"


def global_file(name: str) -> Path:
    return courses_root() / name


def ensure(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
