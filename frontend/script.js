const API = "http://localhost:8000";
let checklistData = [];

/* =========================
   Upload & Generate Checklist
   ========================= */
async function uploadBOM() {
  const fileInput = document.getElementById("bomFile");

  if (!fileInput.files.length) {
    alert("Please select a BOM file");
    return;
  }

  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  // Upload BOM
  await fetch(`${API}/upload/bom`, {
    method: "POST",
    body: formData
  });

  // Process BOM
  const res = await fetch(
    `${API}/process/bom?filename=${file.name}`,
    { method: "POST" }
  );

  checklistData = await res.json();

  console.log("Checklist received from backend:", checklistData);
  renderChecklist();
}

/* =========================
   Render Checklist Table
   ========================= */
function renderChecklist() {
  const tbody = document.getElementById("checklistBody");
  tbody.innerHTML = "";

  checklistData.forEach((item, index) => {
    const row = document.createElement("tr");
    row.style.cursor = "pointer";

    row.innerHTML = `
      <td>${item["FIND NUMBER"]}</td>
      <td>${item["PART DESCRIPTION"]}</td>
      <td>
        <select onchange="updateStatus(${index}, this.value)">
          <option value="">--Select--</option>
          <option value="OK">OK</option>
          <option value="NOT OK">NOT OK</option>
        </select>
      </td>
      <td>
        <input type="text" oninput="updateRemarks(${index}, this.value)" />
      </td>
    `;

    // 🔹 Click row → load full details
    row.onclick = () => loadDetails(item["FIND NUMBER"]);

    tbody.appendChild(row);
  });
}

/* =========================
   Update Inspection Fields
   ========================= */
function updateStatus(index, value) {
  checklistData[index]["STATUS"] = value;
}

function updateRemarks(index, value) {
  checklistData[index]["REMARKS"] = value;
}

/* =========================
   Load Full BOM Details
   ========================= */
async function loadDetails(findNumber) {
  const res = await fetch(`${API}/bom/details/${findNumber}`);
  const data = await res.json();

  const tbody = document.querySelector("#detailsTable tbody");
  tbody.innerHTML = "";

  if (!data || Object.keys(data).length === 0) {
    tbody.innerHTML = `<tr><td colspan="2">No details found</td></tr>`;
    return;
  }

  for (const key in data) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><b>${key}</b></td>
      <td>${data[key]}</td>
    `;
    tbody.appendChild(tr);
  }
}
