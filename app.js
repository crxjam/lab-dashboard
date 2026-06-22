let currentRows = [];
let filteredRows = [];
let wardChart = null;
let ageChart = null;

/*
  MULTIPLE PC SETUP

  For now this works locally in the browser.
  For multiple PCs, replace BACKEND_URL with your shared API endpoint later.

  Example later:
  const BACKEND_URL = "https://your-lab-server/otl-api";

  Required backend routes later:
  GET  /comments
  POST /comments
  POST /tat-snapshot
*/
const BACKEND_URL = "";

const STATUS_OPTIONS = [
  "Not located",
  "Located in lab",
  "With section",
  "Awaiting aliquot",
  "Awaiting analyser",
  "Problem sample",
  "Resolved"
];

const AGE_BUCKETS = [
  "<2 h",
  "2-4 h",
  "4-8 h",
  "8-24 h",
  ">24 h"
];

/*
  Ward-specific TAT rules.
  We will edit this when you give the final ward list.

  Current default:
  Emergency/ICU = 8 h
  Everything else = 12 h
*/
const WARD_TAT_RULES = {
  "Emergency": 8,
  "ICU / High Care": 8,
  "Medical wards": 12,
  "Surgical wards": 12,
  "Outpatients": 12,
  "Other": 12
};

const WARD_GROUPS = {
  "Emergency": [" EC", "EC--", "EMERGENCY", "CASUALTY", "TRAUMA"],
  "ICU / High Care": ["ICU", "HCU", "HIGH CARE", "CCU", "NICU", "PICU"],
  "Medical wards": ["MED", "MEDICAL", "MOPD", "G13", "G14", "C13", "C14"],
  "Surgical wards": ["SURG", "SURGICAL", "ORTHO", "UROLOGY", "ENT"],
  "Outpatients": ["OPD", "CLINIC", "OUTPATIENT", "MOPD"],
  "Other": []
};

/*
  Exact OTL columns seen in your files:
  Visit Number
  Patient Name
  Location
  Tests
  Specimen Type
  Collection Date
  Registration Date
  In Lab Date
  Storage Positions
  Referral Status
  Alternative Reference
  Internal Reference
*/
const COLUMN_ALIASES = {
  visitNumber: ["Visit Number", "Episode Number", "Episode", "Lab Number", "Accession Number"],
  patientName: ["Patient Name", "Patient"],
  location: ["Location", "Ward", "Source"],
  tests: ["Tests", "Test", "Test Set Description", "Test Item Description", "Analyte"],
  specimenType: ["Specimen Type", "Specimen"],
  collectionDate: ["Collection Date", "Collected Date", "Collection Date Time"],
  registrationDate: ["Registration Date", "Registered Date", "Registration Date Time"],
  inLabDate: ["In Lab Date", "In-Lab Date", "Received Date", "Lab Received Date"],
  storagePositions: ["Storage Positions", "Storage Position", "Storage"],
  referralStatus: ["Referral Status", "Status", "Current Status"],
  alternativeReference: ["Alternative Reference"],
  internalReference: ["Internal Reference"],
  hospital: ["Hospital", "Facility"]
};

function splitCSVLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }

  out.push(current);
  return out;
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCSVLine(lines[0]).map(h => h.trim());

  return lines.slice(1).filter(Boolean).map(line => {
    const values = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? "");
    return obj;
  });
}

async function readFile(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {
    return parseCSV(await file.text());
  }

  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, {
    type: "array",
    cellDates: true
  });

  const sheet = workbook.Sheets[workbook.SheetNames[0]];

  return XLSX.utils.sheet_to_json(sheet, {
    defval: "",
    raw: false
  });
}

function normaliseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/()-]/g, " ")
    .replace(/\s+/g, " ");
}

function getValue(row, aliasList) {
  const keyMap = {};

  Object.keys(row).forEach(k => {
    keyMap[normaliseName(k)] = k;
  });

  for (const alias of aliasList) {
    const actual = keyMap[normaliseName(alias)];
    if (actual !== undefined) return row[actual];
  }

  return "";
}

