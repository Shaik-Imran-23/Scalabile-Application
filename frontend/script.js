// ============================================================================
// COMPLETE SCRIPT.JS - WITH CACHE + RESUME CAPABILITY
// Production Ready - All Features Integrated
// ============================================================================

const API = "http://localhost:8000";

let checklistData = [];
let balloonMapping = {};

let currentPage = 1;
let totalPages = 0;
let currentScale = 1;
let gaLoaded = false;

let imgW = 0;
let imgH = 0;
let gaPollTimer = null;
let isProcessingCompletion = false;

// Track unsaved changes
let hasUnsavedChanges = false;

// Page zoom levels per page
const pageZoomLevels = {};

// Preloaded logo for PDF export
let companyLogo = null;

/* ================= INITIALIZATION ================= */
window.addEventListener("DOMContentLoaded", () => {
  // Preload logo for PDF export
  const logoImg = new Image();
  logoImg.onload = () => { 
    companyLogo = logoImg;
    console.log("✅ Logo preloaded for PDF export");
  };
  logoImg.onerror = () => {
    console.warn("⚠️ Logo failed to load");
  };
  logoImg.src = 'logo.jpg';

  // Restore backup if available
  restoreChecklistBackup();

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();
});

// ===============================
// SESSION ID (MULTI-USER SUPPORT)
// ===============================
let SESSION_ID = localStorage.getItem("SESSION_ID");

if (!SESSION_ID) {
    SESSION_ID = crypto.randomUUID();
    localStorage.setItem("SESSION_ID", SESSION_ID);
}

console.log("🔑 Session ID:", SESSION_ID);


/* ================= BACKUP & RESTORE ================= */
function saveChecklistBackup() {
  try {
    localStorage.setItem("checklist_backup", JSON.stringify({
      data: checklistData,
      timestamp: Date.now()
    }));
  } catch (e) {
    console.warn("Failed to save backup:", e);
  }
}

function restoreChecklistBackup() {
  try {
    const backup = localStorage.getItem("checklist_backup");
    if (!backup) return;

    const { data, timestamp } = JSON.parse(backup);
    
    // Only restore if less than 1 hour old
    if (Date.now() - timestamp < 3600000) {
      if (confirm("Found a previous session. Would you like to restore it?")) {
        checklistData = data;
        renderChecklist();
        updateStats();
        hasUnsavedChanges = true;
        console.log("✅ Restored previous session");
      } else {
        localStorage.removeItem("checklist_backup");
      }
    } else {
      // Clear old backup
      localStorage.removeItem("checklist_backup");
    }
  } catch (e) {
    console.warn("Failed to restore backup:", e);
    localStorage.removeItem("checklist_backup");
  }
}

function clearChecklistBackup() {
  localStorage.removeItem("checklist_backup");
  hasUnsavedChanges = false;
}

/* ================= KEYBOARD SHORTCUTS ================= */
function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Ctrl/Cmd + E = Export PDF
    if ((e.ctrlKey || e.metaKey) && e.key === "e") {
      e.preventDefault();
      exportChecklistPDF();
    }

    // Arrow keys for GA navigation (only when not typing)
    if (!e.target.matches("input, select, textarea")) {
      if (gaLoaded && document.getElementById("gaImage").src) {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          prevPage();
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          nextPage();
        }
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          zoomIn();
        }
        if (e.key === "-") {
          e.preventDefault();
          zoomOut();
        }
        if (e.key === "f" || e.key === "F") {
          e.preventDefault();
          fitToPage();
        }
      }
    }
  });
}

/* ================= JOB CANCELLATION ON WINDOW CLOSE ================= */
window.addEventListener("beforeunload", (e) => {
  // Cancel active GA job on actual page unload
  const jobId = localStorage.getItem("ga_job_id");
  if (jobId) {
    console.log("🚪 Window closing, cancelling job:", jobId);
    navigator.sendBeacon(
      `${API}/job/cancel/${jobId}`,
      JSON.stringify({ sessionId: SESSION_ID })
    );
    localStorage.removeItem("ga_job_id");
  }

  // Warn about unsaved changes
  if (hasUnsavedChanges) {
    e.preventDefault();
    e.returnValue = "You have unsaved changes. Are you sure you want to leave?";
    return e.returnValue;
  }
});

