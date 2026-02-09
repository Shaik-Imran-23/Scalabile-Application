"""
main.py - FastAPI Backend with GLOBAL GA Caching (Cross-Session)
"""

# ===============================
# IMPORTS
# ===============================
from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pathlib import Path
import shutil
import json
import uuid
import multiprocessing
from multiprocessing import Process
import time
import atexit
from typing import Dict, Optional
import threading
import hashlib
from datetime import datetime

from bom_parser import parse_bom_pdf
from checklist import generate_checklist
from bom_full_parser import parse_full_bom

# ===============================
# MULTIPROCESSING SETUP
# ===============================
if __name__ != "__main__":
    multiprocessing.set_start_method("spawn", force=True)

# ===============================
# CONSTANTS
# ===============================
MAX_GA_SIZE = 50 * 1024 * 1024  # 50MB

# ===============================
# BASE DIRECTORIES
# ===============================
BASE_DIR = Path(__file__).parent
BASE_DATA_DIR = BASE_DIR / "data"
BASE_DATA_DIR.mkdir(exist_ok=True)

SESSIONS_DIR = BASE_DATA_DIR / "sessions"
SESSIONS_DIR.mkdir(exist_ok=True)

# ✅ NEW: Global cache directory (shared across all sessions)
GLOBAL_CACHE_DIR = BASE_DATA_DIR / "ga_cache"
GLOBAL_CACHE_DIR.mkdir(exist_ok=True)

# ===============================
# FASTAPI APP
# ===============================
app = FastAPI()

# ===============================
# GLOBAL SHARED STATE
# ===============================
processing_jobs: Dict[str, Dict[str, dict]] = {}
processing_lock = threading.Lock()

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
# SESSION HELPERS
# ===============================
def get_session_id(request: Request, required: bool = True, query_param: Optional[str] = None) -> str:
    """Get session ID from header or query parameter."""
    session_id = query_param or request.headers.get("X-Session-ID")
    if not session_id and required:
        raise HTTPException(
            status_code=400, 
            detail="Missing X-Session-ID header or session_id parameter"
        )
    return session_id


def get_session_base(session_id: str) -> Path:
    """Get session base directory."""
    base = SESSIONS_DIR / session_id
    base.mkdir(parents=True, exist_ok=True)
    (base / "ga").mkdir(exist_ok=True)
    (base / "ga_images").mkdir(exist_ok=True)
    (base / "ga_status").mkdir(exist_ok=True)
    return base


def ensure_ga_dir(session_base: Path) -> Path:
    """Ensure GA directory exists."""
    ga_dir = session_base / "ga"
    ga_dir.mkdir(exist_ok=True)
    return ga_dir


def save_ga_from_bytes(session_base: Path, filename: str, content: bytes) -> str:
    """Save GA PDF from bytes."""
    ga_dir = ensure_ga_dir(session_base)
    ga_path = ga_dir / filename
    with open(ga_path, "wb") as f:
        f.write(content)
    return filename

# ===============================
# CLEAR GA DATA
# ===============================
def clear_ga_data(session_base: Path):
    try:
        shutil.rmtree(session_base / "ga_images", ignore_errors=True)
        (session_base / "ga_images").mkdir(exist_ok=True)

        ga_dir = session_base / "ga"
        if ga_dir.exists():
            for f in ga_dir.glob("*.pdf"):
                f.unlink()

        status_dir = session_base / "ga_status"
        if status_dir.exists():
            for f in status_dir.glob("*.json"):
                f.unlink()

        br = session_base / "balloon_results.json"
        if br.exists():
            br.unlink()

        return True
    except Exception as e:
        print("❌ clear_ga_data error:", e)
        return False

# ===============================
# GLOBAL GA CACHING FUNCTIONS (NEW)
# ===============================
def calculate_file_hash_from_content(content: bytes) -> str:
    """Calculate MD5 hash from file content."""
    hash_result = hashlib.md5(content).hexdigest()
    print(f"🔢 Calculated hash: {hash_result}")
    return hash_result