function parseDate(value) {
  if (!value) return null;

  if (value instanceof Date && !isNaN(value)) return value;

  if (typeof value === "number") {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(excelEpoch.getTime() + value * 86400000);
  }

  const text = String(value).trim();
  if (!text) return null;

  let d = new Date(text);
  if (!isNaN(d)) return d;

  const m = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3].length === 2 ? "20" + m[3] : m[3]);
    const hour = Number(m[4] || 0);
    const minute = Number(m[5] || 0);
    const second = Number(m[6] || 0);

    d = new Date(year, month, day, hour, minute, second);
    if (!isNaN(d)) return d;
  }

  return null;
}

function hoursSince(date) {
  return (new Date() - date) / 3600000;
}

function formatHours(hours) {
  if (hours == null || !Number.isFinite(hours)) return "-";

  if (hours < 1) return `${Math.round(hours * 60)} min`;

  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);

  if (m === 60) return `${h + 1} h`;
  if (m === 0) return `${h} h`;

  return `${h} h ${m} min`;
}

function median(arr) {
  if (!arr.length) return null;

  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);

  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function assignAgeBucket(hours) {
  if (hours < 2) return "<2 h";
  if (hours < 4) return "2-4 h";
  if (hours < 8) return "4-8 h";
  if (hours < 24) return "8-24 h";
  return ">24 h";
}

function assignWardGroup(location) {
  const loc = ` ${String(location || "").toUpperCase()} `;

  for (const [group, keys] of Object.entries(WARD_GROUPS)) {
    if (group === "Other") continue;
    if (keys.some(k => loc.includes(k.toUpperCase()))) return group;
  }

  return "Other";
}

function getTatTargetHours(wardGroup) {
  return WARD_TAT_RULES[wardGroup] ?? WARD_TAT_RULES["Other"] ?? 12;
}

function getTatStatus(ageHours, targetHours) {
  const diff = targetHours - ageHours;

  if (diff >= 2) {
    return {
      label: "Within TAT",
      overdue: false,
      text: `${formatHours(diff)} remaining`
    };
  }

  if (diff >= 0) {
    return {
      label: "Near breach",
      overdue: false,
      text: `${formatHours(diff)} remaining`
    };
  }

  return {
    label: "Overdue",
    overdue: true,
    text: `${formatHours(Math.abs(diff))} overdue`
  };
}

function makeSampleKey(visitNumber, test, collectionDate) {
  const datePart = collectionDate
    ? collectionDate.toISOString().slice(0, 10)
    : "";

  return [
    String(visitNumber || "").trim().toUpperCase(),
    String(test || "").trim().toUpperCase(),
    datePart
  ].join("||");
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[ch]));
}

async function getSavedComments() {
  if (BACKEND_URL) {
    try {
      const response = await fetch(`${BACKEND_URL}/comments`);
      if (response.ok) return await response.json();
    } catch (e) {
      console.warn("Backend comments failed, falling back to localStorage", e);
    }
  }

  try {
    return JSON.parse(localStorage.getItem("otlComments") || "{}");
  } catch {
    return {};
  }
}

