"""
main.py - FastAPI Backend with Process-based GA Pipeline
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
import shutil
import json
import uuid
from typing import Dict
import multiprocessing
import time

from bom_parser import parse_bom_pdf
from checklist import generate_checklist
from bom_full_parser import parse_full_bom
from ga_handler import save_ga

# ===============================
# MULTIPROCESSING SETUP
# ===============================
if __name__ != "__main__":
    multiprocessing.set_start_method('spawn', force=True)

# ===============================
# APP INITIALIZATION
# ===============================
app = FastAPI()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)

# Track processing jobs with process objects
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
# GA CLEANUP FUNCTION
# ===============================
def clear_ga_data():
    """Clear all previous GA processing data"""
    try:
        ga_images_dir = BASE_DIR / "ga_images"
        if ga_images_dir.exists():
            shutil.rmtree(ga_images_dir)
            print(f"✅ Cleared GA images directory")
        ga_images_dir.mkdir(parents=True, exist_ok=True)
        
        balloon_file = DATA_DIR / "balloon_results.json"
        if balloon_file.exists():
            balloon_file.unlink()
            print(f"✅ Deleted balloon results")
        
        ga_dir = BASE_DIR / "ga"
        if ga_dir.exists():
            for pdf_file in ga_dir.glob("*.pdf"):
                pdf_file.unlink()
                print(f"✅ Deleted old GA PDF: {pdf_file.name}")
        
        return True
    except Exception as e:
        print(f"❌ Error clearing GA data: {e}")
        return False

# ===============================
# PROCESS WORKER FUNCTION
# ===============================
def process_ga_worker(pdf_path: str, job_id: str, data_dir: Path):
    """Worker function that runs in separate process"""
    try:
        from ga_pipeline import process_ga_pdf
        
        print(f"🚀 Worker process started for job {job_id}")
        
        results = process_ga_pdf(
            pdf_path=pdf_path,
            dpi=300,
            job_id=None,
            processing_jobs=None
        )
        
        # Save results
        balloon_file = data_dir / "balloon_results.json"
        with open(balloon_file, "w") as f:
            json.dump(results, f, indent=2)
        
        # Write completion marker
        status_file = data_dir / f"job_{job_id}_status.json"
        with open(status_file, "w") as f:
            json.dump({
                "status": "complete",
                "detections": len(results)
            }, f)
        
        print(f"✅ Worker completed job {job_id}")
        
    except Exception as e:
        print(f"❌ Worker error: {e}")
        status_file = data_dir / f"job_{job_id}_status.json"
        with open(status_file, "w") as f:
            json.dump({
                "status": "error",
                "error": str(e)
            }, f)

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
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files allowed")
    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(400, "File too large (max 10MB)")
    file_path = DATA_DIR / file.filename
    with open(file_path, "wb") as f:
        f.write(content)
    return {"message": "BOM uploaded", "filename": file.filename}

@app.post("/process/bom")
def process_bom(filename: str):
    file_path = DATA_DIR / filename
    if not file_path.exists():
        raise HTTPException(404, f"BOM file '{filename}' not found")
    try:
        bom_items = parse_bom_pdf(file_path)
        checklist = generate_checklist(bom_items)
        with open(DATA_DIR / "checklist.json", "w") as f:
            json.dump(checklist, f, indent=2)
        full_bom = parse_full_bom(file_path)
        with open(DATA_DIR / "bom_full.json", "w") as f:
            json.dump(full_bom, f, indent=2)
        return checklist
    except Exception as e:
        raise HTTPException(500, f"Error processing BOM: {str(e)}")

@app.get("/bom/details/{find_number}")
def get_bom_details(find_number: str):
    bom_file = DATA_DIR / "bom_full.json"
    if not bom_file.exists():
        return {}
    try:
        with open(bom_file) as f:
            bom = json.load(f)
        return bom.get(str(find_number).strip(), {})
    except Exception as e:
        raise HTTPException(500, f"Error reading BOM details: {str(e)}")

# ===============================
# GA ENDPOINTS WITH PROCESS MANAGEMENT
# ===============================
@app.post("/upload/ga")
async def upload_ga(file: UploadFile = File(...)):
    """Upload GA PDF and start processing in separate process"""
    
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(400, "Only PDF files allowed")
    
    # Clear old data
    clear_ga_data()
    
    # Kill any existing processes
    for jid, job in list(processing_jobs.items()):
        if "process" in job and job["process"].is_alive():
            print(f"⛔ Terminating old process {jid}")
            job["process"].terminate()
            job["process"].join(timeout=2)
            if job["process"].is_alive():
                job["process"].kill()
        del processing_jobs[jid]
    
    # Save new file
    filename = save_ga(file)
    ga_path = BASE_DIR / "ga" / filename
    
    job_id = str(uuid.uuid4())
    
    # Start new process
    process = multiprocessing.Process(
        target=process_ga_worker,
        args=(str(ga_path), job_id, DATA_DIR)
    )
    process.start()
    
    processing_jobs[job_id] = {
        "process": process,
        "status": "running",
        "start_time": time.time(),
        "filename": filename
    }
    
    print(f"🚀 Started process for job {job_id} (PID: {process.pid})")
    
    return {
        "message": "GA upload started",
        "job_id": job_id,
        "filename": filename
    }

@app.get("/job/status/{job_id}")
def get_job_status(job_id: str):
    """Get processing job status"""
    
    if job_id not in processing_jobs:
        return {"status": "not_found"}
    
    job = processing_jobs[job_id]
    process = job["process"]
    
    # Check if process is still running
    if process.is_alive():
        elapsed = time.time() - job["start_time"]
        progress = min(90, int((elapsed / 20) * 100))
        return {
            "status": "processing",
            "progress": progress,
            "message": "Processing GA..."
        }
    
    # Check for completion marker
    status_file = DATA_DIR / f"job_{job_id}_status.json"
    if status_file.exists():
        with open(status_file) as f:
            result = json.load(f)
        status_file.unlink()
        return {
            "status": result.get("status", "complete"),
            "progress": 100,
            "message": f"Found {result.get('detections', 0)} balloons" if result.get("status") == "complete" else result.get("error", ""),
            "detections": result.get("detections", 0)
        }
    
    return {
        "status": "complete",
        "progress": 100,
        "message": "Processing complete"
    }

@app.post("/job/cancel/{job_id}")
def cancel_job(job_id: str):
    """Forcefully terminate processing job"""
    
    if job_id not in processing_jobs:
        return {"status": "not_found"}
    
    job = processing_jobs[job_id]
    process = job["process"]
    
    if process.is_alive():
        print(f"⛔ Terminating process {job_id} (PID: {process.pid})")
        process.terminate()
        process.join(timeout=2)
        
        if process.is_alive():
            print(f"⛔ Force killing process {job_id}")
            process.kill()
            process.join()
        
        print(f"✅ Process {job_id} terminated")
    
    del processing_jobs[job_id]
    return {"status": "cancelled"}

@app.get("/job/cancel/{job_id}")
def cancel_job_get(job_id: str):
    """Cancel via GET for sendBeacon"""
    return cancel_job(job_id)

@app.get("/balloon_results")
def get_balloon_results():
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
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(400, "Invalid filename")
    ga_file = BASE_DIR / "ga" / filename
    if not ga_file.exists():
        raise HTTPException(404, "GA file not found")
    return FileResponse(ga_file)

@app.get("/ga_image/{image_filename}")
def get_ga_image(image_filename: str):
    if ".." in image_filename or "/" in image_filename or "\\" in image_filename:
        raise HTTPException(400, "Invalid filename")
    image_file = BASE_DIR / "ga_images" / image_filename
    if not image_file.exists():
        raise HTTPException(404, "Image not found")
    return FileResponse(image_file, media_type="image/jpeg")

@app.get("/ga_pages")
def get_ga_pages():
    ga_images_dir = BASE_DIR / "ga_images"
    if not ga_images_dir.exists():
        return {"pages": 0, "images": []}
    images = sorted([f.name for f in ga_images_dir.glob("page_*.jpg")])
    return {"pages": len(images), "images": images}

# ===============================
# CLEANUP ON SHUTDOWN
# ===============================
@app.on_event("shutdown")
def shutdown_event():
    """Kill all running processes on shutdown"""
    for job_id, job in processing_jobs.items():
        if "process" in job and job["process"].is_alive():
            print(f"⛔ Killing process {job_id} on shutdown")
            job["process"].kill()

# ===============================
# RUN SERVER
# ===============================
if __name__ == "__main__":
    import uvicorn
    multiprocessing.set_start_method('spawn', force=True)
    uvicorn.run(app, host="0.0.0.0", port=8000)