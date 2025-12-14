from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import shutil
import json

from bom_parser import parse_bom_pdf
from checklist import generate_checklist
from bom_full_parser import parse_full_bom
# ✅ APP MUST BE DEFINED FIRST
app = FastAPI()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# ✅ CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ✅ HEALTH CHECK
@app.get("/")
def health():
    return {"status": "Panel Inspection App Running"}

# ✅ UPLOAD BOM
@app.post("/upload/bom")
async def upload_bom(file: UploadFile = File(...)):
    file_path = DATA_DIR / file.filename
    with open(file_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    return {"message": "BOM uploaded", "filename": file.filename}

# ✅ PROCESS BOM
@app.post("/process/bom")
def process_bom(filename: str):
    file_path = DATA_DIR / filename

    # Existing logic (DO NOT CHANGE)
    bom_items = parse_bom_pdf(file_path)
    checklist = generate_checklist(bom_items)

    with open(DATA_DIR / "checklist.json", "w") as f:
        json.dump(checklist, f, indent=2)

    # ✅ NEW: Full BOM extraction
    full_bom = parse_full_bom(file_path)
    with open(DATA_DIR / "bom_full.json", "w") as f:
        json.dump(full_bom, f, indent=2)

    return checklist

@app.get("/bom/details/{find_number}")
def get_bom_details(find_number: str):
    bom_file = DATA_DIR / "bom_full.json"

    if not bom_file.exists():
        return {}

    with open(bom_file) as f:
        bom = json.load(f)

    key = str(find_number).strip()
    return bom.get(key, {})



