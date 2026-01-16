"""
Complete Debug Script for GA Coordinate Issues
Run this to get ALL information needed to fix highlighting
"""

import json
from pathlib import Path
from pdf2image import convert_from_path
from PIL import Image
import cv2
import numpy as np

# ===============================
# CONFIGURATION
# ===============================
GA_PDF = input("Enter path to GA PDF (or press Enter for default): ").strip()
if not GA_PDF:
    GA_PDF = "ga/CCTV_GA.pdf"

BALLOON_JSON = "data/balloon_results.json"
OUTPUT_DIR = "debug_output"

Path(OUTPUT_DIR).mkdir(exist_ok=True)

print("\n" + "="*70)
print("🔍 COMPREHENSIVE GA COORDINATE DEBUG TOOL")
print("="*70 + "\n")

# ===============================
# STEP 1: PDF ANALYSIS
# ===============================
print("📄 STEP 1: Analyzing PDF...")
print("-" * 70)

try:
    # Convert at 300 DPI (same as processing)
    pages = convert_from_path(GA_PDF, dpi=300)
    total_pages = len(pages)
    print(f"✅ PDF loaded: {total_pages} pages")
except Exception as e:
    print(f"❌ Error loading PDF: {e}")
    exit(1)

# ===============================
# STEP 2: PAGE-BY-PAGE ANALYSIS
# ===============================
page_info = []

for page_no, page in enumerate(pages, start=1):
    print(f"\n📄 PAGE {page_no}:")
    print("-" * 70)
    
    # PIL Image Info
    pil_width, pil_height = page.size
    pil_mode = page.mode
    print(f"   PIL Image:")
    print(f"      Size: {pil_width} x {pil_height} pixels")
    print(f"      Mode: {pil_mode}")
    print(f"      Orientation: {'LANDSCAPE' if pil_width > pil_height else 'PORTRAIT'}")
    
    # Save PIL image
    pil_save_path = Path(OUTPUT_DIR) / f"pil_page_{page_no}.jpg"
    page.save(pil_save_path, "JPEG", quality=95)
    print(f"      Saved to: {pil_save_path}")
    
    # Convert to OpenCV
    page_array = np.array(page)
    page_bgr = cv2.cvtColor(page_array, cv2.COLOR_RGB2BGR)
    
    # OpenCV Info
    cv_height, cv_width = page_bgr.shape[:2]
    print(f"\n   OpenCV Image:")
    print(f"      Size: {cv_width} x {cv_height} pixels")
    print(f"      Shape: {page_bgr.shape}")
    print(f"      Orientation: {'LANDSCAPE' if cv_width > cv_height else 'PORTRAIT'}")
    
    # Save OpenCV image
    cv_save_path = Path(OUTPUT_DIR) / f"opencv_page_{page_no}.jpg"
    cv2.imwrite(str(cv_save_path), page_bgr)
    print(f"      Saved to: {cv_save_path}")
    
    # Check if dimensions match
    if pil_width == cv_width and pil_height == cv_height:
        print(f"\n   ✅ PIL and OpenCV dimensions MATCH")
    else:
        print(f"\n   ⚠️  WARNING: Dimension mismatch!")
        print(f"      PIL: {pil_width}x{pil_height}")
        print(f"      OpenCV: {cv_width}x{cv_height}")
    
    page_info.append({
        "page": page_no,
        "pil": {"width": pil_width, "height": pil_height, "mode": pil_mode},
        "opencv": {"width": cv_width, "height": cv_height},
        "match": pil_width == cv_width and pil_height == cv_height
    })

# ===============================
# STEP 3: BALLOON JSON ANALYSIS
# ===============================
print("\n\n📊 STEP 3: Analyzing Balloon Results...")
print("-" * 70)

if not Path(BALLOON_JSON).exists():
    print(f"❌ Balloon JSON not found: {BALLOON_JSON}")
    print("   Please process GA first!")
else:
    with open(BALLOON_JSON) as f:
        balloons = json.load(f)
    
    print(f"✅ Found {len(balloons)} balloons\n")
    
    for balloon in balloons:
        page_no = balloon["page"]
        find_no = balloon["balloon_number"]
        bbox = balloon["bbox"]
        
        # Get corresponding page info
        page_data = page_info[page_no - 1]
        img_width = page_data["opencv"]["width"]
        img_height = page_data["opencv"]["height"]
        
        print(f"   Balloon {find_no} (Page {page_no}):")
        print(f"      BBox: ({bbox['x1']}, {bbox['y1']}) → ({bbox['x2']}, {bbox['y2']})")
        print(f"      Size: {bbox['x2'] - bbox['x1']} x {bbox['y2'] - bbox['y1']} pixels")
        print(f"      Center: ({(bbox['x1'] + bbox['x2'])//2}, {(bbox['y1'] + bbox['y2'])//2})")
        
        # Check if coordinates are within bounds
        if bbox['x1'] < 0 or bbox['y1'] < 0:
            print(f"      ⚠️  WARNING: Negative coordinates!")
        
        if bbox['x2'] > img_width or bbox['y2'] > img_height:
            print(f"      ⚠️  WARNING: Coordinates exceed image bounds!")
            print(f"         Image size: {img_width} x {img_height}")
        
        # Calculate position percentages
        x_percent = ((bbox['x1'] + bbox['x2']) / 2) / img_width * 100
        y_percent = ((bbox['y1'] + bbox['y2']) / 2) / img_height * 100
        
        print(f"      Position: {x_percent:.1f}% from left, {y_percent:.1f}% from top")
        
        # Determine quadrant
        quadrant = ""
        if x_percent < 50 and y_percent < 50:
            quadrant = "TOP-LEFT"
        elif x_percent >= 50 and y_percent < 50:
            quadrant = "TOP-RIGHT"
        elif x_percent < 50 and y_percent >= 50:
            quadrant = "BOTTOM-LEFT"
        else:
            quadrant = "BOTTOM-RIGHT"
        print(f"      Quadrant: {quadrant}")
        print()