async function saveComment(sampleKey, payload) {
  if (BACKEND_URL) {
    try {
      await fetch(`${BACKEND_URL}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sampleKey,
          ...payload
        })
      });
      return;
    } catch (e) {
      console.warn("Backend save failed, falling back to localStorage", e);
    }
  }

  const comments = JSON.parse(localStorage.getItem("otlComments") || "{}");
  comments[sampleKey] = payload;
  localStorage.setItem("otlComments", JSON.stringify(comments));
}

async function saveTatSnapshot(rows) {
  const extractTime = new Date().toISOString();

  const snapshot = {
    extractTime,
    count: rows.length,
    rows: rows.map(r => ({
      sampleKey: r.sampleKey,
      visitNumber: r.visitNumber,
      patientName: r.patientName,
      location: r.location,
      wardGroup: r.wardGroup,
      test: r.test,
      ageHours: Number(r.ageHours.toFixed(2)),
      targetHours: r.targetHours,
      tatLabel: r.tatLabel,
      techStatus: r.techStatus
    }))
  };

  if (BACKEND_URL) {
    try {
      await fetch(`${BACKEND_URL}/tat-snapshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(snapshot)
      });
    } catch (e) {
      console.warn("Backend TAT snapshot failed", e);
    }
  }

  const history = JSON.parse(localStorage.getItem("otlTatHistory") || "[]");
  history.push(snapshot);
  localStorage.setItem("otlTatHistory", JSON.stringify(history.slice(-50)));
  localStorage.setItem("otlLastExtractTime", extractTime);
}

async function prepareRows(rows, sourceFile) {
  const comments = await getSavedComments();

  return rows.map(row => {
    const visitNumber = getValue(row, COLUMN_ALIASES.visitNumber);
    const patientName = getValue(row, COLUMN_ALIASES.patientName);
    const location = getValue(row, COLUMN_ALIASES.location);
    const test = getValue(row, COLUMN_ALIASES.tests);
    const specimenType = getValue(row, COLUMN_ALIASES.specimenType);
    const collectionDate = parseDate(getValue(row, COLUMN_ALIASES.collectionDate));
    const registrationDate = parseDate(getValue(row, COLUMN_ALIASES.registrationDate));
    const inLabDate = parseDate(getValue(row, COLUMN_ALIASES.inLabDate));
    const storagePositions = getValue(row, COLUMN_ALIASES.storagePositions);
    const referralStatus = getValue(row, COLUMN_ALIASES.referralStatus);
    const alternativeReference = getValue(row, COLUMN_ALIASES.alternativeReference);
    const internalReference = getValue(row, COLUMN_ALIASES.internalReference);
    const hospital = getValue(row, COLUMN_ALIASES.hospital);

    const tatStart = inLabDate || registrationDate || collectionDate;

    if (!visitNumber || !location || !test || !tatStart) return null;

    const ageHours = hoursSince(tatStart);
    if (!Number.isFinite(ageHours) || ageHours < 0 || ageHours > 24 * 90) return null;

    const wardGroup = assignWardGroup(location);
    const targetHours = getTatTargetHours(wardGroup);
    const tatStatus = getTatStatus(ageHours, targetHours);

    const sampleKey = makeSampleKey(visitNumber, test, collectionDate || registrationDate || inLabDate);
    const saved = comments[sampleKey] || {};

    return {
      sampleKey,
      visitNumber: String(visitNumber || "").trim(),
      patientName: String(patientName || "").trim(),
      hospital: String(hospital || "").trim(),
      location: String(location || "").trim(),
      wardGroup,
      test: String(test || "").trim(),
      specimenType: String(specimenType || "").trim(),
      collectionDate,
      registrationDate,
      inLabDate,
      tatStart,
      tatStartDisplay: tatStart.toLocaleString(),
      ageHours,
      ageBucket: assignAgeBucket(ageHours),
      targetHours,
      tatLabel: tatStatus.label,
      tatText: tatStatus.text,
      overdue: tatStatus.overdue,
      storagePositions: String(storagePositions || "").trim(),
      referralStatus: String(referralStatus || "").trim(),
      alternativeReference: String(alternativeReference || "").trim(),
      internalReference: String(internalReference || "").trim(),
      sourceFile,
      techStatus: saved.techStatus || "Not located",
      comment: saved.comment || "",
      commentUpdatedAt: saved.updatedAt || ""
    };
  }).filter(Boolean);
}

function safeContains(value, query) {
  if (!query) return true;
  return String(value || "").toLowerCase().includes(query.toLowerCase());
}

