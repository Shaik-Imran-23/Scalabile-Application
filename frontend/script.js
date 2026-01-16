const API = "http://localhost:8000";

let checklistData = [];
let balloonMapping = {};

let currentPage = 1;
let totalPages = 0;
let currentScale = 1;
let gaLoaded = false;

let imgW = 0;
let imgH = 0;

/* ================= EXPORT CHECKLIST AS PDF ================= */
function exportChecklistPDF() {
  if (!checklistData || checklistData.length === 0) {
    alert("No checklist data to export. Please upload and process BOM first.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('l', 'mm', 'a4'); // Landscape orientation

  // Title
  doc.setFontSize(18);
  doc.setTextColor(102, 126, 234);
  doc.text('Digital Panel Inspection - Checklist Report', 15, 20);

  // Date and stats
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  const today = new Date().toLocaleDateString();
  doc.text(`Export Date: ${today}`, 15, 28);

  const okCount = checklistData.filter(item => item.status === "OK").length;
  const ngCount = checklistData.filter(item => item.status === "NOT OK").length;
  const totalCount = checklistData.length;

  doc.text(`Total Items: ${totalCount} | OK: ${okCount} | NOT OK: ${ngCount}`, 15, 34);

  // Prepare table data
  const tableData = checklistData.map(item => [
    item["FIND NUMBER"] || "",
    item["PART DESCRIPTION"] || "",
    item.status || "-",
    item.remarks || ""
  ]);

  // Create table
  doc.autoTable({
    startY: 40,
    head: [['FIND NUMBER', 'PART DESCRIPTION', 'STATUS', 'REMARKS']],
    body: tableData,
    theme: 'striped',
    headStyles: {
      fillColor: [102, 126, 234],
      textColor: 255,
      fontStyle: 'bold',
      halign: 'left'
    },
    columnStyles: {
      0: { cellWidth: 30 },
      1: { cellWidth: 100 },
      2: { cellWidth: 25, halign: 'center' },
      3: { cellWidth: 'auto' }
    },
    styles: {
      fontSize: 9,
      cellPadding: 4,
      overflow: 'linebreak'
    },
    alternateRowStyles: {
      fillColor: [245, 247, 250]
    },
    didParseCell: function(data) {
      // Color code status column
      if (data.column.index === 2 && data.section === 'body') {
        const status = data.cell.raw;
        if (status === 'OK') {
          data.cell.styles.textColor = [16, 185, 129]; // Green
          data.cell.styles.fontStyle = 'bold';
        } else if (status === 'NOT OK') {
          data.cell.styles.textColor = [239, 68, 68]; // Red
          data.cell.styles.fontStyle = 'bold';
        }
      }
    }
  });

  // Footer
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(
      `Page ${i} of ${pageCount}`,
      doc.internal.pageSize.width / 2,
      doc.internal.pageSize.height - 10,
      { align: 'center' }
    );
  }

  // Save PDF
  doc.save(`checklist_report_${new Date().toISOString().slice(0,10)}.pdf`);
}

/* ================= EXPORT CHECKLIST AS CSV (BACKUP) ================= */
/* ================= EXPORT CHECKLIST AS CSV (BACKUP) ================= */
function exportChecklistCSV() {
  if (!checklistData || checklistData.length === 0) {
    alert("No checklist data to export. Please upload and process BOM first.");
    return;
  }

  // Create CSV content
  let csvContent = "FIND NUMBER,PART DESCRIPTION,STATUS,REMARKS\n";
  
  checklistData.forEach(item => {
    const findNumber = item["FIND NUMBER"] || "";
    const partDesc = (item["PART DESCRIPTION"] || "").replace(/,/g, ";"); // Replace commas
    const status = item.status || "";
    const remarks = (item.remarks || "").replace(/,/g, ";"); // Replace commas
    
    csvContent += `${findNumber},${partDesc},${status},${remarks}\n`;
  });

  // Create blob and download
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `checklist_export_${new Date().toISOString().slice(0,10)}.csv`);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ================= FILE NAME DISPLAY ================= */
document.getElementById("bomFile").addEventListener("change", function(e) {
  const fileName = e.target.files[0]?.name || "No file chosen";
  document.getElementById("bomFileName").textContent = fileName;
});

document.getElementById("gaFile").addEventListener("change", function(e) {
  const fileName = e.target.files[0]?.name || "No file chosen";
  document.getElementById("gaFileName").textContent = fileName;
});

/* ================= BOM ================= */
async function uploadBOM() {
  const file = document.getElementById("bomFile").files[0];
  if (!file) return alert("Select BOM file");

  const fd = new FormData();
  fd.append("file", file);

  await fetch(`${API}/upload/bom`, { method: "POST", body: fd });
  const r = await fetch(`${API}/process/bom?filename=${file.name}`, { method: "POST" });
  checklistData = await r.json();
  renderChecklist();
  updateStats();
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
        <input type="text" class="remarks-input" data-index="${index}" placeholder="Enter remarks...">
      </td>
    `;

    tr.onclick = (e) => {
      if (e.target.tagName === "SELECT" || e.target.tagName === "INPUT") return;

      document.querySelectorAll("#checklistBody tr")
        .forEach(r => r.classList.remove("selected"));
      tr.classList.add("selected");

      loadDetails(item["FIND NUMBER"]);
    };

    body.appendChild(tr);
  });

  document.querySelectorAll(".status-select").forEach(s => {
    s.addEventListener("change", e => {
      checklistData[e.target.dataset.index].status = e.target.value;
      updateStats();
    });
  });

  document.querySelectorAll(".remarks-input").forEach(i => {
    i.addEventListener("input", e => {
      checklistData[e.target.dataset.index].remarks = e.target.value;
    });
  });
}

/* ================= STATS ================= */
function updateStats() {
  const okCount = checklistData.filter(item => item.status === "OK").length;
  const ngCount = checklistData.filter(item => item.status === "NOT OK").length;
  const totalCount = checklistData.length;

  document.getElementById("okCount").textContent = okCount;
  document.getElementById("ngCount").textContent = ngCount;
  document.getElementById("totalCount").textContent = totalCount;
}

/* ================= DETAILS + GA ================= */
async function loadDetails(findNumber) {

  /* ---------- DETAILS ---------- */
  const detailsBody = document.querySelector("#detailsTable tbody");
  detailsBody.innerHTML = `<tr><td colspan="2">Loading...</td></tr>`;

  try {
    const r = await fetch(`${API}/bom/details/${encodeURIComponent(findNumber)}`);
    const d = await r.json();
    detailsBody.innerHTML = "";

    if (!d || Object.keys(d).length === 0) {
      detailsBody.innerHTML = `<tr><td colspan="2" class="empty-state">No details found</td></tr>`;
    } else {
      Object.entries(d).forEach(([k, v]) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${k}</td><td>${v}</td>`;
        detailsBody.appendChild(tr);
      });
    }
  } catch {
    detailsBody.innerHTML = `<tr><td colspan="2" class="empty-state">Error loading details</td></tr>`;
  }

  /* ---------- GA ---------- */
  if (!gaLoaded) return;

  const balloon = balloonMapping[findNumber];
  if (!balloon) return;

  currentPage = balloon.page;
  await renderPage(currentPage);
  highlightBalloon(balloon);
}