/* ================= EXPORT CHECKLIST AS PDF ================= */
function exportChecklistPDF() {
  if (!checklistData || checklistData.length === 0) {
    alert("No checklist data to export. Please upload and process BOM first.");
    return;
  }

  // Validate required fields
  const requiredFields = [
    { id: "bomPanelNo", label: "Sr.No" },
    { id: "ddNo", label: "DD No" },
    { id: "inspectorName", label: "Inspector Name" },
    { id: "inspectorSignature", label: "Inspector Signature" }
  ];

  for (const field of requiredFields) {
    const value = document.getElementById(field.id)?.value.trim();
    if (!value) {
      alert(`Please enter ${field.label} before exporting.`);
      document.getElementById(field.id)?.focus();
      return;
    }
  }

  const panelNo = document.getElementById("bomPanelNo").value.trim();
  const ddNo = document.getElementById("ddNo").value.trim();
  const inspectorName = document.getElementById("inspectorName").value.trim();
  const inspectorSignature = document.getElementById("inspectorSignature").value.trim();

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("l", "mm", "a4");
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;

  const today = new Date();
  const dateStr = today.toLocaleDateString();
  const timeStr = today.toLocaleTimeString();

  // Calculate stats
  const okCount = checklistData.filter(i => i.status === "OK").length;
  const ngCount = checklistData.filter(i => i.status === "NOT OK").length;
  const totalCount = checklistData.length;

  // Table data
  const tableData = checklistData.map(i => [
    i["FIND NUMBER"] || "",
    i["PART DESCRIPTION"] || "",
    i.status || "-",
    i.remarks || ""
  ]);

  // ========== CUSTOM HEADER FUNCTION ==========
  function addHeader() {
    doc.setDrawColor(0, 51, 153);
    doc.setLineWidth(2);
    doc.line(10, 8, pageWidth - 10, 8);

    const startY = 11;
    const logoBoxWidth = 60;
    const tableStartX = 10 + logoBoxWidth;
    const rowHeight = 9;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.rect(10, startY, logoBoxWidth, rowHeight * 3);

    const logoWidth = 55;
    const logoHeight = 22;
    const logoX = 10 + (logoBoxWidth - logoWidth) / 2;
    const logoY = startY + (rowHeight * 3 - logoHeight) / 2;
    
    if (companyLogo) {
      try {
        doc.addImage(companyLogo, 'JPEG', logoX, logoY, logoWidth, logoHeight);
      } catch (e) {
        console.warn("Failed to add logo:", e);
        addLogoFallback(doc, logoX, logoY);
      }
    } else {
      addLogoFallback(doc, logoX, logoY);
    }

    const tableWidth = pageWidth - 10 - tableStartX;

    doc.setLineWidth(0.6);
    doc.rect(tableStartX, startY, tableWidth, rowHeight);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Digital Bom-Checklist Report", tableStartX + tableWidth / 2, startY + 6.2, { align: "center" });

    doc.rect(tableStartX, startY + rowHeight, tableWidth, rowHeight);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(panelNo, tableStartX + tableWidth / 2, startY + rowHeight + 6.2, { align: "center" });

    doc.rect(tableStartX, startY + rowHeight * 2, tableWidth, rowHeight);
    doc.text(ddNo, tableStartX + tableWidth / 2, startY + rowHeight * 2 + 6.2, { align: "center" });

    doc.setDrawColor(0, 51, 153);
    doc.setLineWidth(2);
    doc.line(10, startY + rowHeight * 3 + 0.5, pageWidth - 10, startY + rowHeight * 3 + 0.5);
  }

  function addLogoFallback(doc, logoX, logoY) {
    doc.setFontSize(11);
    doc.setTextColor(0, 51, 153);
    doc.setFont("helvetica", "bold");
    doc.text("LARSEN &", logoX + 5, logoY + 10);
    doc.text("TOUBRO", logoX + 5, logoY + 16);
  }

  // ========== CUSTOM FOOTER FUNCTION ==========
  function addFooter(pageNum, totalPagesCount) {
    const footerY = pageHeight - 22;

    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.line(10, footerY, pageWidth - 10, footerY);

    const infoY = footerY + 5;
    
    doc.setFontSize(9);
    doc.setTextColor(50, 50, 50);
    doc.setFont("helvetica", "bold");
    doc.text("Inspector:", 15, infoY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(inspectorName, 37, infoY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Signature:", 15, infoY + 5);
    doc.setFont("times", "italic");
    doc.setFontSize(11);
    doc.setTextColor(30, 30, 30);
    doc.text(inspectorSignature, 37, infoY + 5);

    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Date:", pageWidth - 55, infoY);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(dateStr, pageWidth - 42, infoY);

    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Time:", pageWidth - 55, infoY + 5);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(timeStr, pageWidth - 42, infoY + 5);

    const summaryY = infoY + 11;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Inspection Summary:", 15, summaryY);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(16, 185, 129);
    doc.text(`OK: ${okCount}`, 58, summaryY);
    
    doc.setTextColor(239, 68, 68);
    doc.text(`NOT OK: ${ngCount}`, 80, summaryY);
    
    doc.setTextColor(99, 102, 241);
    doc.text(`Total: ${totalCount}`, 115, summaryY);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`Page ${pageNum} of ${totalPagesCount}`, pageWidth / 2, pageHeight - 5, { align: "center" });
  }

  // ========== GENERATE PDF ==========
  addHeader();

  doc.autoTable({
    startY: 40,
    margin: { top: 40, bottom: 40, left: 10, right: 10 },
    head: [["FIND", "PART DESCRIPTION", "STATUS", "REMARKS"]],
    body: tableData,
    theme: "striped",
    headStyles: { 
      fillColor: [102, 126, 234], 
      textColor: 255,
      fontSize: 10,
      fontStyle: "bold",
      halign: "center"
    },
    styles: { 
      fontSize: 9, 
      cellPadding: 3,
      overflow: "linebreak"
    },
    columnStyles: {
      0: { cellWidth: 25, halign: "center" },
      1: { cellWidth: 120 },
      2: { cellWidth: 30, halign: "center" },
      3: { cellWidth: 'auto' }
    },
    didDrawPage: function(data) {
      if (data.pageNumber > 1) {
        addHeader();
      }
      addFooter(data.pageNumber, doc.internal.getNumberOfPages());
    }
  });

  const totalPagesInDoc = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPagesInDoc; i++) {
    doc.setPage(i);
    addFooter(i, totalPagesInDoc);
  }

  const filename = `PanelInspection_${panelNo}_${dateStr.replace(/\//g, "-")}.pdf`;
  doc.save(filename);

  // Clear unsaved changes flag after successful export
  clearChecklistBackup();
  console.log(`✅ PDF exported: ${filename}`);
}

