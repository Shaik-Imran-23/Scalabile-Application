"""
main.py - FastAPI Backend with GA Pipeline Integration
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
import shutil
import json
import uuid
import asyncio
from typing import Dict

from bom_parser import parse_bom_pdf
from checklist import generate_checklist
from bom_full_parser import parse_full_bom
from ga_handler import save_ga

# ===============================
# APP INITIALIZATION
# ===============================
app = FastAPI()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Track processing jobs
processing_jobs: Dict[str, dict] = {}

# ===============================
# CORS
# ===============================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ===============================
# HEALTH CHECK
# ===============================
@app.get("/")
def health():
    return {"status": "Panel Inspection App Running"}

# ===============================
# BOM ENDPOINTS
# ===============================
@app.post("/upload/bom")
async def upload_bom(file: UploadFile = File(...)):
    """Upload BOM PDF file"""
    
    # Validate file type
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "Only PDF files allowed")
    
    # Validate file size (10MB limit)
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")
    
    # Save file
    file_path = DATA_DIR / file.filename
    with open(file_path, "wb") as f:
        f.write(content)
    
    return {"message": "BOM uploaded", "filename": file.filename}


@app.post("/process/bom")
def process_bom(filename: str):
    """Process BOM PDF and generate checklist"""
    
    file_path = DATA_DIR / filename
    
    if not file_path.exists():
        raise HTTPException(404, f"BOM file '{filename}' not found")
    
    try:
        # Parse BOM for checklist
        bom_items = parse_bom_pdf(file_path)
        checklist = generate_checklist(bom_items)
        
        # Save checklist
        with open(DATA_DIR / "checklist.json", "w") as f:
            json.dump(checklist, f, indent=2)
        
        # Parse full BOM details
        full_bom = parse_full_bom(file_path)
        
        # Save full BOM
        with open(DATA_DIR / "bom_full.json", "w") as f:
            json.dump(full_bom, f, indent=2)
        
        return checklist
    
    except Exception as e:
        raise HTTPException(500, f"Error processing BOM: {str(e)}")


@app.get("/bom/details/{find_number}")
def get_bom_details(find_number: str):
    """Get detailed information for a specific FIND NUMBER"""
    
    bom_file = DATA_DIR / "bom_full.json"
    
    if not bom_file.exists():
        return {}
    
    try:
        with open(bom_file) as f:
            bom = json.load(f)
        
        key = str(find_number).strip()
        return bom.get(key, {})
    
    except Exception as e:
        raise HTTPException(500, f"Error reading BOM details: {str(e)}")


# ===============================
# GA ENDPOINTS
# ===============================
@app.post("/upload/ga")
async def upload_ga(file: UploadFile = File(...)):
    """Upload GA PDF and start processing in background"""
    
    # Validate file type
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "Only PDF files allowed")
    
    # Save file
    filename = save_ga(file)
    ga_path = BASE_DIR / "ga" / filename
    
    # Create job ID
    job_id = str(uuid.uuid4())
    
    # Initialize job status
    processing_jobs[job_id] = {
        "status": "queued",
        "filename": filename,
        "progress": 0,
        "message": "Starting processing...",
        "detections": 0
    }
    
    # Start processing in background
    asyncio.create_task(process_ga_background(str(ga_path), job_id, filename))
    
    return {
        "message": "GA upload started",
        "job_id": job_id,
        "filename": filename
    }


async def process_ga_background(pdf_path: str, job_id: str, filename: str = None):
    """Process GA PDF in background with status updates"""
    
    try:
        from ga_pipeline import process_ga_pdf
        
        # Update status: Starting
        processing_jobs[job_id].update({
            "status": "processing",
            "progress": 5,
            "message": "Initializing models..."
        })
        
        # Process GA (this takes time!)
        results = process_ga_pdf(
            pdf_path=pdf_path,
            job_id=job_id,
            processing_jobs=processing_jobs  # Pass reference for updates
        )
        
        # Save results
        balloon_file = DATA_DIR / "balloon_results.json"
        with open(balloon_file, "w") as f:
            json.dump(results, f, indent=2)
        
        # Update status: Complete
        processing_jobs[job_id].update({
            "status": "complete",
            "progress": 100,
            "message": f"Processing complete! Found {len(results)} balloons.",
            "detections": len(results),
            "filename": filename  # ✅ ADD THIS LINE
        })
    
    except Exception as e:
        # Update status: Error
        processing_jobs[job_id].update({
            "status": "error",
            "progress": 0,
            "message": f"Error: {str(e)}",
            "error": str(e)
        })


@app.get("/job/status/{job_id}")
def get_job_status(job_id: str):
    """Get processing job status (for polling)"""
    
    if job_id not in processing_jobs:
        return {"status": "not_found"}
    
    return processing_jobs[job_id]


@app.get("/balloon_results")
def get_balloon_results():
    """Get balloon detection results"""
    
    balloon_file = DATA_DIR / "balloon_results.json"
    
    if not balloon_file.exists():
        return []
    
    try:
        with open(balloon_file) as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(500, f"Error reading balloon results: {str(e)}")


@app.get("/ga/{filename}")
def get_ga(filename: str):
    """Serve GA PDF file"""
    
    # Prevent path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    
    ga_file = BASE_DIR / "ga" / filename
    
    if not ga_file.exists():
        raise HTTPException(404, "GA file not found")
    
    return FileResponse(ga_file)


@app.get("/ga_image/{image_filename}")
def get_ga_image(image_filename: str):
    """Serve GA page images"""
    
    # Prevent path traversal
    if ".." in image_filename or "/" in image_filename or "\\" in image_filename:
        raise HTTPException(400, "Invalid filename")
    
    # Images are stored in ga_images/ directory
    image_file = BASE_DIR / "ga_images" / image_filename
    
    if not image_file.exists():
        raise HTTPException(404, "Image not found")
    
    return FileResponse(image_file, media_type="image/jpeg")


@app.get("/ga_pages")
def get_ga_pages():
    """Get list of available GA page images"""
    
    ga_images_dir = BASE_DIR / "ga_images"
    
    if not ga_images_dir.exists():
        return {"pages": 0, "images": []}
    
    # Get all page images sorted by page number
    images = sorted([f.name for f in ga_images_dir.glob("page_*.jpg")])
    
    return {
        "pages": len(images),
        "images": images
    }


# ===============================
# RUN SERVER
# ===============================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)