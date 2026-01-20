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
    alert("Please enter BOM Panel No before exporting.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("l", "mm", "a4");

  doc.setFontSize(18);
  doc.setTextColor(102, 126, 234);
  doc.text("Digital Panel Inspection - Checklist Report", 15, 20);

  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Panel No: ${panelNo}`, 15, 28);

  const today = new Date().toLocaleDateString();
  doc.text(`Export Date: ${today}`, 15, 34);

  const okCount = checklistData.filter(i => i.status === "OK").length;
  const ngCount = checklistData.filter(i => i.status === "NOT OK").length;

  doc.text(
    `Total Items: ${checklistData.length} | OK: ${okCount} | NOT OK: ${ngCount}`,
    15,
    40
  );

  const tableData = checklistData.map(i => [
    i["FIND NUMBER"] || "",
    i["PART DESCRIPTION"] || "",
    i.status || "-",
    i.remarks || ""
  ]);

  doc.autoTable({
    startY: 46,
    head: [["FIND NUMBER", "PART DESCRIPTION", "STATUS", "REMARKS"]],
    body: tableData,
    theme: "striped",
    headStyles: { fillColor: [102, 126, 234], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 4 }
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Panel No: ${panelNo} | Page ${i} of ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: "center" }
    );
  }

  doc.save(`checklist_${panelNo}.pdf`);
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
    `;

    tr.onclick = e => {
      if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;
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

/* ================= DETAILS + GA (ENHANCED) ================= */
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

  // ✅ ENHANCED: Check if GA is loaded
  if (!gaLoaded) {
    return; // Don't try to navigate if GA not loaded
  }

  // ✅ ENHANCED: Check if find number exists in GA
  const entries = balloonMapping[String(findNumber)];
  
  if (!entries || entries.length === 0) {
    alert(`⚠️ Item ${findNumber} is not found in the GA drawing.\n\nThis item may not be referenced in the General Arrangement.`);
    return;
  }

  // ✅ ENHANCED: Sort by page number to get first occurrence
  entries.sort((a, b) => a.page - b.page);
  
  // ✅ ENHANCED: Navigate to first occurrence
  const firstOccurrence = entries[0];
  currentPage = firstOccurrence.page;
  await renderPage(currentPage);
  highlightBalloon(firstOccurrence);

  // ✅ ENHANCED: Notify about other pages if balloon appears multiple times
  if (entries.length > 1) {
    const otherPages = entries.slice(1).map(e => e.page).join(", ");
    const message = entries.length === 2 
      ? `ℹ️ Balloon ${findNumber} also appears on page ${otherPages}`
      : `ℹ️ Balloon ${findNumber} also appears on pages: ${otherPages}`;
    
    console.log(`Balloon ${findNumber} found on ${entries.length} pages:`, entries.map(e => e.page));
    console.log("Showing notification:", message);
    
    // Show notification
    showNotification(message, "info");
  } else {
    console.log(`Balloon ${findNumber} found only on page ${firstOccurrence.page}`);
  }
}

/* ================= NOTIFICATION SYSTEM (NEW) ================= */
function showNotification(message, type = "info") {
  // Remove existing notification if any
  const existing = document.getElementById("gaNotification");
  if (existing) {
    existing.remove();
  }

  // Create notification element
  const notification = document.createElement("div");
  notification.id = "gaNotification";
  notification.className = `ga-notification ${type}`;
  notification.innerHTML = `
    <span>${message}</span>
    <button onclick="this.parentElement.remove()">×</button>
  `;

  // Add to GA container (or body as fallback)
  const gaContainer = document.getElementById("gaContainer");
  const targetElement = gaContainer || document.body;
  
  if (targetElement) {
    // Make sure container has relative positioning
    if (gaContainer) {
      gaContainer.style.position = "relative";
    }
    
    targetElement.appendChild(notification);
    
    // Auto-remove after 8 seconds
    setTimeout(() => {
      if (notification.parentElement) {
        notification.remove();
      }
    }, 8000);
  }
}

/* ================= GA UPLOAD ================= */
async function uploadGA() {
  const file = document.getElementById("gaFile").files[0];
  if (!file) return alert("Select GA file");

  resetProgressModal("⚙️ Processing GA", "Starting GA...");
  showProgressModal();

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch(`${API}/upload/ga`, { method: "POST", body: fd });
  const d = await r.json();

  localStorage.setItem("ga_job_id", d.job_id);
  pollJob(d.job_id);
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

      if (s.status === "cancelled") {
        clearInterval(gaPollTimer);
        localStorage.removeItem("ga_job_id");
        hideProgressModal();
        alert("GA processing cancelled");
      }

      if (s.status === "failed") {
        clearInterval(gaPollTimer);
        localStorage.removeItem("ga_job_id");
        hideProgressModal();
        alert("GA processing failed");
      }
    } catch {
      clearInterval(gaPollTimer);
      hideProgressModal();
    }
  }, 2000);
}

/* ================= CANCEL JOB ON REFRESH ================= */
window.addEventListener("beforeunload", () => {
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

/* ================= GA ================= */
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

      document.getElementById("pageInfo").innerText =
        `Page ${currentPage} / ${totalPages}`;
      resolve();
    };
    img.src = `${API}/ga_image/page_${p}.jpg`;
  });
}

/* ================= HIGHLIGHT ================= */
function highlightBalloon(b) {
  const box = document.createElement("div");
  box.className = "highlight-box";
  box.style.left = b.bbox.x1 * currentScale + "px";
  box.style.top = b.bbox.y1 * currentScale + "px";
  box.style.width = (b.bbox.x2 - b.bbox.x1) * currentScale + "px";
  box.style.height = (b.bbox.y2 - b.bbox.y1) * currentScale + "px";

  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";
  layer.appendChild(box);
}