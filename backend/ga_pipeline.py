"""
ga_pipeline.py - YOLO + Moondream Pipeline for GA Processing
"""

import os
import cv2
import numpy as np
from pdf2image import convert_from_path
from ultralytics import YOLO
from PIL import Image
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer

# ===============================
# CONFIGURATION
# ===============================
# ⚠️ UPDATE THIS PATH to your YOLO model location
YOLO_MODEL_PATH = "/home/imran/myproject/digital-panel-inspection/training_model/runs/detect/ga_find_circle/weights/best.pt"


# Model settings
USE_GPU = torch.cuda.is_available()
DEVICE = "cuda" if USE_GPU else "cpu"

print(f"🖥️  GA Pipeline Device: {DEVICE}")

# ===============================
# LOAD MODELS (ONCE AT STARTUP)
# ===============================
print("🔄 Loading YOLO model...")
yolo_model = YOLO(YOLO_MODEL_PATH)
print("✅ YOLO loaded!")

print(f"🔄 Loading Moondream model on {DEVICE}...")
model_id = "vikhyatk/moondream2"

if USE_GPU:
    vlm_model = AutoModelForCausalLM.from_pretrained(
        model_id, 
        trust_remote_code=True,
        revision="2025-01-09",
        torch_dtype=torch.float16,
        device_map="auto"
    )
else:
    vlm_model = AutoModelForCausalLM.from_pretrained(
        model_id, 
        trust_remote_code=True,
        revision="2025-01-09",
        torch_dtype=torch.float32,
        low_cpu_mem_usage=True
    ).to(DEVICE)

vlm_tokenizer = AutoTokenizer.from_pretrained(model_id, revision="2025-01-09")
print("✅ Moondream loaded!")

# ===============================
# HELPER FUNCTIONS
# ===============================
def predict_number_single(crop_img):
    """
    Extract number from circle crop using Moondream
    
    Args:
        crop_img: OpenCV image (BGR format)
    
    Returns:
        int: Detected number or None if failed
    """
    try:
        # Convert BGR to RGB
        pil_img = Image.fromarray(cv2.cvtColor(crop_img, cv2.COLOR_BGR2RGB))
        
        # Simple prompt works best
        prompt = "Number in circle:"
        
        # Encode and predict
        enc_image = vlm_model.encode_image(pil_img)
        answer = vlm_model.answer_question(enc_image, prompt, vlm_tokenizer)
        
        # Extract digits only
        number = int(''.join(filter(str.isdigit, answer)))
        return number
    
    except Exception as e:
        print(f"      ⚠️  Error reading number: {e}")
        return None


