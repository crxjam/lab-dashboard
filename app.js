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
  const out = []; let current = ""; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { current += '"'; i++; }
    else if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { out.push(current); current = ""; }
    else { current += ch; }
  }
  out.push(current); return out;
}
function parseDate(value) { if (!value) return null; const d = new Date(value); return isNaN(d) ? null : d; }
function num(value) { const x = Number(value); return Number.isFinite(x) ? x : null; }
function median(arr) { if (!arr.length) return null; const s = [...arr].sort((a,b)=>a-b); const m = Math.floor(s.length/2); return s.length % 2 ? s[m] : (s[m-1]+s[m])/2; }
function quantile(arr,q){ if(!arr.length) return null; const s=[...arr].sort((a,b)=>a-b); const pos=(s.length-1)*q; const base=Math.floor(pos); const rest=pos-base; return s[base+1]!==undefined ? s[base]+rest*(s[base+1]-s[base]) : s[base]; }
function mean(arr){ return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null; }
function formatDuration(minutes){ if(minutes==null || !Number.isFinite(minutes)) return "-"; const r=Math.round(minutes); const h=Math.floor(r/60); const m=r%60; if(h===0) return `${m} min`; if(m===0) return `${h} h`; return `${h} h ${m} min`; }
function setMetric(id, value){ document.getElementById(id).textContent = value; }

function prepareEpisodes(rows){
  return rows.map(r => {
    const prefix = r.episode_prefix || ((r["Episode Number"] || "").match(/^([A-Z]+)/) || [null, ""])[1];
    return {
      episode: r["Episode Number"], prefix,
      collection_datetime: parseDate(r.collection_datetime),
      model_start_datetime: parseDate(r.model_start_datetime),
      collection_to_authorised_min: num(r.collection_to_authorised_min),
      collection_to_model_start_min: num(r.collection_to_model_start_min),
      model_start_to_authorised_min: num(r.model_start_to_authorised_min)
    };
  }).filter(r => r.episode);
}
function hourlyPattern(episodes){
  const byDayHour = {};
  episodes.forEach(ep => {
    const dt = ep.model_start_datetime || ep.collection_datetime;
    if(!dt) return;
    const day = dt.toISOString().slice(0,10);
    const hour = dt.getHours();
    const key = `${day}_${hour}`;
    byDayHour[key] = (byDayHour[key] || 0) + 1;
  });
  const hourMap = {};
  Object.entries(byDayHour).forEach(([k,c]) => {
    const hour = Number(k.split("_")[1]);
    if(!hourMap[hour]) hourMap[hour] = [];
    hourMap[hour].push(c);
  });
  const out = [];
  for(let h=0; h<24; h++) out.push(mean(hourMap[h] || []) || 0);
  return out;
}
function rng(seed){ let s=seed%2147483647; if(s<=0) s+=2147483646; return function(){ s=s*16807%2147483647; return (s-1)/2147483646; }; }
function randNormal(rand, mean, sd){ let u=0,v=0; while(u===0) u=rand(); while(v===0) v=rand(); const z=Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); return mean + z*sd; }

function simulateDay(hourlyArrivals, preMean, processMean, postMean, intakeStaff, processStaff, authStaff, volumeMultiplier, extraPreDelay, seed) {
  const random=rng(seed);
  const intakeFree=new Array(Math.max(1,intakeStaff)).fill(0);
  const processFree=new Array(Math.max(1,processStaff)).fill(0);
  const authFree=new Array(Math.max(1,authStaff)).fill(0);
  const rows=[];
  function serviceTime(meanVal){ const sd=Math.max(meanVal*0.25,0.5); return Math.max(0.5, randNormal(random, meanVal, sd)); }
  for(let hour=0; hour<24; hour++){
    const n=Math.round((hourlyArrivals[hour]||0)*volumeMultiplier);
    if(n<=0) continue;
    const arrivals=[];
    for(let i=0;i<n;i++) arrivals.push(hour*60 + random()*60);
    arrivals.sort((a,b)=>a-b);
    arrivals.forEach(a => {
      const pre=Math.max(0.5, randNormal(random, preMean + extraPreDelay, Math.max(preMean*0.25,0.5)));
      const enter=a+pre;
      let i=intakeFree.indexOf(Math.min(...intakeFree));
      const regStart=Math.max(enter,intakeFree[i]);
      const regEnd=regStart+serviceTime(1.0);
      intakeFree[i]=regEnd;
      let j=processFree.indexOf(Math.min(...processFree));
      const procStart=Math.max(regEnd,processFree[j]);
      const procEnd=procStart+serviceTime(processMean);
      processFree[j]=procEnd;
      let k=authFree.indexOf(Math.min(...authFree));
      const authStart=Math.max(procEnd,authFree[k]);
      const authEnd=authStart+serviceTime(postMean);
      authFree[k]=authEnd;
      rows.push({
        tat_min: authEnd-a, system_tat_min: authEnd-enter,
        pre_delay_min: pre, intake_wait_min: regStart-enter,
        processing_wait_min: procStart-regEnd, auth_wait_min: authStart-procEnd
      });
    });
  }
  return rows;
}