/* ================= FILE NAME DISPLAY ================= */
document.getElementById("bomFile").addEventListener("change", e => {
  document.getElementById("bomFileName").textContent =
    e.target.files[0]?.name || "No file chosen";
});

document.getElementById("gaFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) {
    document.getElementById("gaFileName").textContent = "No file chosen";
    return;
  }
  
  document.getElementById("gaFileName").textContent = file.name;
  
  // Check cache status
  const cacheStatusDiv = document.getElementById("gaCacheStatus");
  if (cacheStatusDiv) {
    cacheStatusDiv.className = "ga-cache-status checking";
    cacheStatusDiv.innerHTML = "🔍 Checking cache...";
    
    try {
      const fd = new FormData();
      fd.append("file", file);
      
      const r = await fetch(`${API}/check_ga_cache`, {
        method: "POST",
        headers: { "X-Session-ID": SESSION_ID },
        body: fd
      });
      
      if (r.ok) {
        const data = await r.json();
        
        if (data.cached) {
          cacheStatusDiv.className = "ga-cache-status cached";
          cacheStatusDiv.innerHTML = `✅ Previously processed (${data.pages} pages, ${data.detections} balloons)`;
        } else {
          cacheStatusDiv.className = "ga-cache-status new";
          cacheStatusDiv.innerHTML = "ℹ️ New file - will process from scratch";
        }
      }
    } catch (error) {
      console.warn("Cache check failed:", error);
      cacheStatusDiv.className = "";
      cacheStatusDiv.innerHTML = "";
    }
  }
});

/* ================= MODAL HELPERS ================= */
function resetProgressModal(title, message = "") {
  document.querySelector("#progressModal h3").innerText = title;
  document.getElementById("progressBar").style.width = "0%";
  document.getElementById("progressBar").innerText = "";
  document.getElementById("progressMessage").innerText = message;
}

function showProgressModal() {
  document.getElementById("progressModal").style.display = "flex";
}

function hideProgressModal() {
  document.getElementById("progressModal").style.display = "none";
}

function updateProgress(d) {
  const progress = Math.round(d.progress);
  document.getElementById("progressBar").style.width = `${progress}%`;
  document.getElementById("progressBar").innerText = `${progress}%`;
  document.getElementById("progressMessage").innerText = d.message || "";
}