def get_global_cache_path(file_hash: str) -> Path:
    """Get the global cache directory for a specific file hash."""
    cache_path = GLOBAL_CACHE_DIR / file_hash
    return cache_path


def check_global_cache(file_hash: str) -> dict:
    """
    Check if GA with this hash has been processed before (globally, across all sessions).
    """
    cache_path = get_global_cache_path(file_hash)
    metadata_file = cache_path / "metadata.json"
    
    print(f"🔍 Checking global cache: {cache_path}")
    print(f"   Metadata file exists: {metadata_file.exists()}")
    
    if not metadata_file.exists():
        print(f"ℹ️ No global cache found for hash {file_hash[:8]}...")
        return {"exists": False}
    
    try:
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
        
        print(f"   Cache metadata loaded: {metadata}")
        
        # Check if required files exist
        balloon_file = cache_path / "balloon_results.json"
        images_dir = cache_path / "images"
        
        print(f"   Checking balloon file: {balloon_file} (exists: {balloon_file.exists()})")
        print(f"   Checking images dir: {images_dir} (exists: {images_dir.exists()})")
        
        if balloon_file.exists() and images_dir.exists():
            pages = len(list(images_dir.glob("page_*.jpg")))
            print(f"   Found {pages} page images")
            
            if pages > 0:
                print(f"✅ GLOBAL CACHE HIT! Hash: {file_hash[:8]}... ({pages} pages)")
                return {
                    "exists": True,
                    "pages": pages,
                    "detections": metadata.get("detections", 0),
                    "processed_date": metadata.get("processed_date", ""),
                    "cache_path": cache_path
                }
            else:
                print(f"⚠️ Images directory exists but no images found")
        else:
            print(f"⚠️ Cache metadata exists but files missing")
            
    except Exception as e:
        print(f"⚠️ Cache file read error: {e}")
    
    return {"exists": False}


def save_to_global_cache(file_hash: str, session_base: Path, detections: int):
    """
    Save processed GA results to global cache for reuse across all sessions.
    """
    cache_path = get_global_cache_path(file_hash)
    cache_path.mkdir(parents=True, exist_ok=True)
    
    print(f"\n{'='*60}")
    print(f"💾 SAVING TO GLOBAL CACHE")
    print(f"   Hash: {file_hash}")
    print(f"   Cache path: {cache_path}")
    print(f"   Detections: {detections}")
    
    try:
        # Copy balloon results
        source_balloon = session_base / "balloon_results.json"
        dest_balloon = cache_path / "balloon_results.json"
        if source_balloon.exists():
            shutil.copy2(source_balloon, dest_balloon)
            print(f"   ✅ Copied balloon_results.json")
        
        # Copy images directory
        source_images = session_base / "ga_images"
        dest_images = cache_path / "images"
        if source_images.exists():
            if dest_images.exists():
                shutil.rmtree(dest_images)
            shutil.copytree(source_images, dest_images)
            print(f"   ✅ Copied {len(list(dest_images.glob('*.jpg')))} images")
        
        # Save metadata
        metadata = {
            "file_hash": file_hash,
            "detections": detections,
            "processed_date": str(datetime.now()),
            "pages": len(list(dest_images.glob("page_*.jpg"))) if dest_images.exists() else 0
        }
        
        with open(cache_path / "metadata.json", 'w') as f:
            json.dump(metadata, f, indent=2)
        
        print(f"   ✅ Saved metadata")
        print(f"={'='*60}\n")
        
    except Exception as e:
        print(f"   ❌ Error saving to global cache: {e}")
        import traceback
        traceback.print_exc()


