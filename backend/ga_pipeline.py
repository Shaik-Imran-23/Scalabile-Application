"""
ga_pipeline.py - YOLO + Moondream Pipeline for GA Processing
(ENHANCED: Resume capability - save progress after each page)
"""

# ===============================
# IMPORTS
# ===============================
import os
import cv2
import numpy as np
import time
import json
import hashlib
from pathlib import Path
from datetime import datetime

from pdf2image import convert_from_path
from ultralytics import YOLO
from PIL import Image

import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# ===============================
# CONFIGURATION
# ===============================
YOLO_MODEL_PATH = "/home/imran/Bom-Driven-Checklist-with-GA-navigation/training_model/runs/detect/ga_find_circle/weights/best.pt"

MODEL_ID = "vikhyatk/moondream2"
MODEL_REVISION = "2025-01-09"

USE_GPU = torch.cuda.is_available()
DEVICE = torch.device("cuda" if USE_GPU else "cpu")

print(f"🖥️  GA Pipeline running on: {DEVICE}")

# ===============================
# LOAD MODELS (ONCE PER PROCESS)
# ===============================
print("🔄 Loading YOLO model...")
yolo_model = YOLO(YOLO_MODEL_PATH)
print("✅ YOLO model loaded")

print(f"🔄 Loading Moondream model on {DEVICE}...")

if USE_GPU:
    vlm_model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        revision=MODEL_REVISION,
        torch_dtype=torch.float16,
    ).to(DEVICE)
else:
    vlm_model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID,
        trust_remote_code=True,
        revision=MODEL_REVISION,
        torch_dtype=torch.float32,
        low_cpu_mem_usage=True,
    ).to(DEVICE)

vlm_tokenizer = AutoTokenizer.from_pretrained(
    MODEL_ID,
    revision=MODEL_REVISION
)

vlm_model.eval()

print("✅ Moondream model loaded")
print(f"   ↳ Model device: {next(vlm_model.parameters()).device}")

# ===============================
# HELPER: READ NUMBER FROM CIRCLE
# ===============================
def predict_number_single(crop_img, is_cancelled_func=None):
    """
    Extract number from a cropped balloon using Moondream.
    Returns int or None.
    """
    try:
        if crop_img is None or crop_img.size == 0:
            return None

        if is_cancelled_func and is_cancelled_func():
            return None

        # Convert to PIL
        pil_img = Image.fromarray(
            cv2.cvtColor(crop_img, cv2.COLOR_BGR2RGB)
        )

        prompt = "Number in circle:"

        # Encode image
        enc_image = vlm_model.encode_image(pil_img)

        if is_cancelled_func and is_cancelled_func():
            return None

        # Ask VLM
        answer = vlm_model.answer_question(
            enc_image,
            prompt,
            vlm_tokenizer
        )

        # Extract digits only
        digits = "".join(filter(str.isdigit, answer))
        if not digits:
            return None

        return int(digits)

    except Exception:
        # Silent fail on individual balloons
        if is_cancelled_func and is_cancelled_func():
            return None
        return None


# ===============================
# ✅ NEW: RESUME HELPERS
# ===============================
def calculate_file_hash(pdf_path: Path) -> str:
    """Calculate MD5 hash of PDF file for identification."""
    hash_md5 = hashlib.md5()
    with open(pdf_path, "rb") as f:
        for chunk in iter(lambda: f.read(4096), b""):
            hash_md5.update(chunk)
    return hash_md5.hexdigest()


def load_resume_state(session_base: Path, file_hash: str):
    """
    Load resume state if processing was interrupted.
    Returns: (start_page, existing_results, total_pages) or (1, [], None)
    """
    progress_file = session_base / f"ga_progress_{file_hash}.json"
    partial_results_file = session_base / f"balloon_results_partial_{file_hash}.json"
    
    if not progress_file.exists() or not partial_results_file.exists():
        return 1, [], None
    
    try:
        with open(progress_file, 'r') as f:
            progress = json.load(f)
        
        # Don't resume if already completed
        if progress.get("completed"):
            return 1, [], None
        
        with open(partial_results_file, 'r') as f:
            existing_results = json.load(f)
        
        start_page = progress['last_page'] + 1
        total_pages = progress['total_pages']
        
        print(f"\n{'='*60}")
        print(f"▶️ RESUMING FROM CHECKPOINT")
        print(f"   File hash: {file_hash[:16]}...")
        print(f"   Resuming from page: {start_page}/{total_pages}")
        print(f"   Existing balloons: {len(existing_results)}")
        print(f"   Last update: {progress.get('last_update', 'Unknown')}")
        print(f"{'='*60}\n")
        
        return start_page, existing_results, total_pages
        
    except Exception as e:
        print(f"⚠️ Error loading resume state: {e}")
        return 1, [], None


