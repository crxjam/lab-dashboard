let rawEpisodes = [];
let arrivalChart = null;
let tatChart = null;

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
    if (ch === '"' && line[i + 1] === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out;
}

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d) ? null : d;
}

function num(value) {
  const x = Number(value);
  return Number.isFinite(x) ? x : null;
}

function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function quantile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (s[base + 1] !== undefined) return s[base] + rest * (s[base + 1] - s[base]);
  return s[base];
}

function mean(arr) {
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
}

function formatMin(v) {
  return v == null ? "-" : `${v.toFixed(1)} min`;
}

function setMetric(id, value) {
  document.getElementById(id).textContent = value;
}

function prepareEpisodes(rows) {
  return rows.map(r => {
    const prefix = r.episode_prefix || ((r["Episode Number"] || "").match(/^([A-Z]+)/) || [null, ""])[1];
    return {
      episode: r["Episode Number"],
      prefix,
      collection_datetime: parseDate(r.collection_datetime),
      registration_datetime: parseDate(r.registration_datetime),
      entered_datetime: parseDate(r.entered_datetime),
      authorised_datetime: parseDate(r.authorised_datetime),
      model_start_datetime: parseDate(r.model_start_datetime),
      collection_to_authorised_min: num(r.collection_to_authorised_min),
      collection_to_model_start_min: num(r.collection_to_model_start_min),
      model_start_to_authorised_min: num(r.model_start_to_authorised_min)
    };
  }).filter(r => r.episode);
}

function hourlyPattern(episodes) {
  const byDayHour = {};
  episodes.forEach(ep => {
    const dt = ep.model_start_datetime || ep.collection_datetime;
    if (!dt) return;
    const day = dt.toISOString().slice(0, 10);
    const hour = dt.getHours();
    const key = `${day}_${hour}`;
    byDayHour[key] = (byDayHour[key] || 0) + 1;
  });

  const hourMap = {};
  Object.entries(byDayHour).forEach(([key, count]) => {
    const hour = Number(key.split("_")[1]);
    if (!hourMap[hour]) hourMap[hour] = [];
    hourMap[hour].push(count);
  });

  const out = [];
  for (let h = 0; h < 24; h++) {
    out.push(mean(hourMap[h] || []) || 0);
  }
  return out;
}