def copy_from_global_cache(file_hash: str, session_base: Path) -> bool:
    """
    Copy cached GA results from global cache to current session.
    """
    cache_path = get_global_cache_path(file_hash)
    
    print(f"\n{'='*60}")
    print(f"📋 COPYING FROM GLOBAL CACHE")
    print(f"   Source: {cache_path}")
    print(f"   Destination: {session_base}")
    
    try:
        # Copy balloon results
        source_balloon = cache_path / "balloon_results.json"
        dest_balloon = session_base / "balloon_results.json"
        if source_balloon.exists():
            shutil.copy2(source_balloon, dest_balloon)
            print(f"   ✅ Copied balloon_results.json")
        else:
            print(f"   ❌ Source balloon_results.json not found")
            return False
        
        # Copy images
        source_images = cache_path / "images"
        dest_images = session_base / "ga_images"
        if source_images.exists():
            # Clear existing images
            if dest_images.exists():
                shutil.rmtree(dest_images)
            dest_images.mkdir(parents=True, exist_ok=True)
            
            # Copy all images
            for img in source_images.glob("page_*.jpg"):
                shutil.copy2(img, dest_images / img.name)
            
            copied_count = len(list(dest_images.glob("page_*.jpg")))
            print(f"   ✅ Copied {copied_count} images")
        else:
            print(f"   ❌ Source images directory not found")
            return False
        
        print(f"{'='*60}\n")
        return True
        
    except Exception as e:
        print(f"   ❌ Error copying from global cache: {e}")
        import traceback
        traceback.print_exc()
        return False

# ===============================
# STARTUP / SHUTDOWN
# ===============================
@app.on_event("startup")
async def startup_event():
    print("✅ FastAPI server initialized with GLOBAL GA caching")
    print(f"📁 Global cache directory: {GLOBAL_CACHE_DIR}")


@app.on_event("shutdown")
def shutdown_event():
    print("🛑 Shutdown started")
    with processing_lock:
        for session_id in list(processing_jobs.keys()):
            for job in processing_jobs[session_id].values():
                p = job.get("process")
                if p and p.is_alive():
                    p.kill()
    print("✅ Shutdown complete")


atexit.register(shutdown_event)

# ===============================
# HEALTH CHECK
# ===============================
@app.get("/")
def health():
    with processing_lock:
        total_jobs = sum(len(v) for v in processing_jobs.values())
        
        # Count cached GAs
        cache_count = len(list(GLOBAL_CACHE_DIR.glob("*")))
        
        return {
            "status": "Panel Inspection Backend Running",
            "active_jobs": total_jobs,
            "sessions": list(processing_jobs.keys()),
            "cached_gas": cache_count
        }

# ===============================
# BOM ENDPOINTS
# ===============================
@app.post("/upload/bom")
async def upload_bom(request: Request, file: UploadFile = File(...)):
    session_id = get_session_id(request)
    session_base = get_session_base(session_id)

    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files allowed")

    content = await file.read()

    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10MB)")

    if not content.startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="Invalid PDF file")

    bom_path = session_base / file.filename
    with open(bom_path, "wb") as f:
        f.write(content)

    return {
        "message": "BOM uploaded successfully",
        "filename": file.filename,
        "session_id": session_id
    }


@app.post("/process/bom")
def process_bom(request: Request, filename: str):
    session_id = get_session_id(request)
    session_base = get_session_base(session_id)

    bom_path = session_base / filename
    if not bom_path.exists():
        raise HTTPException(status_code=404, detail=f"BOM file '{filename}' not found")

    try:
        bom_items = parse_bom_pdf(bom_path)
        checklist = generate_checklist(bom_items)

        with open(session_base / "checklist.json", "w") as f:
            json.dump(checklist, f, indent=2)

        full_bom = parse_full_bom(bom_path)
        with open(session_base / "bom_full.json", "w") as f:
            json.dump(full_bom, f, indent=2)

        return checklist

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing BOM: {str(e)}")