def save_checkpoint(session_base: Path, file_hash: str, page_num: int, 
                   total_pages: int, results: list):
    """
    Save progress checkpoint after processing a page.
    """
    progress_file = session_base / f"ga_progress_{file_hash}.json"
    partial_results_file = session_base / f"balloon_results_partial_{file_hash}.json"
    
    # Save progress metadata
    progress_data = {
        "file_hash": file_hash,
        "total_pages": total_pages,
        "processed_pages": page_num,
        "last_page": page_num,
        "balloons_so_far": len(results),
        "status": "in_progress",
        "last_update": str(datetime.now()),
        "completed": False
    }
    
    with open(progress_file, 'w') as f:
        json.dump(progress_data, f, indent=2)
    
    # Save partial results
    with open(partial_results_file, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"💾 Checkpoint saved: {page_num}/{total_pages} pages, {len(results)} balloons")


def mark_complete(session_base: Path, file_hash: str):
    """
    Mark processing as complete and clean up partial files.
    """
    progress_file = session_base / f"ga_progress_{file_hash}.json"
    partial_results_file = session_base / f"balloon_results_partial_{file_hash}.json"
    
    # Mark progress as complete
    if progress_file.exists():
        try:
            with open(progress_file, 'r') as f:
                progress_data = json.load(f)
            
            progress_data["completed"] = True
            progress_data["status"] = "complete"
            progress_data["completed_at"] = str(datetime.now())
            
            with open(progress_file, 'w') as f:
                json.dump(progress_data, f, indent=2)
        except:
            pass
    
    # Note: We keep the partial results file until cache is saved
    # It will be cleaned up by the main.py after caching


