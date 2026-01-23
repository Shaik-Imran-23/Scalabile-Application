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

/* ================= EXPORT CHECKLIST AS PDF ================= */
function exportChecklistPDF() {
  if (!checklistData || checklistData.length === 0) {
    alert("No checklist data to export. Please upload and process BOM first.");
    return;
  }

  const panelNo = document.getElementById("bomPanelNo")?.value.trim();
  if (!panelNo) {
    alert("Please enter Sr.No before exporting.");
    return;
  }

  const ddNo = document.getElementById("ddNo")?.value.trim();
  if (!ddNo) {
    alert("Please enter DD No before exporting.");
    return;
  }

  const inspectorName = document.getElementById("inspectorName")?.value.trim();
  if (!inspectorName) {
    alert("Please enter Inspector Name before exporting.");
    return;
  }

  const inspectorSignature = document.getElementById("inspectorSignature")?.value.trim();
  if (!inspectorSignature) {
    alert("Please enter Inspector Signature before exporting.");
    return;
  }

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
    // Top border line - thicker and more prominent
    doc.setDrawColor(0, 51, 153); // Dark blue
    doc.setLineWidth(2);
    doc.line(10, 8, pageWidth - 10, 8);

    const startY = 11;
    const logoBoxWidth = 60; // Increased from 50
    const tableStartX = 10 + logoBoxWidth;
    const rowHeight = 9; // Slightly increased for better spacing

    // Draw logo box with subtle shadow effect
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.6);
    doc.rect(10, startY, logoBoxWidth, rowHeight * 3);

    // Add logo image (Larsen & Toubro) - centered and larger
    const logoWidth = 55; // Increased from 45
    const logoHeight = 22; // Increased from 20
    const logoX = 10 + (logoBoxWidth - logoWidth) / 2;
    const logoY = startY + (rowHeight * 3 - logoHeight) / 2;
    
    try {
      const logo = new Image();
      logo.src = 'logo.jpg';
      doc.addImage(logo, 'JPEG', logoX, logoY, logoWidth, logoHeight);
    } catch (e) {
      // If logo fails to load, show text
      doc.setFontSize(11);
      doc.setTextColor(0, 51, 153);
      doc.setFont("helvetica", "bold");
      doc.text("LARSEN &", logoX + 5, logoY + 10);
      doc.text("TOUBRO", logoX + 5, logoY + 16);
    }

    // Calculate table dimensions
    const tableWidth = pageWidth - 10 - tableStartX;

    // Row 1: Title (full width) - enhanced styling
    doc.setLineWidth(0.6);
    doc.rect(tableStartX, startY, tableWidth, rowHeight);
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", "bold");
    doc.text("Digital Bom-Checklist Report", tableStartX + tableWidth / 2, startY + 6.2, { align: "center" });

    // Row 2: Panel No value only - better vertical centering
    doc.rect(tableStartX, startY + rowHeight, tableWidth, rowHeight);
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(30, 30, 30);
    doc.text(panelNo, tableStartX + tableWidth / 2, startY + rowHeight + 6.2, { align: "center" });

    // Row 3: DD NO value only - better vertical centering
    doc.rect(tableStartX, startY + rowHeight * 2, tableWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.text(ddNo, tableStartX + tableWidth / 2, startY + rowHeight * 2 + 6.2, { align: "center" });

    // Bottom border line - thicker and more prominent
    doc.setDrawColor(0, 51, 153);
    doc.setLineWidth(2);
    doc.line(10, startY + rowHeight * 3 + 0.5, pageWidth - 10, startY + rowHeight * 3 + 0.5);
  }

  // ========== CUSTOM FOOTER FUNCTION ==========
  function addFooter(pageNum, totalPages) {
    const footerY = pageHeight - 22;

    // Top border line for footer
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.4);
    doc.line(10, footerY, pageWidth - 10, footerY);

    // Inspector and Date/Time info
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

    // Date and Time on the right
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

    // Inspection Summary - tighter spacing
    const summaryY = infoY + 11;
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(50, 50, 50);
    doc.text("Inspection Summary:", 15, summaryY);
    
    doc.setFont("helvetica", "normal");
    doc.setTextColor(16, 185, 129); // Green
    doc.text("OK: " + String(okCount), 58, summaryY);
    
    doc.setTextColor(239, 68, 68); // Red
    doc.text("NOT OK: " + String(ngCount), 80, summaryY);
    
    doc.setTextColor(99, 102, 241); // Blue
    doc.text("Total: " + String(totalCount), 115, summaryY);

    // Page number at bottom - using manual string construction
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text("Page " + String(pageNum) + " of " + String(totalPages), pageWidth / 2, pageHeight - 5, { align: "center" });
  }

  // ========== GENERATE PDF ==========
  // Add header to first page
  addHeader();

  // Add table with custom settings
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
      // Add header to every page
      if (data.pageNumber > 1) {
        addHeader();
      }
      // Add footer to every page
      addFooter(data.pageNumber, doc.internal.getNumberOfPages());
    }
  });

  // Update all footers with correct total page count
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    addFooter(i, totalPages);
  }

  // Save with descriptive filename
  doc.save(`PanelInspection_${panelNo}_${dateStr.replace(/\//g, "-")}.pdf`);
}