@app.get("/bom/details/{find_number}")
def get_bom_details(request: Request, find_number: str):
    session_id = get_session_id(request)
    session_base = get_session_base(session_id)

    bom_file = session_base / "bom_full.json"
    if not bom_file.exists():
        return {}

    try:
        with open(bom_file, "r") as f:
            full_bom = json.load(f)
        return full_bom.get(str(find_number).strip(), {})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error reading BOM details: {str(e)}")

# ===============================
# GA PROCESS WORKER
# ===============================
def process_ga_worker(
    pdf_path: str,
    session_base: Path,
    status_file: Path,
    results_file: Path,
    file_hash: str = None
):
    """Runs GA processing in a separate OS process."""
    try:
        from ga_pipeline import process_ga_pdf

        print(f"🚀 GA worker started | status_file={status_file}")
        print(f"   File hash: {file_hash}")

        cancelled_flag = [False]
        
        def is_cancelled():
            return cancelled_flag[0]

        results = process_ga_pdf(
            pdf_path=pdf_path,
            dpi=300,
            status_file=status_file,
            is_cancelled_func=is_cancelled
        )

        if status_file.exists():
            try:
                with open(status_file, 'r') as f:
                    status_data = json.load(f)
                    if status_data.get('status') == 'cancelled':
                        print(f"⛔ GA cancelled")
                        return
            except:
                pass

        ga_images_dir = session_base / "ga_images"
        start_time = time.time()

        while True:
            images = list(ga_images_dir.glob("page_*.jpg"))
            if images:
                break
            if time.time() - start_time > 30:
                raise RuntimeError("GA images not generated within timeout")
            time.sleep(0.5)

        with open(results_file, "w") as f:
            json.dump(results, f, indent=2)

        detections = len(results) if isinstance(results, list) else 0

        with open(status_file, 'w') as f:
            json.dump({
                "status": "complete",
                "progress": 100,
                "message": f"Found {detections} balloons",
                "detections": detections
            }, f)

        print(f"✅ GA completed | detections={detections}")

        # 🔥🔥🔥 SAVE TO GLOBAL CACHE IMMEDIATELY 🔥🔥🔥
        if file_hash:
            print(f"\n{'='*60}")
            print(f"🔥 WORKER: SAVING TO GLOBAL CACHE")
            print(f"   Hash: {file_hash}")
            print(f"   Detections: {detections}")
            print(f"={'='*60}")
            
            try:
                save_to_global_cache(file_hash, session_base, detections)
                print(f"✅ WORKER: Global cache saved successfully!")
            except Exception as cache_error:
                print(f"❌ WORKER: Error saving to global cache: {cache_error}")
                import traceback
                traceback.print_exc()
        else:
            print(f"⚠️ WORKER: No file_hash provided, cannot save to global cache")

    except Exception as e:
        import traceback
        traceback.print_exc()

        with open(status_file, 'w') as f:
            json.dump({
                "status": "error",
                "progress": 0,
                "message": str(e),
                "error": str(e)
            }, f)