# ===============================
# MAIN GA PIPELINE (ENHANCED WITH RESUME)
# ===============================
def process_ga_pdf(
    pdf_path: str,
    dpi: int = 300,
    status_file: Path = None,
    is_cancelled_func=None
):
    """
    Process GA PDF and extract balloon numbers + bounding boxes.
    Progress scale: 0 → 100
    
    ✅ ENHANCED: Now supports resume from interruption
    - Saves checkpoint after each page
    - Resumes from last completed page if interrupted
    - Merges previous results with new results
    
    Args:
        pdf_path: Path to the GA PDF
        dpi: Resolution for PDF to image conversion
        status_file: Path to JSON file for progress updates
        is_cancelled_func: Function that returns True if processing should stop
    """

    pdf_path = Path(pdf_path)
    session_base = pdf_path.parent.parent
    ga_images_dir = session_base / "ga_images"
    ga_images_dir.mkdir(exist_ok=True)

    # ✅ Calculate file hash for resume identification
    file_hash = calculate_file_hash(pdf_path)
    
    # ✅ Check for resume state
    start_page, results, total_pages_from_resume = load_resume_state(session_base, file_hash)
    
    # Track if we're resuming
    is_resuming = start_page > 1

    # -------------------------------
    # Progress updater (writes to file)
    # -------------------------------
    def update_status(progress, message):
        """Update progress status to JSON file"""
        if status_file:
            try:
                with open(status_file, 'w') as f:
                    json.dump({
                        'status': 'processing',
                        'progress': int(min(progress, 99)),  # Cap at 99 during processing
                        'message': message
                    }, f)
                print(f"📊 Progress: {int(progress)}% - {message}")
            except Exception as e:
                print(f"⚠️  Failed to update status: {e}")

    if not is_resuming:
        print(f"\n{'='*60}")
        print(f"🔄 GA Processing Started")
        print(f"📄 PDF: {pdf_path}")
        print(f"{'='*60}\n")

    try:
        # ===============================
        # STAGE 1: PDF → IMAGES (Skip if resuming)
        # ===============================
        
        if is_resuming:
            # Check if images already exist
            existing_images = sorted(ga_images_dir.glob("page_*.jpg"))
            total_pages = total_pages_from_resume
            
            if len(existing_images) >= start_page - 1:
                print(f"✅ Using existing images ({len(existing_images)} pages)")
                pages = None  # Will load individual images as needed
            else:
                print(f"⚠️ Missing images, re-converting PDF...")
                update_status(5, "Re-converting PDF to images...")
                pages = convert_from_path(pdf_path, dpi=dpi)
                total_pages = len(pages)
                
                # Save missing images
                for page_index, page in enumerate(pages, start=1):
                    image_name = f"page_{page_index}.jpg"
                    image_path = ga_images_dir / image_name
                    if not image_path.exists():
                        page.save(image_path, "JPEG", quality=95)
                
                pages = None  # Clear from memory
        else:
            # Fresh start - convert PDF
            update_status(5, "Converting PDF to images...")
            
            if is_cancelled_func and is_cancelled_func():
                return results
            
            pages = convert_from_path(pdf_path, dpi=dpi)
            total_pages = len(pages)
            
            if total_pages == 0:
                update_status(0, "No pages found in PDF")
                return results
            
            # Save all images
            for page_index, page in enumerate(pages, start=1):
                image_name = f"page_{page_index}.jpg"
                image_path = ga_images_dir / image_name
                page.save(image_path, "JPEG", quality=95)
            
            update_status(10, f"Converted {total_pages} pages")
            pages = None  # Clear from memory

        # ===============================
        # STAGE 2: PAGE LOOP (Start from checkpoint)
        # ===============================
        for page_index in range(start_page, total_pages + 1):

            if is_cancelled_func and is_cancelled_func():
                update_status(0, "Processing cancelled")
                # Save checkpoint before returning
                save_checkpoint(session_base, file_hash, page_index - 1, total_pages, results)
                return results

            # Load page image
            image_name = f"page_{page_index}.jpg"
            image_path = ga_images_dir / image_name
            
            if not image_path.exists():
                print(f"⚠️ Image not found: {image_path}")
                continue
            
            # Load image with OpenCV
            page_img = cv2.imread(str(image_path))
            img_h, img_w = page_img.shape[:2]

            # YOLO detection
            detections = yolo_model(page_img)[0]
            boxes = detections.boxes
            num_boxes = len(boxes)

            # Page-level progress (10 → 50)
            page_progress = 10 + (page_index / total_pages) * 40
            update_status(
                page_progress,
                f"Page {page_index}/{total_pages}: Found {num_boxes} balloons"
            )

            # ===============================
            # STAGE 3: BALLOON LOOP
            # ===============================
            page_balloons = []
            
            for idx, box in enumerate(boxes, start=1):

                if is_cancelled_func and is_cancelled_func():
                    update_status(0, "Processing cancelled")
                    # Save checkpoint before returning
                    save_checkpoint(session_base, file_hash, page_index - 1, total_pages, results)
                    return results

                x1, y1, x2, y2 = map(int, box.xyxy[0])
                crop = page_img[y1:y2, x1:x2]

                balloon_number = predict_number_single(
                    crop,
                    is_cancelled_func=is_cancelled_func
                )

                if balloon_number is None:
                    continue

                balloon_data = {
                    "page": page_index,
                    "balloon_number": balloon_number,
                    "bbox": {
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2
                    },
                    "dpi": dpi,
                    "image_width": img_w,
                    "image_height": img_h
                }
                
                page_balloons.append(balloon_data)
                results.append(balloon_data)

                # Balloon-level progress (50 → 95)
                balloon_progress = (
                    50 +
                    ((page_index - 1) / total_pages) * 45 +
                    (idx / num_boxes) * (45 / total_pages)
                )

                update_status(
                    balloon_progress,
                    f"Page {page_index}/{total_pages}: Reading balloon {idx}/{num_boxes}"
                )
            
            # ✅ SAVE CHECKPOINT AFTER EACH PAGE
            save_checkpoint(session_base, file_hash, page_index, total_pages, results)

        # ===============================
        # COMPLETE
        # ===============================
        update_status(95, f"Processing complete - Found {len(results)} balloons")
        print(f"✅ GA processing finished - {len(results)} balloons detected\n")
        
        # ✅ Mark as complete
        mark_complete(session_base, file_hash)

    except Exception as e:
        import traceback
        print(f"❌ Error in GA processing: {e}")
        traceback.print_exc()
        
        # Save checkpoint on error
        if 'page_index' in locals() and 'total_pages' in locals():
            save_checkpoint(session_base, file_hash, page_index - 1, total_pages, results)
        
        update_status(0, f"Error: {str(e)}")
        raise

    return results


# ===============================
# STANDALONE TESTING
# ===============================
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python ga_pipeline.py <path_to_ga.pdf>")
        sys.exit(1)

    test_pdf = Path(sys.argv[1])

    if not test_pdf.exists():
        print(f"❌ File not found: {test_pdf}")
        sys.exit(1)

    print("🧪 Running standalone GA test...\n")

    # Create temp status file
    status_file = Path("test_ga_status.json")

    results = process_ga_pdf(
        pdf_path=test_pdf,
        dpi=300,
        status_file=status_file
    )

    print("\n📋 Results:")
    for r in results:
        print(
            f"Page {r['page']} | Balloon {r['balloon_number']} "
            f"| BBox {r['bbox']}"
        )

    out_file = "test_balloon_results.json"
    with open(out_file, "w") as f:
        json.dump(results, f, indent=2)

    print(f"\n💾 Results saved to: {out_file}")
    
    if status_file.exists():
        status_file.unlink()