"""Per-student local identity — used only as a Drive subfolder name and
attribution label. Never uploaded/shared itself."""
import os


def my_name() -> str:
    name = os.environ.get("ARES_BRAIN_STUDENT_NAME", "").strip()
    if not name:
        raise ValueError(
            "ARES_BRAIN_STUDENT_NAME is not set in .env — set it to your name "
            "before sharing notes/testprep (used as your shared-folder name)."
        )
    return name