# ===============================
# GA UPLOAD WITH GLOBAL CACHING
# ===============================
@app.post("/upload/ga")
async def upload_ga(request: Request, file: UploadFile = File(...), force: Optional[str] = Query(None)):
    session_id = get_session_id(request, required=True)
    session_base = get_session_base(session_id)
    
    print(f"\n{'='*60}")
    print(f"📤 GA UPLOAD REQUEST")
    print(f"   Session: {session_id[:8]}...")
    print(f"   File: {file.filename}")
    print(f"   Force: {force}")
    print(f"{'='*60}\n")
    
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(400, "File must be PDF")
    
    content = await file.read()
    if len(content) > MAX_GA_SIZE:
        raise HTTPException(400, f"GA too large (max {MAX_GA_SIZE//1024//1024}MB)")
    
    if not content.startswith(b'%PDF'):
        raise HTTPException(400, "Invalid PDF file")
    
    # Calculate file hash
    file_hash = calculate_file_hash_from_content(content)
    print(f"🔍 File hash: {file_hash}")
    
    # ✅ Check GLOBAL cache (skip if force=true)
    if force != "true":
        print(f"🔍 Checking global cache...")
        cached = check_global_cache(file_hash)
        
        if cached["exists"]:
            print(f"\n{'='*60}")
            print(f"✅ GLOBAL CACHE HIT - Using cached results!")
            print(f"   Pages: {cached['pages']}")
            print(f"   Detections: {cached['detections']}")
            print(f"   Processed: {cached['processed_date']}")
            print(f"={'='*60}\n")
            
            # Copy cached results to current session
            success = copy_from_global_cache(file_hash, session_base)
            
            if success:
                # Save the PDF file for reference
                ga_dir = ensure_ga_dir(session_base)
                ga_path = ga_dir / file.filename
                with open(ga_path, "wb") as f:
                    f.write(content)
                
                return {
                    "status": "cached",
                    "message": "GA already processed globally, using cached results",
                    "session_id": session_id,
                    "pages": cached["pages"],
                    "detections": cached["detections"],
                    "file_hash": file_hash
                }
            else:
                print(f"⚠️ Failed to copy from cache, will reprocess")
        else:
            print(f"ℹ️ No global cache found - will process from scratch")
    else:
        print(f"🔄 Force reprocess requested, bypassing cache")
    
    # Not cached or force reprocess - proceed with normal processing
    print(f"⚙️ Starting GA processing...")
    
    # Kill any existing GA job for this session
    with processing_lock:
        if session_id in processing_jobs:
            for job_id, job_data in list(processing_jobs[session_id].items()):
                proc = job_data["process"]
                if proc.is_alive():
                    print(f"⛔ Killing old GA job: {job_id}")
                    proc.terminate()
                    proc.join(timeout=3)
                    if proc.is_alive():
                        proc.kill()
                del processing_jobs[session_id][job_id]
    
    # Clear session GA data
    clear_ga_data(session_base)
    
    # Save uploaded PDF
    ga_path = save_ga_from_bytes(session_base, file.filename, content)
    ga_full_path = session_base / "ga" / ga_path
    
    # Generate job ID
    job_id = str(uuid.uuid4())
    print(f"🚀 GA started | session={session_id[:8]}... job={job_id[:8]}... file={file.filename}")
    
    # Create status file
    status_dir = session_base / "ga_status"
    status_dir.mkdir(parents=True, exist_ok=True)
    status_file = status_dir / f"{job_id}.json"
    
    with open(status_file, 'w') as f:
        json.dump({
            "status": "queued",
            "progress": 0,
            "message": "Starting GA processing...",
            "file_hash": file_hash
        }, f)
    
    results_file = session_base / "balloon_results.json"
    
    # Spawn worker process
    process = Process(
        target=process_ga_worker,
        args=(
            str(ga_full_path),
            session_base,
            status_file,
            results_file,
            file_hash  # ✅ Pass file_hash to worker
        )
    )
    process.start()
    
    # Track job
    with processing_lock:
        if session_id not in processing_jobs:
            processing_jobs[session_id] = {}
        
        processing_jobs[session_id][job_id] = {
            "process": process,
            "start_time": time.time(),
            "filename": file.filename,
            "file_hash": file_hash,
            "status_file": status_file,
            "results_file": results_file,
            "session_base": session_base  # ✅ Make sure this is set!
        }
        
        print(f"📝 Job tracking info:")
        print(f"   Job ID: {job_id[:8]}...")
        print(f"   File hash: {file_hash}")
        print(f"   Session base: {session_base}")
        print(f"   Results file: {results_file}")
    
    return {
        "job_id": job_id,
        "session_id": session_id,
        "file_hash": file_hash
    }

