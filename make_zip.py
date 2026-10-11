
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import sys

# Project root and backend paths
ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "monstera-backend"
OUTPUT = ROOT / "monstera-backend.zip"

if not BACKEND.is_dir():
    sys.exit(f"Backend folder not found: {BACKEND}")

# Create a clean Procfile (UTF-8, no BOM, no trailing newline)
procfile = BACKEND / "Procfile"
procfile.write_bytes(
    b"web: uvicorn app.main:app --host 0.0.0.0 --port 8000"
)

# Exclude development files and secrets
EXCLUDED_DIRS = {
    ".venv", "venv", "__pycache__", ".pytest_cache",
    ".git", ".mypy_cache", ".ruff_cache", "node_modules",
}
EXCLUDED_FILES = {
    ".env",
}

required = [
    "Procfile",
    "requirements.txt",
    "app/main.py",
    "alembic.ini",
]

# Build the ZIP with POSIX paths
with ZipFile(OUTPUT, "w", ZIP_DEFLATED) as zf:
    for path in BACKEND.rglob("*"):
        if not path.is_file():
            continue

        relative = path.relative_to(BACKEND)

        if any(part in EXCLUDED_DIRS for part in relative.parts):
            continue
        if relative.name in EXCLUDED_FILES:
            continue

        zf.write(path, relative.as_posix())

# Verify archive contents
with ZipFile(OUTPUT, "r") as zf:
    names = zf.namelist()
    bad_paths = [name for name in names if "\\" in name]
    missing = [name for name in required if name not in names]

    print(f"\nZIP: {OUTPUT}")
    print(f"Files included: {len(names)}")
    print(f"Invalid backslash paths: {bad_paths}")
    print(f"Missing required files: {missing}")

    if bad_paths or missing:
        sys.exit("ZIP verification failed!")

    print("\nSUCCESS: Backend ZIP created and verified.")