# ===============================
# MAIN PIPELINE
# ===============================
def process_ga_pdf(pdf_path: str, dpi: int = 300, job_id: str = None, processing_jobs: dict = None):
    """
    Process GA PDF and extract balloon numbers with locations
    Also saves page images for viewing
    
    Args:
        pdf_path: Path to GA PDF file
        dpi: Resolution for PDF conversion (default 300)
        job_id: Job ID for status updates
        processing_jobs: Dictionary to update job status
    
    Returns:
        List of detections: [{"page": int, "balloon_number": int, "bbox": {...}}]
    """
    
    def update_status(progress, message):
        """Helper to update job status"""
        if job_id and processing_jobs:
            processing_jobs[job_id].update({
                "progress": progress,
                "message": message
            })
    
    print(f"\n{'='*50}")
    print(f"🔄 Processing GA: {pdf_path}")
    print(f"{'='*50}\n")
    
    # Create output directory for images
    from pathlib import Path
    output_dir = Path(pdf_path).parent.parent / "ga_images"
    output_dir.mkdir(exist_ok=True)
    print(f"📁 Images will be saved to: {output_dir}")
    
    # Stage 1: Convert PDF to images
    update_status(10, "Converting PDF to images...")
    print(f"🔄 Converting PDF at {dpi} DPI...")
    
    try:
        pages = convert_from_path(pdf_path, dpi=dpi)
    except Exception as e:
        print(f"❌ Error converting PDF: {e}")
        raise
    
    total_pages = len(pages)
    print(f"✅ Converted {total_pages} pages\n")
    
    update_status(20, f"Converted {total_pages} pages. Starting detection...")
    
    results = []
    total_circles = 0
    
    # Stage 2: Process each page
    for page_no, page in enumerate(pages, start=1):
        print(f"📄 Page {page_no}/{total_pages}")
        
        # Get original PIL image dimensions
        original_width, original_height = page.size
        print(f"   📐 Original PIL size: {original_width}x{original_height}")
        
        # ✅ SAVE PAGE IMAGE for viewing (in original orientation)
        image_filename = f"page_{page_no}.jpg"
        image_path = output_dir / image_filename
        page.save(image_path, "JPEG", quality=95)
        print(f"   💾 Saved image: {image_filename}")
        
        # Convert PIL to OpenCV format
        page_img = cv2.cvtColor(np.array(page), cv2.COLOR_RGB2BGR)
        
        # Get OpenCV image dimensions
        img_height, img_width = page_img.shape[:2]
        print(f"   📐 OpenCV size: {img_width}x{img_height} pixels")
        
        # Check if dimensions match
        if img_width != original_width or img_height != original_height:
            print(f"   ⚠️  WARNING: Dimension mismatch! Using OpenCV dimensions.")
        
        # YOLO detection
        print(f"   🎯 Running YOLO detection...")
        detections = yolo_model(page_img)[0]
        num_circles = len(detections.boxes)
        total_circles += num_circles
        
        print(f"   ✅ Found {num_circles} circles")
        
        # Update progress
        page_progress = 20 + (page_no / total_pages * 30)
        update_status(
            page_progress,
            f"Page {page_no}/{total_pages}: Found {num_circles} balloons"
        )
        
        if num_circles == 0:
            print()
            continue
        
        # Process each detected circle
        print(f"   🔍 Reading numbers with Moondream...")
        
        for circle_idx, box in enumerate(detections.boxes, 1):
            # Get bounding box coordinates
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            
            # Crop circle region
            crop = page_img[y1:y2, x1:x2]
            
            if crop.size == 0:
                continue
            
            # Read number with Moondream
            balloon_number = predict_number_single(crop)
            
            if balloon_number is None:
                continue
            
            # Store result with page dimensions
            page_width, page_height = page.size  # PIL image size
            
            results.append({
                "page": page_no,
                "balloon_number": balloon_number,
                "bbox": {
                    "x1": x1,
                    "y1": y1,
                    "x2": x2,
                    "y2": y2
                },
                "dpi": dpi,
                "image_width": img_width,   # ✅ THIS LINE
                "image_height": img_height  # ✅ THIS LINE
            })
            
            print(f"      ✅ Balloon {balloon_number} at ({x1}, {y1})")
            
            # Update progress for each balloon
            circle_progress = page_progress + (circle_idx / num_circles * (30 / total_pages))
            update_status(
                circle_progress,
                f"Page {page_no}/{total_pages}: Reading balloon {circle_idx}/{num_circles}"
            )
        
        print()
    
    # Stage 3: Complete
    print(f"{'='*50}")
    print(f"✅ PROCESSING COMPLETE!")
    print(f"{'='*50}")
    print(f"📊 Total pages processed: {total_pages}")
    print(f"🎯 Total circles detected: {total_circles}")
    print(f"✅ Total balloons recognized: {len(results)}")
    print(f"{'='*50}\n")
    
    update_status(95, "Saving results...")
    
    return results


# ===============================
# STANDALONE TESTING
# ===============================
if __name__ == "__main__":
    """
    Run this file directly to test the pipeline:
    python ga_pipeline.py
    """
    
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python ga_pipeline.py <path_to_ga.pdf>")
        sys.exit(1)
    
    test_pdf = sys.argv[1]
    
    if not os.path.exists(test_pdf):
        print(f"❌ File not found: {test_pdf}")
        sys.exit(1)
    
    print("🧪 Running standalone test...\n")
    
    results = process_ga_pdf(test_pdf, dpi=300)
    
    # Print results
    print("\n📋 Results:")
    for r in results:
        print(f"   Page {r['page']}, Balloon {r['balloon_number']}: {r['bbox']}")
    
    # Save to JSON
    import json
    output_file = "test_balloon_results.json"
    with open(output_file, "w") as f:
        json.dump(results, f, indent=2)
    
    print(f"\n💾 Results saved to: {output_file}")