/* ================= FILE NAME DISPLAY ================= */
document.getElementById("bomFile").addEventListener("change", e => {
  document.getElementById("bomFileName").textContent =
    e.target.files[0]?.name || "No file chosen";
});

document.getElementById("gaFile").addEventListener("change", e => {
  document.getElementById("gaFileName").textContent =
    e.target.files[0]?.name || "No file chosen";
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
  document.getElementById("progressBar").style.width = d.progress + "%";
  document.getElementById("progressBar").innerText = Math.round(d.progress) + "%";
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

    await fetch(`${API}/upload/bom`, { method: "POST", body: fd });
    const r = await fetch(`${API}/process/bom?filename=${file.name}`, {
      method: "POST"
    });

    checklistData = await r.json();
    renderChecklist();
    updateStats();
  } catch {
    alert("Error generating BOM checklist");
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
tr.innerHTML = `
  <td>${item["FIND NUMBER"]}</td>
  <td>${item["PART DESCRIPTION"]}</td>
  <td>
    <select class="status-select" data-index="${index}">
      <option value="">-</option>
      <option value="OK">OK</option>
      <option value="NOT OK">NOT OK</option>
    </select>
  </td>
  <td>
    <input class="remarks-input" data-index="${index}" placeholder="Remarks">
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


    body.appendChild(tr);
  });

  document.querySelectorAll(".status-select").forEach(s =>
    s.addEventListener("change", e => {
      checklistData[e.target.dataset.index].status = e.target.value;
      updateStats();
    })
  );

  document.querySelectorAll(".remarks-input").forEach(i =>
    i.addEventListener("input", e => {
      checklistData[e.target.dataset.index].remarks = e.target.value;
    })
  );
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
    const r = await fetch(`${API}/bom/details/${encodeURIComponent(findNumber)}`);
    const d = await r.json();
    body.innerHTML = "";

    if (!d || Object.keys(d).length === 0) {
      body.innerHTML = `<tr><td colspan="2">No details found</td></tr>`;
      return;
    }

    Object.entries(d).forEach(([k, v]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
      body.appendChild(tr);
    });
  } catch {
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
  notification.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;

  const gaContainer = document.getElementById("gaContainer");
  if (gaContainer) {
    gaContainer.appendChild(notification);
    setTimeout(() => notification.remove(), 8000);
  }
}

/* ================= GA UPLOAD ================= */
async function uploadGA() {
  const file = document.getElementById("gaFile").files[0];
  if (!file) return alert("Select GA file");

  resetGAViewer();
  resetProgressModal("⚙️ Processing GA", "Starting GA...");
  showProgressModal();

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch(`${API}/upload/ga`, { method: "POST", body: fd });
  const d = await r.json();

  localStorage.setItem("ga_job_id", d.job_id);
  pollJob(d.job_id);
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
function pollJob(id) {
  if (gaPollTimer) clearInterval(gaPollTimer);

  gaPollTimer = setInterval(async () => {
    try {
      const r = await fetch(`${API}/job/status/${id}`);
      const s = await r.json();
      updateProgress(s);

      if (s.status === "complete") {
        clearInterval(gaPollTimer);
        localStorage.removeItem("ga_job_id");
        await loadBalloonMapping();
        await loadGA();
        hideProgressModal();
      }

      if (s.status === "cancelled" || s.status === "error") {
        clearInterval(gaPollTimer);
        localStorage.removeItem("ga_job_id");
        hideProgressModal();
        alert(`GA processing ${s.status}`);
      }
    } catch {
      clearInterval(gaPollTimer);
      hideProgressModal();
    }
  }, 500);
}

/* ================= CANCEL ================= */
async function cancelGAProcessing() {
  const jobId = localStorage.getItem("ga_job_id");
  if (!jobId) {
    alert("No active GA processing to cancel");
    return;
  }

  try {
    await fetch(`${API}/job/cancel/${jobId}`, { method: "POST" });
    localStorage.removeItem("ga_job_id");
    if (gaPollTimer) clearInterval(gaPollTimer);
    hideProgressModal();
    alert("GA processing cancelled");
  } catch (e) {
    console.error("Error cancelling job:", e);
  }
}

window.addEventListener("beforeunload", () => {
  const jobId = localStorage.getItem("ga_job_id");
  if (jobId) {
    navigator.sendBeacon(`${API}/job/cancel/${jobId}`);
    localStorage.removeItem("ga_job_id");
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    const jobId = localStorage.getItem("ga_job_id");
    if (jobId) {
      fetch(`${API}/job/cancel/${jobId}`, {
        method: "POST",
        keepalive: true
      }).catch(() => {
        navigator.sendBeacon(`${API}/job/cancel/${jobId}`);
      });
    }
  }
});

window.addEventListener("pagehide", () => {
  const jobId = localStorage.getItem("ga_job_id");
  if (jobId) {
    navigator.sendBeacon(`${API}/job/cancel/${jobId}`);
    localStorage.removeItem("ga_job_id");
  }
});

/* ================= BALLOONS ================= */
async function loadBalloonMapping() {
  const r = await fetch(`${API}/balloon_results`);
  const d = await r.json();
  balloonMapping = {};
  d.forEach(b => {
    const k = String(b.balloon_number);
    if (!balloonMapping[k]) balloonMapping[k] = [];
    balloonMapping[k].push(b);
  });
}

async function loadGA() {
  const r = await fetch(`${API}/ga_pages`);
  const d = await r.json();
  totalPages = d.pages;
  currentPage = 1;
  gaLoaded = true;
  document.getElementById("gaPlaceholder").style.display = "none";
  renderPage(currentPage);
}

/* ================= RENDER PAGE ================= */
async function renderPage(p) {
  const img = document.getElementById("gaImage");
  const inner = document.getElementById("gaInner");
  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";

  return new Promise(resolve => {
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;

      const containerW = document.getElementById("gaContainer").clientWidth;
      currentScale = (containerW - 40) / imgW;

      img.style.width = imgW * currentScale + "px";
      img.style.height = imgH * currentScale + "px";
      inner.style.width = img.style.width;
      inner.style.height = img.style.height;
      layer.style.width = img.style.width;
      layer.style.height = img.style.height;

      document.getElementById("pageInfo").innerText = `Page ${currentPage} / ${totalPages}`;
      resolve();
    };
    img.src = `${API}/ga_image/page_${p}.jpg`;
  });
}

/* ================= HIGHLIGHT ================= */
function highlightBalloon(b) {
  const box = document.createElement("div");
  box.className = "highlight-box";
  box.dataset.balloonNumber = b.balloon_number;
  box.style.left = b.bbox.x1 * currentScale + "px";
  box.style.top = b.bbox.y1 * currentScale + "px";
  box.style.width = (b.bbox.x2 - b.bbox.x1) * currentScale + "px";
  box.style.height = (b.bbox.y2 - b.bbox.y1) * currentScale + "px";

  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";
  layer.appendChild(box);
}

/* ================= GA CONTROLS ================= */
async function prevPage() {
  if (!gaLoaded || currentPage <= 1) return;
  currentPage--;
  await renderPage(currentPage);
}

async function nextPage() {
  if (!gaLoaded || currentPage >= totalPages) return;
  currentPage++;
  await renderPage(currentPage);
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

  img.style.width = newW + "px";
  img.style.height = newH + "px";
  inner.style.width = newW + "px";
  inner.style.height = newH + "px";
  layer.style.width = newW + "px";
  layer.style.height = newH + "px";

  const existingHighlight = layer.querySelector('.highlight-box');
  if (existingHighlight) {
    const balloonNum = existingHighlight.dataset.balloonNumber;
    if (balloonNum) {
      const entries = balloonMapping[balloonNum];
      if (entries) {
        const currentEntry = entries.find(e => e.page === currentPage);
        if (currentEntry) {
          highlightBalloon(currentEntry);
        }
      }
    }
  }
}


document.addEventListener("click", e => {
  if (!e.target.classList.contains("scan-btn")) return;

  e.stopPropagation(); // 🔒 prevent row click

  const index = e.target.dataset.index;
  
  // Detect if mobile/tablet or desktop
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || 
                   ('ontouchstart' in window);
  
  if (isMobile) {
    // Use native file input for mobile - more reliable
    const input = document.querySelector(`.scan-input[data-index="${index}"]`);
    if (input) input.click();
  } else {
    // Use webcam API for desktop/laptop
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
    alert("Camera access failed or not allowed");
    console.error(err);
  }
}

function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  const canvas = document.getElementById("cameraCanvas");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0);

  // ⚠️ Not storing anywhere (as per requirement)
  closeCamera();
}

function closeCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  document.getElementById("cameraModal").style.display = "none";
}