# ===============================
# CHECK GA CACHE
# ===============================
@app.post("/check_ga_cache")
async def check_ga_cache_endpoint(request: Request, file: UploadFile = File(...)):
    """Check if GA file has been processed before (globally)."""
    session_id = get_session_id(request, required=True)
    
    content = await file.read()
    file_hash = calculate_file_hash_from_content(content)
    
    print(f"\n{'='*60}")
    print(f"🔍 GLOBAL CACHE CHECK REQUEST")
    print(f"   Session: {session_id[:8]}...")
    print(f"   File hash: {file_hash}")
    print(f"={'='*60}")
    
    cached = check_global_cache(file_hash)
    
    if cached["exists"]:
        print(f"✅ Global cache exists!")
        return {
            "cached": True,
            "pages": cached["pages"],
            "detections": cached["detections"],
            "processed_date": cached["processed_date"],
            "message": "This GA has been processed before. Results will load instantly."
        }
    
    print(f"ℹ️ No global cache found")
    return {
        "cached": False,
        "message": "New GA file. Processing will take 1-3 minutes."
    }

# ===============================
# JOB STATUS
# ===============================
@app.get("/job/status/{job_id}")
def get_job_status(request: Request, job_id: str):
    session_id = get_session_id(request, required=True)
    
    with processing_lock:
        if session_id not in processing_jobs or job_id not in processing_jobs[session_id]:
            return {"status": "not_found"}
        
        job = processing_jobs[session_id][job_id]
        process = job["process"]
        status_file = job["status_file"]
        results_file = job["results_file"]
        file_hash = job.get("file_hash")
        session_base = job.get("session_base")
    
    # ✅ Check if process is still running
    if process.is_alive():
        try:
            with open(status_file, 'r') as f:
                status_data = json.load(f)
            return status_data
        except Exception as e:
            return {
                "status": "error",
                "message": f"Failed to read status: {str(e)}"
            }
    
    # ✅ Process has finished - handle completion
    try:
        with open(status_file, 'r') as f:
            status_data = json.load(f)
        
        print(f"\n{'='*60}")
        print(f"📊 JOB STATUS CHECK")
        print(f"   Job ID: {job_id[:8]}...")
        print(f"   Status: {status_data.get('status')}")
        print(f"   File hash: {file_hash}")
        print(f"   Results file exists: {results_file.exists()}")
        print(f"={'='*60}\n")
        
        if status_data["status"] == "complete":
            # ✅ ✅ ✅ SAVE TO GLOBAL CACHE ✅ ✅ ✅
            if file_hash and session_base and results_file.exists():
                try:
                    # Count detections
                    with open(results_file, 'r') as f:
                        results = json.load(f)
                    detections = len(results) if isinstance(results, list) else 0
                    
                    # 🔥 SAVE TO GLOBAL CACHE 🔥
                    print(f"🔥 ATTEMPTING TO SAVE TO GLOBAL CACHE")
                    save_to_global_cache(file_hash, session_base, detections)
                    print(f"✅ Global cache save completed successfully!")
                    
                except Exception as cache_error:
                    print(f"❌ Error saving to global cache: {cache_error}")
                    import traceback
                    traceback.print_exc()
            else:
                print(f"⚠️ Cannot save cache:")
                print(f"   file_hash: {file_hash}")
                print(f"   session_base: {session_base}")
                print(f"   results_file exists: {results_file.exists()}")
            
            # Cleanup job tracking
            with processing_lock:
                if session_id in processing_jobs and job_id in processing_jobs[session_id]:
                    del processing_jobs[session_id][job_id]
                    print(f"✅ Cleaned up job tracking for {job_id[:8]}...")
            
            return status_data
        
        elif status_data["status"] == "cancelled":
            with processing_lock:
                if session_id in processing_jobs and job_id in processing_jobs[session_id]:
                    del processing_jobs[session_id][job_id]
            return status_data
        
        elif status_data["status"] == "error":
            with processing_lock:
                if session_id in processing_jobs and job_id in processing_jobs[session_id]:
                    del processing_jobs[session_id][job_id]
            return status_data
        
        else:
            return status_data
        
    except Exception as e:
        print(f"❌ Error in job status: {e}")
        import traceback
        traceback.print_exc()
        return {
            "status": "error",
            "message": f"Process died: {str(e)}"
        }