/* ================= BOM ================= */
async function uploadBOM() {
  const file = document.getElementById("bomFile").files[0];
  if (!file) return alert("Select BOM file");

  resetProgressModal("📋 Generating BOM Checklist", "Processing BOM...");
  showProgressModal();

  try {
    const fd = new FormData();
    fd.append("file", file);

    await fetch(`${API}/upload/bom`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      },
      body: fd
    });
    
    const r = await fetch(`${API}/process/bom?filename=${file.name}`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });

    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    }

    checklistData = await r.json();
    renderChecklist();
    updateStats();
    hasUnsavedChanges = false;
    
    console.log(`✅ Loaded ${checklistData.length} BOM items`);
  } catch (error) {
    console.error("BOM upload error:", error);
    alert(`Error generating BOM checklist: ${error.message}`);
  } finally {
    hideProgressModal();
  }
}

/* ================= CHECKLIST ================= */
function renderChecklist() {
  const body = document.getElementById("checklistBody");
  body.innerHTML = "";

  checklistData.forEach((item, index) => {
    const tr = document.createElement("tr");
    
    const findNumber = sanitizeHTML(item["FIND NUMBER"] || "");
    const partDesc = sanitizeHTML(item["PART DESCRIPTION"] || "");
    
    tr.innerHTML = `
      <td>${findNumber}</td>
      <td>${partDesc}</td>
      <td>
        <select class="status-select" data-index="${index}">
          <option value="">-</option>
          <option value="OK" ${item.status === "OK" ? "selected" : ""}>OK</option>
          <option value="NOT OK" ${item.status === "NOT OK" ? "selected" : ""}>NOT OK</option>
        </select>
      </td>
      <td>
        <input class="remarks-input" data-index="${index}" placeholder="Remarks" value="${sanitizeHTML(item.remarks || "")}">
      </td>
      <td>
        <button class="scan-btn" data-index="${index}">📷 Scan</button>
        <input 
          type="file"
          accept="image/*"
          capture="environment"
          class="scan-input"
          data-index="${index}"
          style="display:none"
        />
      </td>
    `;

    tr.onclick = e => {
      if (
        e.target.tagName === "SELECT" ||
        e.target.tagName === "INPUT" ||
        e.target.classList.contains("scan-btn")
      ) return;

      document.querySelectorAll("#checklistBody tr").forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");
      loadDetails(item["FIND NUMBER"]);
    };

    tr.setAttribute("tabindex", "0");
    tr.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (!e.target.matches("select, input, button")) {
          e.preventDefault();
          tr.click();
        }
      }
    });

    body.appendChild(tr);
  });

  document.querySelectorAll(".status-select").forEach(s =>
    s.addEventListener("change", e => {
      checklistData[e.target.dataset.index].status = e.target.value;
      updateStats();
      hasUnsavedChanges = true;
      saveChecklistBackup();
    })
  );

  document.querySelectorAll(".remarks-input").forEach(i =>
    i.addEventListener("input", debounce(e => {
      checklistData[e.target.dataset.index].remarks = e.target.value;
      hasUnsavedChanges = true;
      saveChecklistBackup();
    }, 500))
  );
}

/* ================= UTILITY FUNCTIONS ================= */
function sanitizeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

/* ================= STATS ================= */
function updateStats() {
  document.getElementById("okCount").textContent =
    checklistData.filter(i => i.status === "OK").length;
  document.getElementById("ngCount").textContent =
    checklistData.filter(i => i.status === "NOT OK").length;
  document.getElementById("totalCount").textContent = checklistData.length;
}