function setMetric(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function populateWardFilter() {
  const select = document.getElementById("wardGroupFilter");
  const current = select.value;
  const groups = [...new Set(currentRows.map(r => r.wardGroup))].sort();

  select.innerHTML = '<option value="">All Ward Sections</option>';

  groups.forEach(group => {
    const opt = document.createElement("option");
    opt.value = group;
    opt.textContent = group;
    select.appendChild(opt);
  });

  if (groups.includes(current)) select.value = current;
}

function applyFilters() {
  const wardGroup = document.getElementById("wardGroupFilter").value;
  const age = document.getElementById("ageFilter").value;
  const status = document.getElementById("statusFilter").value;
  const wardText = document.getElementById("wardTextFilter").value.trim();
  const testText = document.getElementById("testTextFilter").value.trim();
  const episodeText = document.getElementById("episodeTextFilter").value.trim();

  filteredRows = currentRows.filter(r =>
    (!wardGroup || r.wardGroup === wardGroup) &&
    (!age || r.ageBucket === age) &&
    (!status || r.techStatus === status) &&
    safeContains(r.location, wardText) &&
    safeContains(r.test, testText) &&
    safeContains(r.visitNumber, episodeText)
  );

  renderDashboard();
}

function groupCount(rows, field) {
  const counts = {};
  rows.forEach(r => {
    counts[r[field]] = (counts[r[field]] || 0) + 1;
  });
  return counts;
}

function updateCharts(rows) {
  const wardCounts = groupCount(rows, "wardGroup");

  const ageCounts = {};
  AGE_BUCKETS.forEach(b => {
    ageCounts[b] = rows.filter(r => r.ageBucket === b).length;
  });

  const wardCanvas = document.getElementById("wardChart");
  if (wardCanvas) {
    const wardCtx = wardCanvas.getContext("2d");
    if (wardChart) wardChart.destroy();

    wardChart = new Chart(wardCtx, {
      type: "bar",
      data: {
        labels: Object.keys(wardCounts),
        datasets: [{
          label: "Current OTL rows",
          data: Object.values(wardCounts)
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }

  const ageCanvas = document.getElementById("ageChart");
  if (ageCanvas) {
    const ageCtx = ageCanvas.getContext("2d");
    if (ageChart) ageChart.destroy();

    ageChart = new Chart(ageCtx, {
      type: "bar",
      data: {
        labels: Object.keys(ageCounts),
        datasets: [{
          label: "Current OTL rows",
          data: Object.values(ageCounts)
        }]
      },
      options: {
        responsive: true,
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });
  }
}

function updateSummaryTable(rows) {
  const tbody = document.querySelector("#summaryTable tbody");
  tbody.innerHTML = "";

  const groups = [...new Set(rows.map(r => r.wardGroup))].sort();

  groups.forEach(group => {
    const g = rows.filter(r => r.wardGroup === group);
    const tr = document.createElement("tr");

    const values = [
      group,
      g.length,
      ...AGE_BUCKETS.map(b => g.filter(r => r.ageBucket === b).length),
      g.filter(r => ["Located in lab", "With section", "Resolved"].includes(r.techStatus)).length,
      g.filter(r => r.techStatus === "Problem sample").length
    ];

    values.forEach(v => {
      const td = document.createElement("td");
      td.textContent = v;
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function ageBadge(row) {
  let cls = "";

  if (row.overdue) cls = "old";
  else if (row.tatLabel === "Near breach") cls = "warn";

  return `
    <span class="age-badge ${cls}">
      ${formatHours(row.ageHours)}
      <br>
      <small>${escapeHTML(row.tatText)}</small>
    </span>
  `;
}

function renderTable(rows) {
  const tbody = document.querySelector("#otlTable tbody");
  tbody.innerHTML = "";

  const sorted = [...rows].sort((a, b) => b.ageHours - a.ageHours);

  sorted.forEach(row => {
    const tr = document.createElement("tr");
    tr.dataset.sampleKey = row.sampleKey;

    const statusOptions = STATUS_OPTIONS.map(s =>
      `<option value="${escapeHTML(s)}" ${s === row.techStatus ? "selected" : ""}>${escapeHTML(s)}</option>`
    ).join("");

    tr.innerHTML = `
      <td>${ageBadge(row)}</td>

      <td>
        <strong>${escapeHTML(row.visitNumber)}</strong>
        <br>
        <span class="small-text">${escapeHTML(row.patientName)}</span>
      </td>

      <td>
        ${escapeHTML(row.location)}
        <br>
        <span class="small-text">${escapeHTML(row.wardGroup)} | Target ${row.targetHours} h</span>
      </td>

      <td>
        ${escapeHTML(row.test)}
        <br>
        <span class="small-text">${escapeHTML(row.specimenType)}</span>
      </td>

      <td>
        ${escapeHTML(row.tatStartDisplay)}
        <br>
        <span class="small-text">Using ${row.inLabDate ? "In Lab Date" : row.registrationDate ? "Registration Date" : "Collection Date"}</span>
      </td>

      <td>
        <strong>${escapeHTML(row.referralStatus || "On OTL")}</strong>
        <br>
        <span class="small-text">${escapeHTML(row.storagePositions || "No storage position listed")}</span>
      </td>

      <td>
        <select class="row-status">
          ${statusOptions}
        </select>
      </td>

      <td>
        <textarea class="row-comment">${escapeHTML(row.comment)}</textarea>
      </td>

      <td>
        <button class="small save-row-btn">Save</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  document.querySelectorAll(".save-row-btn").forEach(btn => {
    btn.addEventListener("click", async event => {
      const tr = event.target.closest("tr");
      const sampleKey = tr.dataset.sampleKey;
      const techStatus = tr.querySelector(".row-status").value;
      const comment = tr.querySelector(".row-comment").value;

      await saveRowComment(sampleKey, techStatus, comment);
    });
  });
}

async function saveRowComment(sampleKey, techStatus, comment) {
  const payload = {
    techStatus,
    comment,
    updatedAt: new Date().toISOString()
  };

  await saveComment(sampleKey, payload);

  currentRows = currentRows.map(r =>
    r.sampleKey === sampleKey
      ? {
          ...r,
          techStatus,
          comment,
          commentUpdatedAt: payload.updatedAt
        }
      : r
  );

  applyFilters();
}

function updateInterpretation(rows) {
  const el = document.getElementById("interpretationBox");

  if (!rows.length) {
    el.textContent = "No current OTL rows match the filter.";
    return;
  }

  const worst = [...rows].sort((a, b) => b.ageHours - a.ageHours)[0];
  const overdue = rows.filter(r => r.overdue).length;
  const near = rows.filter(r => r.tatLabel === "Near breach").length;
  const over24 = rows.filter(r => r.ageHours >= 24).length;
  const problem = rows.filter(r => r.techStatus === "Problem sample").length;

  el.innerHTML = `
    There are <strong>${rows.length}</strong> current OTL row(s) in this view.
    <strong>${overdue}</strong> are overdue based on their ward-specific TAT target,
    <strong>${near}</strong> are near breach and
    <strong>${over24}</strong> are older than 24 hours.
    <br><br>
    The oldest item is <strong>${escapeHTML(worst.test)}</strong>
    from <strong>${escapeHTML(worst.location)}</strong>,
    received <strong>${formatHours(worst.ageHours)}</strong> ago.
    Its target is <strong>${worst.targetHours} h</strong>
    and it is currently <strong>${escapeHTML(worst.tatText)}</strong>.
    <br><br>
    <strong>${problem}</strong> item(s) are currently marked as problem samples.
  `;
}

function renderDashboard() {
  const rows = filteredRows;

  setMetric("rowsMetric", rows.length.toLocaleString());
  setMetric("episodesMetric", new Set(rows.map(r => r.visitNumber)).size.toLocaleString());
  setMetric("medianAgeMetric", formatHours(median(rows.map(r => r.ageHours))));
  setMetric("over24Metric", rows.filter(r => r.ageHours >= 24).length.toLocaleString());
  setMetric("locatedMetric", rows.filter(r => ["Located in lab", "With section", "Resolved"].includes(r.techStatus)).length.toLocaleString());
  setMetric("notLocatedMetric", rows.filter(r => r.techStatus === "Not located").length.toLocaleString());
  setMetric("problemMetric", rows.filter(r => r.techStatus === "Problem sample").length.toLocaleString());

  const last = localStorage.getItem("otlLastExtractTime");
  setMetric("extractTimeMetric", last ? new Date(last).toLocaleString() : "-");

  updateCharts(rows);
  updateSummaryTable(rows);
  renderTable(rows);
  updateInterpretation(rows);
}

function toCSV(rows) {
  const headers = [
    "age_hours",
    "tat_target_hours",
    "tat_status",
    "tat_text",
    "age_bucket",
    "visit_number",
    "patient_name",
    "hospital",
    "location",
    "ward_group",
    "test",
    "specimen_type",
    "tat_start",
    "referral_status",
    "storage_positions",
    "tech_status",
    "comment",
    "comment_updated_at",
    "alternative_reference",
    "internal_reference",
    "source_file"
  ];

  const lines = [headers.join(",")];

  rows.forEach(r => {
    const values = [
      r.ageHours.toFixed(2),
      r.targetHours,
      r.tatLabel,
      r.tatText,
      r.ageBucket,
      r.visitNumber,
      r.patientName,
      r.hospital,
      r.location,
      r.wardGroup,
      r.test,
      r.specimenType,
      r.tatStartDisplay,
      r.referralStatus,
      r.storagePositions,
      r.techStatus,
      r.comment,
      r.commentUpdatedAt,
      r.alternativeReference,
      r.internalReference,
      r.sourceFile
    ];

    lines.push(values.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  });

  return lines.join("\n");
}

function downloadCSV(rows, filename) {
  const blob = new Blob([toCSV(rows)], {
    type: "text/csv;charset=utf-8"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = filename;
  a.click();

  URL.revokeObjectURL(url);
}

document.getElementById("otlFiles").addEventListener("change", async event => {
  const files = [...event.target.files];
  if (!files.length) return;

  const all = [];

  for (const file of files) {
    const raw = await readFile(file);
    const prepared = await prepareRows(raw, file.name);
    all.push(...prepared);
  }

  const deduped = new Map();

  all.forEach(row => {
    deduped.set(row.sampleKey, row);
  });

  currentRows = [...deduped.values()];

  await saveTatSnapshot(currentRows);

  populateWardFilter();

  filteredRows = [...currentRows];

  renderDashboard();
});

document.getElementById("applyFilterBtn").addEventListener("click", applyFilters);

document.getElementById("clearFilterBtn").addEventListener("click", () => {
  ["wardGroupFilter", "ageFilter", "statusFilter"].forEach(id => {
    document.getElementById(id).value = "";
  });

  ["wardTextFilter", "testTextFilter", "episodeTextFilter"].forEach(id => {
    document.getElementById(id).value = "";
  });

  filteredRows = [...currentRows];

  renderDashboard();
});

document.getElementById("exportCurrentBtn").addEventListener("click", () => {
  downloadCSV(currentRows, "current_combined_otl.csv");
});

document.getElementById("exportViewBtn").addEventListener("click", () => {
  downloadCSV(filteredRows, "filtered_otl_view.csv");
});

[
  "wardGroupFilter",
  "ageFilter",
  "statusFilter",
  "wardTextFilter",
  "testTextFilter",
  "episodeTextFilter"
].forEach(id => {
  const el = document.getElementById(id);

  el.addEventListener("change", applyFilters);

  el.addEventListener("keyup", event => {
    if (event.key === "Enter") applyFilters();
  });
});