# ===============================
# JOB CANCEL
# ===============================
@app.post("/job/cancel/{job_id}")
def cancel_job(request: Request, job_id: str):
    session_id = get_session_id(request)

    with processing_lock:
        job = processing_jobs.get(session_id, {}).get(job_id)
        if not job:
            return {"status": "not_found"}

        process = job["process"]
        status_file = job.get("status_file")

        if status_file:
            try:
                with open(status_file, 'w') as f:
                    json.dump({
                        "status": "cancelled",
                        "progress": 0,
                        "message": "Cancelled by user"
                    }, f)
            except:
                pass

        if process.is_alive():
            process.terminate()
            process.join(timeout=3)
            if process.is_alive():
                process.kill()

        del processing_jobs[session_id][job_id]

        return {"status": "cancelled"}


@app.get("/job/cancel/{job_id}")
def cancel_job_get(request: Request, job_id: str):
    return cancel_job(request, job_id)

# ===============================
# GA RESULTS & VIEWER
# ===============================
@app.get("/balloon_results")
def get_balloon_results(request: Request):
    try:
        session_id = get_session_id(request)
        session_base = get_session_base(session_id)
        f = session_base / "balloon_results.json"
        
        if not f.exists():
            return []
        
        with open(f, 'r') as file:
            results = json.load(file)
            print(f"   ✅ Loaded {len(results)} balloon results")
            return results
            
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error reading balloon results: {e}")
        return []


@app.get("/ga_pages")
def get_ga_pages(request: Request):
    try:
        session_id = get_session_id(request)
        session_base = get_session_base(session_id)
        images = sorted((session_base / "ga_images").glob("page_*.jpg"))
        
        return {
            "pages": len(images),
            "images": [p.name for p in images]
        }
    except Exception as e:
        print(f"❌ Error getting GA pages: {e}")
        raise HTTPException(status_code=500, detail=f"Error getting GA pages: {str(e)}")


@app.get("/ga_image/{image_filename}")
def get_ga_image(
    request: Request, 
    image_filename: str,
    session_id: Optional[str] = Query(None)
):
    """Serve GA image with session support."""
    try:
        sess_id = get_session_id(request, required=True, query_param=session_id)
        session_base = get_session_base(sess_id)
        img = session_base / "ga_images" / Path(image_filename).name
        
        if not img.exists():
            raise HTTPException(status_code=404, detail=f"Image not found: {image_filename}")
        
        return FileResponse(img, media_type="image/jpeg")
    except HTTPException:
        raise
    except Exception as e:
        print(f"❌ Error serving image: {e}")
        raise HTTPException(status_code=500, detail=f"Error serving image: {str(e)}")


@app.get("/ga/{filename}")
def get_ga_pdf(request: Request, filename: str):
    session_base = get_session_base(get_session_id(request))
    ga_file = session_base / "ga" / Path(filename).name
    if not ga_file.exists():
        raise HTTPException(status_code=404, detail="GA file not found")
    return FileResponse(ga_file, media_type="application/pdf")

# ===============================
# RUN SERVER
# ===============================
if __name__ == "__main__":
    import uvicorn
    multiprocessing.set_start_method("spawn", force=True)

    print("🚀 Panel Inspection Backend Starting with GLOBAL GA Caching")
    print(f"📁 Base data dir: {BASE_DATA_DIR}")
    print(f"📁 Global cache dir: {GLOBAL_CACHE_DIR}")

    uvicorn.run(app, host="0.0.0.0", port=8000)