function buildHistogram(values, binSize=60, maxMinutes=null){
  if(!values.length) return {labels:[], counts:[]};
  const maxVal = maxMinutes || Math.ceil(Math.max(...values)/binSize)*binSize;
  const bins = Math.max(1, Math.ceil(maxVal/binSize));
  const counts = new Array(bins).fill(0);
  const labels = [];
  for(let i=0;i<bins;i++){
    const start=i*binSize, end=start+binSize;
    labels.push(`${formatDuration(start)}–${formatDuration(end)}`);
  }
  values.forEach(v => { const idx=Math.min(bins-1, Math.floor(v/binSize)); counts[idx]++; });
  return {labels, counts};
}

function updateCharts(arrivals, baselineRows, scenarioRows){
  const arrivalCtx=document.getElementById("arrivalChart").getContext("2d");
  if(arrivalChart) arrivalChart.destroy();
  arrivalChart=new Chart(arrivalCtx,{
    type:"bar",
    data:{ labels:[...Array(24).keys()].map(h=>`${String(h).padStart(2,"0")}:00`),
      datasets:[{ label:"Average SA episodes arriving", data:arrivals, backgroundColor:"rgba(37,99,235,0.7)", borderColor:"rgba(37,99,235,1)", borderWidth:1 }]
    },
    options:{ responsive:true, scales:{ x:{ title:{display:true,text:"Hour of day"}}, y:{ title:{display:true,text:"Average number of episodes"}, beginAtZero:true } }, plugins:{ legend:{display:false} } }
  });

  const allTat=baselineRows.map(r=>r.tat_min).concat(scenarioRows.map(r=>r.tat_min));
  const maxTat=Math.ceil(Math.max(...allTat,240)/60)*60;
  const baseHist=buildHistogram(baselineRows.map(r=>r.tat_min),60,maxTat);
  const scenHist=buildHistogram(scenarioRows.map(r=>r.tat_min),60,maxTat);
  const tatCtx=document.getElementById("tatChart").getContext("2d");
  if(tatChart) tatChart.destroy();
  tatChart=new Chart(tatCtx,{
    type:"bar",
    data:{ labels:baseHist.labels, datasets:[
      { label:"Baseline", data:baseHist.counts, backgroundColor:"rgba(59,130,246,0.55)", borderColor:"rgba(59,130,246,1)", borderWidth:1 },
      { label:"Scenario", data:scenHist.counts, backgroundColor:"rgba(244,63,94,0.45)", borderColor:"rgba(244,63,94,1)", borderWidth:1 }
    ]},
    options:{ responsive:true, scales:{ x:{ title:{display:true,text:"Total TAT bucket"}}, y:{ title:{display:true,text:"Simulated number of episodes"}, beginAtZero:true } } }
  });
}

function interpretationBadge(minutes){
  if(minutes==null) return '<span class="badge">No data</span>';
  if(minutes < 30) return '<span class="badge good">Low queue</span>';
  if(minutes < 120) return '<span class="badge warn">Moderate queue</span>';
  return '<span class="badge bad">Heavy queue / overloaded</span>';
}
function updateWaitTable(baselineRows, scenarioRows){
  const tbody=document.querySelector("#waitTable tbody"); tbody.innerHTML="";
  const data=[
    ["Transport / pre-analytical delay", mean(baselineRows.map(r=>r.pre_delay_min)), mean(scenarioRows.map(r=>r.pre_delay_min))],
    ["Waiting for intake / registration", mean(baselineRows.map(r=>r.intake_wait_min)), mean(scenarioRows.map(r=>r.intake_wait_min))],
    ["Waiting for laboratory processing", mean(baselineRows.map(r=>r.processing_wait_min)), mean(scenarioRows.map(r=>r.processing_wait_min))],
    ["Waiting for authorisation", mean(baselineRows.map(r=>r.auth_wait_min)), mean(scenarioRows.map(r=>r.auth_wait_min))]
  ];
  data.forEach(row => {
    const tr=document.createElement("tr");
    [row[0], formatDuration(row[1]), formatDuration(row[2])].forEach(val => { const td=document.createElement("td"); td.textContent=val; tr.appendChild(td); });
    const td3=document.createElement("td"); td3.innerHTML=interpretationBadge(row[2]); tr.appendChild(td3);
    tbody.appendChild(tr);
  });
}