# ===============================
# STEP 4: VISUAL DEBUG IMAGES
# ===============================
print("\n📸 STEP 4: Creating Visual Debug Images...")
print("-" * 70)

if Path(BALLOON_JSON).exists():
    with open(BALLOON_JSON) as f:
        balloons = json.load(f)
    
    for page_no in range(1, total_pages + 1):
        # Load OpenCV image
        cv_path = Path(OUTPUT_DIR) / f"opencv_page_{page_no}.jpg"
        img = cv2.imread(str(cv_path))
        
        if img is None:
            continue
        
        # Draw all balloons on this page
        page_balloons = [b for b in balloons if b["page"] == page_no]
        
        for balloon in page_balloons:
            bbox = balloon["bbox"]
            find_no = balloon["balloon_number"]
            
            # Draw rectangle
            cv2.rectangle(
                img,
                (bbox['x1'], bbox['y1']),
                (bbox['x2'], bbox['y2']),
                (0, 0, 255),  # Red
                3
            )
            
            # Draw label
            cv2.putText(
                img,
                f"FIND {find_no}",
                (bbox['x1'], max(bbox['y1'] - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                1.5,
                (0, 0, 255),
                3
            )
            
            # Draw center point
            center_x = (bbox['x1'] + bbox['x2']) // 2
            center_y = (bbox['y1'] + bbox['y2']) // 2
            cv2.circle(img, (center_x, center_y), 10, (0, 255, 0), -1)
        
        # Save annotated image
        annotated_path = Path(OUTPUT_DIR) / f"annotated_page_{page_no}.jpg"
        cv2.imwrite(str(annotated_path), img)
        print(f"   ✅ Saved annotated image: {annotated_path}")

# ===============================
# STEP 5: SUMMARY REPORT
# ===============================
print("\n\n📋 STEP 5: Summary Report")
print("=" * 70)

summary = {
    "pdf_path": GA_PDF,
    "total_pages": total_pages,
    "pages": page_info,
    "total_balloons": len(balloons) if Path(BALLOON_JSON).exists() else 0
}

summary_path = Path(OUTPUT_DIR) / "debug_summary.json"
with open(summary_path, "w") as f:
    json.dump(summary, f, indent=2)

print(f"\n✅ Debug complete! All files saved to: {OUTPUT_DIR}/")
print(f"\nGenerated files:")
print(f"   - pil_page_*.jpg (PIL saved images)")
print(f"   - opencv_page_*.jpg (OpenCV processed images)")
print(f"   - annotated_page_*.jpg (Images with bounding boxes drawn)")
print(f"   - debug_summary.json (Complete analysis)")

print("\n" + "=" * 70)
print("📤 PLEASE SHARE:")
print("=" * 70)
print("1. Complete console output (this text)")
print("2. The annotated_page_*.jpg images")
print("3. Screenshot of frontend showing misaligned highlight")
print("4. Console output from browser when clicking an item")
print("=" * 70)

# ===============================
# STEP 6: INTERACTIVE TESTS
# ===============================
print("\n\n🧪 STEP 6: Interactive Coordinate Test")
print("=" * 70)

if Path(BALLOON_JSON).exists():
    print("\nLet's test a specific balloon:")
    print("Available balloons:")
    with open(BALLOON_JSON) as f:
        balloons = json.load(f)
    
    for b in balloons:
        print(f"   - FIND {b['balloon_number']} (Page {b['page']})")
    
    test_find = input("\nEnter FIND NUMBER to test (or press Enter to skip): ").strip()
    
    if test_find:
        test_balloon = next((b for b in balloons if str(b['balloon_number']) == test_find), None)
        
        if test_balloon:
            page_no = test_balloon['page']
            bbox = test_balloon['bbox']
            
            page_data = page_info[page_no - 1]
            img_width = page_data["opencv"]["width"]
            img_height = page_data["opencv"]["height"]
            
            print(f"\n🎯 FIND {test_find} Analysis:")
            print("-" * 70)
            print(f"Page: {page_no}")
            print(f"Image size: {img_width} x {img_height}")
            print(f"BBox: ({bbox['x1']}, {bbox['y1']}) → ({bbox['x2']}, {bbox['y2']})")
            
            # Simulate frontend scaling
            print("\n🖥️  Frontend Scaling Simulation:")
            container_widths = [400, 600, 800, 1000]
            
            for container_width in container_widths:
                scale = container_width / img_width
                container_height = int(img_height * scale)
                
                display_x1 = int(bbox['x1'] * scale)
                display_y1 = int(bbox['y1'] * scale)
                display_x2 = int(bbox['x2'] * scale)
                display_y2 = int(bbox['y2'] * scale)
                
                print(f"\n   Container: {container_width}x{container_height}")
                print(f"      Scale: {scale:.4f}")
                print(f"      Display bbox: ({display_x1}, {display_y1}) → ({display_x2}, {display_y2})")
                print(f"      Size: {display_x2 - display_x1}x{display_y2 - display_y1} pixels")

print("\n\n✅ Debug script complete!")
print("=" * 70)