/* ================= DETAILS + GA ================= */
async function loadDetails(findNumber) {
  const body = document.querySelector("#detailsTable tbody");
  body.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;

  try {
    const r = await fetch(`${API}/bom/details/${encodeURIComponent(findNumber)}`, {
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    
    const d = await r.json();
    body.innerHTML = "";

    if (!d || Object.keys(d).length === 0) {
      body.innerHTML = `<tr><td colspan="2">No details found</td></tr>`;
      return;
    }

    Object.entries(d).forEach(([k, v]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${sanitizeHTML(k)}</td><td>${sanitizeHTML(v)}</td>`;
      body.appendChild(tr);
    });
  } catch (error) {
    console.error("Error loading details:", error);
    body.innerHTML = `<tr><td colspan="2">Error loading details</td></tr>`;
  }

  if (!gaLoaded) return;

  const entries = balloonMapping[String(findNumber)];
  
  if (!entries || entries.length === 0) {
    alert(`⚠️ Item ${findNumber} is not found in the GA drawing.\n\nThis item may not be referenced in the General Arrangement.`);
    return;
  }

  entries.sort((a, b) => a.page - b.page);
  
  const firstOccurrence = entries[0];
  currentPage = firstOccurrence.page;
  await renderPage(currentPage);
  highlightBalloon(firstOccurrence);

  if (entries.length > 1) {
    const otherPages = entries.slice(1).map(e => e.page).join(", ");
    const message = entries.length === 2 
      ? `ℹ️ Balloon ${findNumber} also appears on page ${otherPages}`
      : `ℹ️ Balloon ${findNumber} also appears on pages: ${otherPages}`;
    
    showNotification(message, "info");
  }
}

/* ================= NOTIFICATION ================= */
function showNotification(message, type = "info") {
  const existing = document.getElementById("gaNotification");
  if (existing) existing.remove();

  const notification = document.createElement("div");
  notification.id = "gaNotification";
  notification.className = `ga-notification ${type}`;
  
  const icons = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌"
  };
  
  const icon = icons[type] || icons.info;
  
  notification.innerHTML = `
    <span>${icon} ${sanitizeHTML(message)}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;

  const gaContainer = document.getElementById("gaContainer");
  if (gaContainer) {
    gaContainer.appendChild(notification);
    
    const timeout = type === "success" ? 5000 : 8000;
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, timeout);
  }
}

/* ================= GA UPLOAD WITH CACHE + RESUME ================= */
async function uploadGA() {
  const file = document.getElementById("gaFile").files[0];
  if (!file) return alert("Select GA file");

  console.log("🔍 Checking GA status...");
  
  try {
    const fd = new FormData();
    fd.append("file", file);
    
    const r = await fetch(`${API}/upload/ga`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      },
      body: fd
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    }
    
    const data = await r.json();
    
    // Case 1: Complete cache exists
    if (data.status === "cached") {
      console.log("✅ Complete cache found");
      hideProgressModal();
      
      await loadBalloonMapping();
      await loadGA();
      
      showNotification(
        `Loaded cached results: ${data.detections} balloons detected on ${data.pages} pages`,
        "success"
      );
      
      return;
    }
    
    // Case 2: Partial progress exists (RESUMABLE!)
    if (data.status === "resumable") {
      console.log("📋 Partial progress found!");
      
      const progress = data.progress_data;
      
      // Show resume dialog
      const resumeChoice = await showResumeDialog(progress);
      
      if (resumeChoice === "resume") {
        await resumeGAProcessing(file, data.file_hash);
      } else if (resumeChoice === "fresh") {
        await startFreshGAProcessing(file, data.file_hash);
      }
      
      return;
    }
    
    // Case 3: New file, start processing
    if (data.job_id) {
      console.log("🆕 Starting new GA processing");
      resetGAViewer();
      resetProgressModal("⚙️ Processing GA", "Starting GA...");
      showProgressModal();
      
      localStorage.setItem("ga_job_id", data.job_id);
      pollJob(data.job_id);
      
      return;
    }
    
  } catch (error) {
    console.error("GA upload error:", error);
    hideProgressModal();
    alert(`Error uploading GA: ${error.message}`);
  }
}


/* ================= RESUME DIALOG ================= */
async function showResumeDialog(progressData) {
  return new Promise((resolve) => {
    const dialogHTML = `
      <div id="resumeDialog" style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      ">
        <div style="
          background: white;
          border-radius: 12px;
          padding: 30px;
          max-width: 500px;
          box-shadow: 0 10px 40px rgba(0,0,0,0.3);
        ">
          <h2 style="margin: 0 0 20px 0; color: #333; font-size: 24px;">
            📋 Previous Processing Found
          </h2>
          
          <div style="
            background: #f0f9ff;
            border-left: 4px solid #3b82f6;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          ">
            <p style="margin: 5px 0; font-size: 16px;">
              <strong>Progress:</strong> ${progressData.processed_pages}/${progressData.total_pages} pages (${progressData.progress_percent}%)
            </p>
            <p style="margin: 5px 0; font-size: 16px;">
              <strong>Balloons found so far:</strong> ${progressData.balloons_so_far}
            </p>
            <p style="margin: 5px 0; font-size: 14px; color: #666;">
              <strong>Last updated:</strong> ${new Date(progressData.last_update).toLocaleString()}
            </p>
          </div>
          
          <p style="color: #666; margin: 20px 0; font-size: 15px;">
            Would you like to continue from where you left off, or start fresh?
          </p>
          
          <div style="display: flex; gap: 10px; margin-top: 25px;">
            <button id="resumeBtn" style="
              flex: 1;
              padding: 12px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s;
            ">
              ▶️ Continue (${progressData.remaining_pages} pages left)
            </button>
            
            <button id="freshBtn" style="
              flex: 1;
              padding: 12px;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s;
            ">
              🔄 Start Fresh
            </button>
            
            <button id="cancelBtn" style="
              padding: 12px 20px;
              background: #e5e7eb;
              color: #374151;
              border: none;
              border-radius: 6px;
              font-size: 16px;
              font-weight: 600;
              cursor: pointer;
              transition: transform 0.2s;
            ">
              ❌
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', dialogHTML);
    
    const resumeBtn = document.getElementById("resumeBtn");
    const freshBtn = document.getElementById("freshBtn");
    const cancelBtn = document.getElementById("cancelBtn");
    
    resumeBtn.onmouseover = () => resumeBtn.style.transform = "scale(1.05)";
    resumeBtn.onmouseout = () => resumeBtn.style.transform = "scale(1)";
    freshBtn.onmouseover = () => freshBtn.style.transform = "scale(1.05)";
    freshBtn.onmouseout = () => freshBtn.style.transform = "scale(1)";
    cancelBtn.onmouseover = () => cancelBtn.style.transform = "scale(1.05)";
    cancelBtn.onmouseout = () => cancelBtn.style.transform = "scale(1)";
    
    resumeBtn.onclick = () => {
      document.getElementById("resumeDialog").remove();
      resolve("resume");
    };
    
    freshBtn.onclick = () => {
      document.getElementById("resumeDialog").remove();
      resolve("fresh");
    };
    
    cancelBtn.onclick = () => {
      document.getElementById("resumeDialog").remove();
      resolve(null);
    };
  });
}


/* ================= RESUME GA PROCESSING ================= */
async function resumeGAProcessing(file, fileHash) {
  console.log("▶️ Resuming GA processing...");
  
  resetGAViewer();
  resetProgressModal("▶️ Resuming GA", "Continuing from checkpoint...");
  showProgressModal();
  
  try {
    const fd = new FormData();
    fd.append("file", file);
    
    const r = await fetch(`${API}/resume_ga`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      },
      body: fd
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    }
    
    const data = await r.json();
    
    localStorage.setItem("ga_job_id", data.job_id);
    console.log(`🚀 Resume job started: ${data.job_id}`);
    console.log(`   From page: ${data.from_page}/${data.total_pages}`);
    
    pollJob(data.job_id);
    
  } catch (error) {
    console.error("Resume error:", error);
    hideProgressModal();
    alert(`Error resuming GA: ${error.message}`);
  }
}


/* ================= START FRESH GA PROCESSING ================= */
async function startFreshGAProcessing(file, fileHash) {
  console.log("🔄 Starting fresh GA processing...");
  
  // Clear progress first
  try {
    await fetch(`${API}/clear_ga_progress?file_hash=${fileHash}`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });
    console.log("🗑️ Progress cleared");
  } catch (error) {
    console.warn("Warning: Could not clear progress:", error);
  }
  
  resetGAViewer();
  resetProgressModal("⚙️ Processing GA", "Starting from beginning...");
  showProgressModal();
  
  try {
    const fd = new FormData();
    fd.append("file", file);
    
    const r = await fetch(`${API}/upload/ga?force=true`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      },
      body: fd
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}: ${r.statusText}`);
    }
    
    const data = await r.json();
    
    localStorage.setItem("ga_job_id", data.job_id);
    console.log(`🚀 Fresh job started: ${data.job_id}`);
    
    pollJob(data.job_id);
    
  } catch (error) {
    console.error("Fresh start error:", error);
    hideProgressModal();
    alert(`Error starting fresh: ${error.message}`);
  }
}


/* ================= FORCE REPROCESS GA ================= */
async function forceReprocessGA() {
  const file = document.getElementById("gaFile").files[0];
  if (!file) return alert("Select GA file first");

  const confirmed = window.confirm(
    "⚠️ Force Reprocess?\n\n" +
    "This will discard any progress and process the entire GA from scratch.\n" +
    "This will take 1-3 minutes.\n\n" +
    "Continue?"
  );
  
  if (!confirmed) return;

  // Calculate file hash and start fresh
  const arrayBuffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest('MD5', arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const fileHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  await startFreshGAProcessing(file, fileHash);
}


/* ================= RESET GA VIEWER ================= */
function resetGAViewer() {
  gaLoaded = false;
  currentPage = 1;
  totalPages = 0;
  currentScale = 1;
  balloonMapping = {};
  
  const img = document.getElementById("gaImage");
  img.src = "";
  img.style.width = "0";
  img.style.height = "0";
  
  document.getElementById("highlightLayer").innerHTML = "";
  document.getElementById("gaPlaceholder").style.display = "flex";
  document.getElementById("pageInfo").innerText = "No GA loaded";
  
  const notification = document.getElementById("gaNotification");
  if (notification) notification.remove();
}

/* ================= POLLING ================= */
function stopPolling() {
  if (gaPollTimer) {
    clearInterval(gaPollTimer);
    gaPollTimer = null;
  }
  isProcessingCompletion = false;
}

function pollJob(id) {
  stopPolling();

  gaPollTimer = setInterval(async () => {
    if (isProcessingCompletion) return;

    try {
      const r = await fetch(`${API}/job/status/${id}`, {
        headers: {
          "X-Session-ID": SESSION_ID
        }
      });
      
      if (!r.ok) {
        throw new Error(`HTTP ${r.status}`);
      }
      
      const s = await r.json();
      updateProgress(s);

      if (s.status === "complete") {
        isProcessingCompletion = true;
        stopPolling();
        localStorage.removeItem("ga_job_id");
        
        try {
          await loadBalloonMapping();
          await loadGA();
          console.log("✅ GA processing complete");
        } catch (error) {
          console.error("Error loading GA results:", error);
          alert("Error loading GA results. Please refresh and try again.");
        } finally {
          hideProgressModal();
          isProcessingCompletion = false;
        }
      }

      if (s.status === "cancelled") {
        stopPolling();
        localStorage.removeItem("ga_job_id");
        hideProgressModal();
        console.log("⛔ GA processing cancelled");
      }

      if (s.status === "error") {
        stopPolling();
        localStorage.removeItem("ga_job_id");
        hideProgressModal();
        alert(`GA processing error: ${s.message || "Unknown error"}`);
      }

    } catch (error) {
      console.error("Polling error:", error);
      stopPolling();
      hideProgressModal();
      alert("Lost connection to server. Please refresh and try again.");
    }
  }, 500);
}

/* ================= CANCEL GA PROCESSING ================= */
async function cancelGAProcessing() {
  const jobId = localStorage.getItem("ga_job_id");
  if (!jobId) {
    alert("No active GA processing to cancel");
    return;
  }

  console.log("🛑 User requested cancellation for job:", jobId);

  try {
    const r = await fetch(`${API}/job/cancel/${jobId}`, {
      method: "POST",
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });
    
    if (r.ok) {
      localStorage.removeItem("ga_job_id");
      stopPolling();
      hideProgressModal();
      alert("GA processing cancelled successfully");
      console.log("✅ Job cancelled:", jobId);
    } else {
      throw new Error(`HTTP ${r.status}`);
    }
  } catch (e) {
    console.error("Error cancelling job:", e);
    alert("Failed to cancel processing. Please try again.");
  }
}

/* ================= BALLOONS ================= */
async function loadBalloonMapping() {
  try {
    const r = await fetch(`${API}/balloon_results`, {
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    
    const d = await r.json();
    
    if (!Array.isArray(d)) {
      console.error("Invalid balloon data:", d);
      return;
    }
    
    balloonMapping = {};
    d.forEach(b => {
      if (!b.balloon_number || !b.page || !b.bbox) {
        console.warn("Invalid balloon:", b);
        return;
      }
      
      const k = String(b.balloon_number);
      if (!balloonMapping[k]) balloonMapping[k] = [];
      balloonMapping[k].push(b);
    });
    
    console.log(`✅ Loaded ${Object.keys(balloonMapping).length} unique balloons`);
  } catch (error) {
    console.error("Error loading balloon mapping:", error);
    throw error;
  }
}

async function loadGA() {
  try {
    const r = await fetch(`${API}/ga_pages`, {
      headers: {
        "X-Session-ID": SESSION_ID
      }
    });
    
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    
    const d = await r.json();
    totalPages = d.pages;
    currentPage = 1;
    gaLoaded = true;
    document.getElementById("gaPlaceholder").style.display = "none";
    await renderPage(currentPage);
    
    console.log(`✅ Loaded GA with ${totalPages} pages`);
  } catch (error) {
    console.error("Error loading GA:", error);
    throw error;
  }
}

/* ================= RENDER PAGE ================= */
async function renderPage(p) {
  const img = document.getElementById("gaImage");
  const inner = document.getElementById("gaInner");
  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";

  return new Promise((resolve, reject) => {
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;

      if (pageZoomLevels[p]) {
        currentScale = pageZoomLevels[p];
      } else {
        const containerW = document.getElementById("gaContainer").clientWidth;
        currentScale = (containerW - 40) / imgW;
      }

      img.style.width = `${imgW * currentScale}px`;
      img.style.height = `${imgH * currentScale}px`;
      inner.style.width = img.style.width;
      inner.style.height = img.style.height;
      layer.style.width = img.style.width;
      layer.style.height = img.style.height;

      document.getElementById("pageInfo").innerText = `Page ${currentPage} / ${totalPages}`;
      resolve();
    };

    img.onerror = () => {
      console.error(`Failed to load page ${p}`);
      document.getElementById("gaPlaceholder").style.display = "flex";
      document.getElementById("gaPlaceholder").textContent = 
        `⚠️ Failed to load page ${p}`;
      reject(new Error(`Image load failed: page_${p}.jpg`));
    };

    img.src = `${API}/ga_image/page_${p}.jpg?session_id=${SESSION_ID}`;
  });
}

/* ================= HIGHLIGHT ================= */
function highlightBalloon(b) {
  const box = document.createElement("div");
  box.className = "highlight-box";
  box.dataset.balloonNumber = b.balloon_number;
  box.style.left = `${b.bbox.x1 * currentScale}px`;
  box.style.top = `${b.bbox.y1 * currentScale}px`;
  box.style.width = `${(b.bbox.x2 - b.bbox.x1) * currentScale}px`;
  box.style.height = `${(b.bbox.y2 - b.bbox.y1) * currentScale}px`;

  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";
  layer.appendChild(box);
}

/* ================= GA CONTROLS ================= */
async function prevPage() {
  if (!gaLoaded || currentPage <= 1) return;
  currentPage--;
  try {
    await renderPage(currentPage);
  } catch (error) {
    console.error("Error rendering page:", error);
  }
}

async function nextPage() {
  if (!gaLoaded || currentPage >= totalPages) return;
  currentPage++;
  try {
    await renderPage(currentPage);
  } catch (error) {
    console.error("Error rendering page:", error);
  }
}

function zoomIn() {
  if (!gaLoaded) return;
  currentScale *= 1.2;
  applyZoom();
}

function zoomOut() {
  if (!gaLoaded) return;
  currentScale /= 1.2;
  applyZoom();
}

function fitToScreen() {
  if (!gaLoaded) return;
  const containerW = document.getElementById("gaContainer").clientWidth;
  currentScale = (containerW - 40) / imgW;
  applyZoom();
}

function fitToPage() {
  fitToScreen();
}

function applyZoom() {
  const img = document.getElementById("gaImage");
  const inner = document.getElementById("gaInner");
  const layer = document.getElementById("highlightLayer");

  const newW = imgW * currentScale;
  const newH = imgH * currentScale;

  img.style.width = `${newW}px`;
  img.style.height = `${newH}px`;
  inner.style.width = `${newW}px`;
  inner.style.height = `${newH}px`;
  layer.style.width = `${newW}px`;
  layer.style.height = `${newH}px`;

  pageZoomLevels[currentPage] = currentScale;

  const existingHighlight = layer.querySelector('.highlight-box');
  if (existingHighlight) {
    const balloonNum = existingHighlight.dataset.balloonNumber;
    if (balloonNum) {
      const entries = balloonMapping[balloonNum];
      if (entries) {
        const currentEntry = entries.find(e => e.page === currentPage);
        if (currentEntry) {
          highlightBalloon(currentEntry);
        } else {
          layer.innerHTML = "";
        }
      }
    }
  }
}

/* ================= CAMERA FUNCTIONALITY ================= */
document.addEventListener("click", e => {
  if (!e.target.classList.contains("scan-btn")) return;

  e.stopPropagation();

  const index = e.target.dataset.index;
  
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                   ('ontouchstart' in window);
  
  if (isMobile) {
    const input = document.querySelector(`.scan-input[data-index="${index}"]`);
    if (input) input.click();
  } else {
    openCamera(index);
  }
});

let cameraStream = null;

async function openCamera() {
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    const video = document.getElementById("cameraVideo");
    video.srcObject = cameraStream;

    document.getElementById("cameraModal").style.display = "flex";
  } catch (err) {
    console.error("Camera error:", err);
    alert("Camera access failed or not allowed");
  }
}

function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  closeCamera();
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById("cameraModal").style.display = "none";
}

// ============================================================================
// END OF COMPLETE SCRIPT.JS - ALL FEATURES INTEGRATED
// Cache + Resume + Tab Switch Fix + Multi-User Support + Keyboard Shortcuts
// ============================================================================