/* ================= GA UPLOAD ================= */
async function uploadGA() {
  const file = document.getElementById("gaFile").files[0];
  if (!file) return alert("Select GA file");

  showProgressModal();

  const fd = new FormData();
  fd.append("file", file);

  const r = await fetch(`${API}/upload/ga`, { method: "POST", body: fd });
  const d = await r.json();
  pollJob(d.job_id);
}

/* ================= POLLING ================= */
function pollJob(id) {
  const timer = setInterval(async () => {
    const r = await fetch(`${API}/job/status/${id}`);
    const s = await r.json();
    updateProgress(s);

    if (s.status === "complete") {
      clearInterval(timer);
      await loadBalloonMapping();
      await loadGA();
      hideProgressModal();
    }
  }, 2000);
}

/* ================= BALLOONS ================= */
async function loadBalloonMapping() {
  const r = await fetch(`${API}/balloon_results`);
  const d = await r.json();
  balloonMapping = {};
  d.forEach(b => balloonMapping[b.balloon_number] = b);
}

/* ================= GA ================= */
async function loadGA() {
  const r = await fetch(`${API}/ga_pages`);
  const d = await r.json();
  totalPages = d.pages;
  currentPage = 1;
  gaLoaded = true;
  
  // Hide placeholder
  const placeholder = document.getElementById("gaPlaceholder");
  if (placeholder) placeholder.style.display = "none";
  
  renderPage(currentPage);
}

/* ================= RENDER PAGE (PRESERVED LOGIC) ================= */
async function renderPage(p) {
  const img = document.getElementById("gaImage");
  const inner = document.getElementById("gaInner");
  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";

  return new Promise(resolve => {
    img.onload = () => {
      imgW = img.naturalWidth;
      imgH = img.naturalHeight;

      const container = document.getElementById("gaContainer");
      const containerW = container.clientWidth;

      const padding = 40;
      currentScale = (containerW - padding) / imgW;

      const w = imgW * currentScale;
      const h = imgH * currentScale;

      img.style.width = w + "px";
      img.style.height = h + "px";
      inner.style.width = w + "px";
      inner.style.height = h + "px";
      layer.style.width = w + "px";
      layer.style.height = h + "px";

      document.getElementById("pageInfo").innerText =
        `Page ${currentPage} / ${totalPages}`;

      resolve();
    };

    img.src = `${API}/ga_image/page_${p}.jpg`;
  });
}

/* ================= HIGHLIGHT (PRESERVED LOGIC) ================= */
function highlightBalloon(b) {
  const layer = document.getElementById("highlightLayer");
  layer.innerHTML = "";

  const box = document.createElement("div");
  box.className = "highlight-box";
  box.style.left = b.bbox.x1 * currentScale + "px";
  box.style.top = b.bbox.y1 * currentScale + "px";
  box.style.width = (b.bbox.x2 - b.bbox.x1) * currentScale + "px";
  box.style.height = (b.bbox.y2 - b.bbox.y1) * currentScale + "px";

  layer.appendChild(box);
}

/* ================= CONTROLS ================= */
function nextPage() {
  if (currentPage < totalPages) {
    currentPage++;
    renderPage(currentPage);
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderPage(currentPage);
  }
}

function zoomIn() {
  currentScale *= 1.2;
  updateScale();
}

function zoomOut() {
  currentScale *= 0.8;
  updateScale();
}

function fitToPage() {
  renderPage(currentPage);
}

function updateScale() {
  const img = document.getElementById("gaImage");
  const inner = document.getElementById("gaInner");
  const layer = document.getElementById("highlightLayer");

  const w = imgW * currentScale;
  const h = imgH * currentScale;

  img.style.width = w + "px";
  img.style.height = h + "px";
  inner.style.width = w + "px";
  inner.style.height = h + "px";
  layer.style.width = w + "px";
  layer.style.height = h + "px";

  const selected = document.querySelector("#checklistBody tr.selected");
  if (selected) {
    const fn = selected.cells[0].textContent;
    const b = balloonMapping[fn];
    if (b) highlightBalloon(b);
  }
}

/* ================= MODAL ================= */
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