function runSimulation(){
  if(!rawEpisodes.length){ alert("Upload the cleaned episode-level CSV first, or load the bundled sample."); return; }
  const modelEpisodes=rawEpisodes.filter(ep=>ep.prefix!=="SAM");
  const arrivals=hourlyPattern(modelEpisodes);
  const observedTat=modelEpisodes.map(r=>r.collection_to_authorised_min).filter(v=>v!=null && v>=0);
  const samCount=rawEpisodes.filter(r=>r.prefix==="SAM").length;
  setMetric("episodesMetric", modelEpisodes.length.toLocaleString());
  setMetric("observedMedianMetric", formatDuration(median(observedTat)));
  setMetric("observedP90Metric", formatDuration(quantile(observedTat,0.9)));
  setMetric("samMetric", samCount.toLocaleString());

  const derivedPre=median(modelEpisodes.map(r=>r.collection_to_model_start_min).filter(v=>v!=null && v>=0));
  const derivedProcess=median(modelEpisodes.map(r=>r.model_start_to_authorised_min).filter(v=>v!=null && v>=0));
  if(derivedPre!=null && document.getElementById("baselinePre").dataset.touched!=="yes") document.getElementById("baselinePre").value=Math.round(derivedPre);
  if(derivedProcess!=null && document.getElementById("baselineProcess").dataset.touched!=="yes") document.getElementById("baselineProcess").value=Math.round(derivedProcess);

  const preMean=Number(document.getElementById("baselinePre").value);
  const processMean=Number(document.getElementById("baselineProcess").value);
  const postMean=Number(document.getElementById("baselinePost").value);
  const baselineIntake=Number(document.getElementById("baselineIntakeStaff").value);
  const baselineProcessing=Number(document.getElementById("baselineProcessingStaff").value);
  const baselineAuth=Number(document.getElementById("baselineAuthStaff").value);
  const volumeMultiplier=Number(document.getElementById("volumeMultiplier").value);
  const extraPreDelay=Number(document.getElementById("extraDelay").value);
  const intakeStaff=Number(document.getElementById("intakeStaff").value);
  const processStaff=Number(document.getElementById("processingStaff").value);
  const authStaff=Number(document.getElementById("authStaff").value);
  const targetTat=Number(document.getElementById("targetTat").value);

  const baselineRows=simulateDay(arrivals,preMean,processMean,postMean,baselineIntake,baselineProcessing,baselineAuth,1.0,0,42);
  const scenarioRows=simulateDay(arrivals,preMean,processMean,postMean,intakeStaff,processStaff,authStaff,volumeMultiplier,extraPreDelay,42);

  setMetric("scenarioMedianMetric", formatDuration(median(scenarioRows.map(r=>r.tat_min))));
  setMetric("scenarioP90Metric", formatDuration(quantile(scenarioRows.map(r=>r.tat_min),0.9)));
  setMetric("withinTargetMetric", `${((scenarioRows.filter(r=>r.tat_min<=targetTat).length / scenarioRows.length)*100 || 0).toFixed(1)}%`);
  setMetric("systemTatMetric", formatDuration(median(scenarioRows.map(r=>r.system_tat_min))));
  updateCharts(arrivals, baselineRows, scenarioRows);
  updateWaitTable(baselineRows, scenarioRows);
}

document.getElementById("csvFile").addEventListener("change", async (event) => {
  const file=event.target.files[0]; if(!file) return;
  const text=await file.text(); rawEpisodes=prepareEpisodes(parseCSV(text)); runSimulation();
});
document.getElementById("loadSampleBtn").addEventListener("click", async () => {
  const response=await fetch("c15_episode_level_for_dashboard.csv");
  const text=await response.text(); rawEpisodes=prepareEpisodes(parseCSV(text)); runSimulation();
});
document.getElementById("runBtn").addEventListener("click", runSimulation);

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
["baselinePre","baselineProcess","baselinePost"].forEach(id => {
  document.getElementById(id).addEventListener("input", e => { e.target.dataset.touched="yes"; });
});
