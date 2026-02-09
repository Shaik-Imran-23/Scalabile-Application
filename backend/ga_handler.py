from pathlib import Path
import shutil
from fastapi import UploadFile

# ==========================================================
# GA HANDLER (SESSION-AWARE)
# ==========================================================
# IMPORTANT DESIGN RULE:
# - This file NEVER decides where data is stored globally
# - main.py MUST pass session_base explicitly
# ==========================================================


def ensure_ga_dir(session_base: Path) -> Path:
    """
    Ensure GA directory exists for the given session.
    """
    ga_dir = session_base / "ga"
    ga_dir.mkdir(parents=True, exist_ok=True)
    return ga_dir


def save_ga(session_base: Path, file: UploadFile) -> str:
    """
    Save GA file from UploadFile object into session-specific GA directory.
    """
    ga_dir = ensure_ga_dir(session_base)

    ga_path = ga_dir / file.filename
    with open(ga_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return ga_path.name


def save_ga_from_bytes(session_base: Path, filename: str, content: bytes) -> str:
    """
    Save GA file from bytes content (used after validation)
    into session-specific GA directory.
    """
    ga_dir = ensure_ga_dir(session_base)

    ga_path = ga_dir / filename
    with open(ga_path, "wb") as f:
        f.write(content)

    return filename