function rng(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function() {
    s = s * 16807 % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function randNormal(rand, mean, sd) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return mean + z * sd;
}

function simulateDay(hourlyArrivals, preMean, processMean, postMean, intakeStaff, processStaff, authStaff, volumeMultiplier, extraPreDelay, seed) {
  const random = rng(seed);
  const intakeFree = new Array(Math.max(1, intakeStaff)).fill(0);
  const processFree = new Array(Math.max(1, processStaff)).fill(0);
  const authFree = new Array(Math.max(1, authStaff)).fill(0);
  const rows = [];

  function serviceTime(meanVal) {
    const sd = Math.max(meanVal * 0.25, 0.5);
    return Math.max(0.5, randNormal(random, meanVal, sd));
  }

  for (let hour = 0; hour < 24; hour++) {
    const n = Math.round((hourlyArrivals[hour] || 0) * volumeMultiplier);
    if (n <= 0) continue;
    const arrivals = [];
    for (let i = 0; i < n; i++) {
      arrivals.push(hour * 60 + random() * 60);
    }
    arrivals.sort((a, b) => a - b);

    arrivals.forEach(a => {
      const pre = Math.max(0.5, randNormal(random, preMean + extraPreDelay, Math.max(preMean * 0.25, 0.5)));
      const enter = a + pre;

      let i = intakeFree.indexOf(Math.min(...intakeFree));
      const regStart = Math.max(enter, intakeFree[i]);
      const regEnd = regStart + serviceTime(1.0);
      intakeFree[i] = regEnd;

      let j = processFree.indexOf(Math.min(...processFree));
      const procStart = Math.max(regEnd, processFree[j]);
      const procEnd = procStart + serviceTime(processMean);
      processFree[j] = procEnd;

      let k = authFree.indexOf(Math.min(...authFree));
      const authStart = Math.max(procEnd, authFree[k]);
      const authEnd = authStart + serviceTime(postMean);
      authFree[k] = authEnd;

      rows.push({
        tat_min: authEnd - a,
        system_tat_min: authEnd - enter,
        pre_delay_min: pre,
        intake_wait_min: regStart - enter,
        processing_wait_min: procStart - regEnd,
        auth_wait_min: authStart - procEnd
      });
    });
  }
  return rows;
}

function histogram(values, bins = 35) {
  if (!values.length) return { labels: [], counts: [] };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = (max - min || 1) / bins;
  const counts = new Array(bins).fill(0);
  const labels = [];
  for (let i = 0; i < bins; i++) labels.push((min + i * width).toFixed(0));
  values.forEach(v => {
    const idx = Math.min(bins - 1, Math.floor((v - min) / width));
    counts[idx]++;
  });
  return { labels, counts };
}

function updateCharts(arrivals, baselineRows, scenarioRows) {
  const arrivalCtx = document.getElementById("arrivalChart").getContext("2d");
  if (arrivalChart) arrivalChart.destroy();
  arrivalChart = new Chart(arrivalCtx, {
    type: "bar",
    data: {
      labels: [...Array(24).keys()],
      datasets: [{ label: "Average episodes", data: arrivals }]
    },
    options: { responsive: true, plugins: { legend: { display: false } } }
  });

  const baseHist = histogram(baselineRows.map(r => r.tat_min));
  const scenHist = histogram(scenarioRows.map(r => r.tat_min));
  const tatCtx = document.getElementById("tatChart").getContext("2d");
  if (tatChart) tatChart.destroy();
  tatChart = new Chart(tatCtx, {
    type: "line",
    data: {
      labels: baseHist.labels,
      datasets: [
        { label: "Baseline", data: baseHist.counts, tension: 0.2 },
        { label: "Scenario", data: scenHist.counts, tension: 0.2 }
      ]
    },
    options: { responsive: true }
  });
}

function updateWaitTable(baselineRows, scenarioRows) {
  const tbody = document.querySelector("#waitTable tbody");
  tbody.innerHTML = "";
  const data = [
    ["Pre-analytical", mean(baselineRows.map(r => r.pre_delay_min)), mean(scenarioRows.map(r => r.pre_delay_min))],
    ["Intake queue", mean(baselineRows.map(r => r.intake_wait_min)), mean(scenarioRows.map(r => r.intake_wait_min))],
    ["Processing queue", mean(baselineRows.map(r => r.processing_wait_min)), mean(scenarioRows.map(r => r.processing_wait_min))],
    ["Authorisation queue", mean(baselineRows.map(r => r.auth_wait_min)), mean(scenarioRows.map(r => r.auth_wait_min))]
  ];
  data.forEach(row => {
    const tr = document.createElement("tr");
    row.forEach((cell, idx) => {
      const td = document.createElement("td");
      td.textContent = idx === 0 ? cell : (cell == null ? "-" : cell.toFixed(1));
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

function runSimulation() {
  if (!rawEpisodes.length) {
    alert("Upload the cleaned episode-level CSV first, or load the bundled sample.");
    return;
  }

  const includeSAM = document.getElementById("includeSAM").checked;
  const modelEpisodes = rawEpisodes.filter(ep => includeSAM || ep.prefix !== "SAM");
  const arrivals = hourlyPattern(modelEpisodes);

  const observedTat = modelEpisodes.map(r => r.collection_to_authorised_min).filter(v => v != null && v >= 0);
  const samCount = rawEpisodes.filter(r => r.prefix === "SAM").length;

  setMetric("episodesMetric", modelEpisodes.length.toLocaleString());
  setMetric("observedMedianMetric", formatMin(median(observedTat)));
  setMetric("observedP90Metric", formatMin(quantile(observedTat, 0.9)));
  setMetric("samMetric", samCount.toLocaleString());

  const preMean = Number(document.getElementById("baselinePre").value);
  const processMean = Number(document.getElementById("baselineProcess").value);
  const postMean = Number(document.getElementById("baselinePost").value);
  const volumeMultiplier = Number(document.getElementById("volumeMultiplier").value);
  const extraPreDelay = Number(document.getElementById("extraDelay").value);
  const intakeStaff = Number(document.getElementById("intakeStaff").value);
  const processStaff = Number(document.getElementById("processingStaff").value);
  const authStaff = Number(document.getElementById("authStaff").value);
  const targetTat = Number(document.getElementById("targetTat").value);

  const derivedPre = median(modelEpisodes.map(r => r.collection_to_model_start_min).filter(v => v != null && v >= 0));
  const derivedProcess = median(modelEpisodes.map(r => r.model_start_to_authorised_min).filter(v => v != null && v >= 0));
  if (derivedPre != null && document.getElementById("baselinePre").dataset.touched !== "yes") document.getElementById("baselinePre").value = derivedPre.toFixed(1);
  if (derivedProcess != null && document.getElementById("baselineProcess").dataset.touched !== "yes") document.getElementById("baselineProcess").value = derivedProcess.toFixed(1);

  const baselineRows = simulateDay(arrivals, Number(document.getElementById("baselinePre").value), Number(document.getElementById("baselineProcess").value), postMean, 2, 2, 1, 1.0, 0, 42);
  const scenarioRows = simulateDay(arrivals, Number(document.getElementById("baselinePre").value), Number(document.getElementById("baselineProcess").value), postMean, intakeStaff, processStaff, authStaff, volumeMultiplier, extraPreDelay, 42);

  setMetric("scenarioMedianMetric", formatMin(median(scenarioRows.map(r => r.tat_min))));
  setMetric("scenarioP90Metric", formatMin(quantile(scenarioRows.map(r => r.tat_min), 0.9)));
  setMetric("withinTargetMetric", `${((scenarioRows.filter(r => r.tat_min <= targetTat).length / scenarioRows.length) * 100 || 0).toFixed(1)}%`);
  setMetric("systemTatMetric", formatMin(median(scenarioRows.map(r => r.system_tat_min))));

  updateCharts(arrivals, baselineRows, scenarioRows);
  updateWaitTable(baselineRows, scenarioRows);
}

document.getElementById("csvFile").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const text = await file.text();
  rawEpisodes = prepareEpisodes(parseCSV(text));
  runSimulation();
});

document.getElementById("loadSampleBtn").addEventListener("click", async () => {
  const response = await fetch("c15_episode_level_for_dashboard.csv");
  const text = await response.text();
  rawEpisodes = prepareEpisodes(parseCSV(text));
  runSimulation();
});

document.getElementById("runBtn").addEventListener("click", runSimulation);

["volumeMultiplier","extraDelay","intakeStaff","processingStaff","authStaff","targetTat"].forEach(id => {
  const input = document.getElementById(id);
  const labelId = {
    volumeMultiplier: "volumeValue",
    extraDelay: "extraDelayValue",
    intakeStaff: "intakeStaffValue",
    processingStaff: "processingStaffValue",
    authStaff: "authStaffValue",
    targetTat: "targetTatValue"
  }[id];
  const label = document.getElementById(labelId);
  const update = () => label.textContent = input.value;
  input.addEventListener("input", update);
  update();
});

["baselinePre","baselineProcess","baselinePost"].forEach(id => {
  document.getElementById(id).addEventListener("input", (e) => {
    e.target.dataset.touched = "yes";
  });
});
