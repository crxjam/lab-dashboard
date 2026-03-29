let rawRows = [];
let filteredRows = [];
let cdfChart = null;
let stageChart = null;
let metricChart = null;

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = splitCSVLine(lines[0]);
  return lines.slice(1).filter(Boolean).map(line => {
    const values = splitCSVLine(line);
    const obj = {};
    headers.forEach((h, i) => obj[h] = values[i] ?? "");
    return obj;
  });
}
function splitCSVLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { out.push(current); current = ""; }
    else { current += ch; }
  }
  out.push(current);
  return out;
}
function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}
function numMinutes(ms) { return ms / 60000; }
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  return s[base + 1] !== undefined ? s[base] + rest * (s[base + 1] - s[base]) : s[base];
}
function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}
function formatDuration(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return "-";
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value.toFixed(1)}%`;
}
function setMetric(id, value) {
  document.getElementById(id).textContent = value;
}
function toHours(minutes) {
  return minutes / 60;
}
function safeContains(value, query) {
  if (!query) return true;
  return String(value || "").toLowerCase().includes(query.toLowerCase());
}

function prepareRows(rows) {
  return rows.map(r => {
    const prefix = ((r["Episode Number"] || "").match(/^([A-Z]+)/) || [null, ""])[1];
    const collection = parseDate(`${r["Collection Date"] || ""} ${r["Collection Time"] || ""}`);
    const registration = parseDate(`${r["Registration Date"] || ""} ${r["Registration Time"] || ""}`);
    const authorised = parseDate(`${r["Authorised Date"] || ""} ${r["Authorised Time"] || ""}`);
    if (!collection || !registration || !authorised) return null;
    const totalTat = numMinutes(authorised - collection);
    const pre = numMinutes(registration - collection);
    const inSystem = numMinutes(authorised - registration);
    if (![totalTat, pre, inSystem].every(v => Number.isFinite(v))) return null;
    if (totalTat < 0 || totalTat > 60 * 24 * 14) return null;
    if (pre < 0 || inSystem < 0) return null;

    return {
      episode: r["Episode Number"],
      prefix,
      hospital: r["Hospital"],
      ward: r["Ward"],
      test: r["Test Set Description"] || r["Test Item Description"] || "Unknown",
      totalTat,
      pre,
      inSystem
    };
  }).filter(Boolean);
}

function populateTestSelect(rows) {
  const select = document.getElementById("testSelect");
  const tests = [...new Set(rows.filter(r => r.prefix === "SA").map(r => r.test))].sort((a, b) => a.localeCompare(b));
  select.innerHTML = "";
  tests.forEach(test => {
    const opt = document.createElement("option");
    opt.value = test;
    opt.textContent = test;
    select.appendChild(opt);
  });
}

function applyFilters() {
  const test = document.getElementById("testSelect").value;
  const ward = document.getElementById("wardFilter").value.trim();
  const hospital = document.getElementById("hospitalFilter").value.trim();

  filteredRows = rawRows.filter(r =>
    r.prefix === "SA" &&
    r.test === test &&
    safeContains(r.ward, ward) &&
    safeContains(r.hospital, hospital)
  );
  runModel();
}

function scenarioTatRows(rows) {
  const baselineIntake = Number(document.getElementById("baselineIntakeStaff").value);
  const baselineProcessing = Number(document.getElementById("baselineProcessingStaff").value);
  const baselineAuth = Number(document.getElementById("baselineAuthStaff").value);

  const scenarioIntake = Number(document.getElementById("intakeStaff").value);
  const scenarioProcessing = Number(document.getElementById("processingStaff").value);
  const scenarioAuth = Number(document.getElementById("authStaff").value);

  const volumeMultiplier = Number(document.getElementById("volumeMultiplier").value);
  const extraDelay = Number(document.getElementById("extraDelay").value);

  const intakeFactor = Math.pow((volumeMultiplier * baselineIntake) / scenarioIntake, 1.15);
  const processingFactor = Math.pow((volumeMultiplier * baselineProcessing) / scenarioProcessing, 1.35);
  const authFactor = Math.pow((volumeMultiplier * baselineAuth) / scenarioAuth, 1.10);

  return rows.map(r => {
    const preBase = r.pre;
    const processBase = r.inSystem * 0.85;
    const authBase = r.inSystem * 0.15;

    const preScenario = Math.max(0, preBase + extraDelay) * Math.max(1, intakeFactor);
    const processScenario = processBase * Math.max(1, processingFactor);
    const authScenario = authBase * Math.max(1, authFactor);

    return {
      baselineTat: r.totalTat,
      scenarioTat: preScenario + processScenario + authScenario,
      baselinePre: preBase,
      scenarioPre: preScenario,
      baselineProcess: processBase,
      scenarioProcess: processScenario,
      baselineAuth: authBase,
      scenarioAuth: authScenario
    };
  });
}

function cdfSeries(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    x: sorted.map(v => +(v / 60).toFixed(2)),
    y: sorted.map((_, i) => +(((i + 1) / sorted.length) * 100).toFixed(1))
  };
}

function updateCdfChart(baselineValues, scenarioValues) {
  const base = cdfSeries(baselineValues);
  const scen = cdfSeries(scenarioValues);
  const ctx = document.getElementById("cdfChart").getContext("2d");
  if (cdfChart) cdfChart.destroy();
  cdfChart = new Chart(ctx, {
    type: "line",
    data: {
      datasets: [
        {
          label: "Observed baseline",
          data: base.x.map((x, i) => ({ x, y: base.y[i] })),
          borderColor: "rgba(37,99,235,1)",
          backgroundColor: "rgba(37,99,235,0.15)",
          pointRadius: 0,
          tension: 0.08
        },
        {
          label: "Scenario",
          data: scen.x.map((x, i) => ({ x, y: scen.y[i] })),
          borderColor: "rgba(244,63,94,1)",
          backgroundColor: "rgba(244,63,94,0.12)",
          pointRadius: 0,
          tension: 0.08
        }
      ]
    },
    options: {
      responsive: true,
      parsing: false,
      scales: {
        x: { type: "linear", title: { display: true, text: "Total TAT (hours)" } },
        y: { title: { display: true, text: "Results completed (%)" }, min: 0, max: 100 }
      }
    }
  });
}

function updateStageChart(stageSummary) {
  const ctx = document.getElementById("stageChart").getContext("2d");
  if (stageChart) stageChart.destroy();
  stageChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Transport / pre-analytical", "Laboratory processing", "Authorisation"],
      datasets: [
        {
          label: "Observed baseline",
          data: [stageSummary.baselinePre, stageSummary.baselineProcess, stageSummary.baselineAuth],
          backgroundColor: "rgba(59,130,246,0.7)"
        },
        {
          label: "Scenario",
          data: [stageSummary.scenarioPre, stageSummary.scenarioProcess, stageSummary.scenarioAuth],
          backgroundColor: "rgba(244,63,94,0.6)"
        }
      ]
    },
    options: {
      responsive: true,
      scales: { y: { title: { display: true, text: "Minutes" }, beginAtZero: true } }
    }
  });
}

function updateMetricChart(metricSummary) {
  const ctx = document.getElementById("metricChart").getContext("2d");
  if (metricChart) metricChart.destroy();
  metricChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: ["Median TAT (h)", "90th percentile TAT (h)", "% within target"],
      datasets: [
        {
          label: "Observed baseline",
          data: [metricSummary.baselineMedianH, metricSummary.baselineP90H, metricSummary.baselineWithin],
          backgroundColor: "rgba(59,130,246,0.7)"
        },
        {
          label: "Scenario",
          data: [metricSummary.scenarioMedianH, metricSummary.scenarioP90H, metricSummary.scenarioWithin],
          backgroundColor: "rgba(244,63,94,0.6)"
        }
      ]
    },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });
}

function updateSummaryTable(summary) {
  const tbody = document.querySelector("#summaryTable tbody");
  tbody.innerHTML = "";

  const rows = [
    ["Median total TAT", formatDuration(summary.baselineMedian), formatDuration(summary.scenarioMedian), formatDuration(summary.scenarioMedian - summary.baselineMedian)],
    ["90th percentile total TAT", formatDuration(summary.baselineP90), formatDuration(summary.scenarioP90), formatDuration(summary.scenarioP90 - summary.baselineP90)],
    ["% within target", formatPct(summary.baselineWithin), formatPct(summary.scenarioWithin), `${(summary.scenarioWithin - summary.baselineWithin).toFixed(1)} pp`],
  ];

  rows.forEach(r => {
    const tr = document.createElement("tr");
    r.forEach(val => {
      const td = document.createElement("td");
      td.textContent = val;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function updateInterpretation(summary, bottleneck, testName) {
  const el = document.getElementById("interpretationBox");
  const medianChangePct = summary.baselineMedian > 0 ? ((summary.scenarioMedian / summary.baselineMedian) - 1) * 100 : 0;
  const p90ChangePct = summary.baselineP90 > 0 ? ((summary.scenarioP90 / summary.baselineP90) - 1) * 100 : 0;

  el.innerHTML = `
    <strong>${testName}</strong><br>
    Under the selected scenario, median TAT changes from <strong>${formatDuration(summary.baselineMedian)}</strong> to <strong>${formatDuration(summary.scenarioMedian)}</strong> (${medianChangePct >= 0 ? "+" : ""}${medianChangePct.toFixed(1)}%).<br>
    The 90th percentile changes from <strong>${formatDuration(summary.baselineP90)}</strong> to <strong>${formatDuration(summary.scenarioP90)}</strong> (${p90ChangePct >= 0 ? "+" : ""}${p90ChangePct.toFixed(1)}%).<br>
    The main scenario bottleneck is <strong>${bottleneck}</strong>.<br>
    Baseline performance achieves <strong>${formatPct(summary.baselineWithin)}</strong> within target TAT versus <strong>${formatPct(summary.scenarioWithin)}</strong> under the selected disruption.
  `;
}

function runModel() {
  if (!filteredRows.length) {
    setMetric("rowsMetric", "-");
    setMetric("episodesMetric", "-");
    setMetric("observedMedianMetric", "-");
    setMetric("observedP90Metric", "-");
    setMetric("scenarioMedianMetric", "-");
    setMetric("scenarioP90Metric", "-");
    setMetric("withinTargetMetric", "-");
    setMetric("bottleneckMetric", "-");
    document.querySelector("#summaryTable tbody").innerHTML = "";
    document.getElementById("interpretationBox").textContent = "No rows match the current filter.";
    return;
  }

  const targetTat = Number(document.getElementById("targetTat").value);
  const scenarioRows = scenarioTatRows(filteredRows);

  const baselineTats = scenarioRows.map(r => r.baselineTat);
  const scenarioTats = scenarioRows.map(r => r.scenarioTat);

  const baselineMedian = median(baselineTats);
  const baselineP90 = quantile(baselineTats, 0.9);
  const scenarioMedian = median(scenarioTats);
  const scenarioP90 = quantile(scenarioTats, 0.9);
  const baselineWithin = (baselineTats.filter(v => v <= targetTat).length / baselineTats.length) * 100;
  const scenarioWithin = (scenarioTats.filter(v => v <= targetTat).length / scenarioTats.length) * 100;

  const stageSummary = {
    baselinePre: median(scenarioRows.map(r => r.baselinePre)),
    baselineProcess: median(scenarioRows.map(r => r.baselineProcess)),
    baselineAuth: median(scenarioRows.map(r => r.baselineAuth)),
    scenarioPre: median(scenarioRows.map(r => r.scenarioPre)),
    scenarioProcess: median(scenarioRows.map(r => r.scenarioProcess)),
    scenarioAuth: median(scenarioRows.map(r => r.scenarioAuth)),
  };

  const stagePairs = [
    ["Transport / pre-analytical delay", stageSummary.scenarioPre],
    ["Laboratory processing", stageSummary.scenarioProcess],
    ["Authorisation", stageSummary.scenarioAuth],
  ];
  stagePairs.sort((a, b) => b[1] - a[1]);
  const bottleneck = stagePairs[0][0];

  setMetric("rowsMetric", filteredRows.length.toLocaleString());
  setMetric("episodesMetric", new Set(filteredRows.map(r => r.episode)).size.toLocaleString());
  setMetric("observedMedianMetric", formatDuration(baselineMedian));
  setMetric("observedP90Metric", formatDuration(baselineP90));
  setMetric("scenarioMedianMetric", formatDuration(scenarioMedian));
  setMetric("scenarioP90Metric", formatDuration(scenarioP90));
  setMetric("withinTargetMetric", formatPct(scenarioWithin));
  setMetric("bottleneckMetric", bottleneck);

  const summary = { baselineMedian, baselineP90, scenarioMedian, scenarioP90, baselineWithin, scenarioWithin };
  updateSummaryTable(summary);
  updateCdfChart(baselineTats, scenarioTats);
  updateStageChart(stageSummary);
  updateMetricChart({
    baselineMedianH: +(baselineMedian / 60).toFixed(2),
    baselineP90H: +(baselineP90 / 60).toFixed(2),
    baselineWithin: +baselineWithin.toFixed(1),
    scenarioMedianH: +(scenarioMedian / 60).toFixed(2),
    scenarioP90H: +(scenarioP90 / 60).toFixed(2),
    scenarioWithin: +scenarioWithin.toFixed(1),
  });
  updateInterpretation(summary, bottleneck, document.getElementById("testSelect").value);
}

document.getElementById("csvFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  rawRows = prepareRows(parseCSV(text));
  populateTestSelect(rawRows);
  applyFilters();
});

document.getElementById("applyFilterBtn").addEventListener("click", applyFilters);
document.getElementById("runBtn").addEventListener("click", runModel);
document.getElementById("testSelect").addEventListener("change", applyFilters);

[
  ["volumeMultiplier","volumeValue",v=>Number(v).toFixed(1)],
  ["extraDelay","extraDelayValue",v=>`${v} min`],
  ["intakeStaff","intakeStaffValue",v=>v],
  ["processingStaff","processingStaffValue",v=>v],
  ["authStaff","authStaffValue",v=>v],
  ["targetTat","targetTatValue",v=>formatDuration(Number(v))],
  ["baselineIntakeStaff","baselineIntakeValue",v=>v],
  ["baselineProcessingStaff","baselineProcessingValue",v=>v],
  ["baselineAuthStaff","baselineAuthValue",v=>v]
].forEach(([id,labelId,formatter]) => {
  const input=document.getElementById(id), label=document.getElementById(labelId);
  const update=()=>label.textContent=formatter(input.value);
  input.addEventListener("input",update); update();
});
