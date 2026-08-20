let currentRows = [];
let filteredRows = [];

let wardChart = null;
let tatChart = null;
let wardPieChart = null;
let testPieChart = null;


// ============================================================
// STATUS OPTIONS
// ============================================================

const STATUS_OPTIONS = [
  "Not located",
  "Located in lab",
  "With section",
  "Sample in fridge",
  "Sample in freezer",
  "Awaiting aliquot",
  "Awaiting analyser",
  "Issue / follow-up",
  "Resolved"
];


// ============================================================
// TAT CATEGORIES
// ============================================================

const TAT_CATEGORIES = [
  "<2 h",
  "2-4 h",
  "4-8 h",
  "8-24 h",
  ">24 h"
];


// ============================================================
// OTL RULES
// ============================================================

const OTL_RULES = [
  {
    category: "STAT C12/C14/C15",
    filenameIncludes: ["bilqees.jacobs"],
    locationIncludes: ["C12", "C14", "C15"],
    tatHours: 2,
    reviewFrequency: "Every 2 hours"
  },

  {
    category: "SACPRIO",
    filenameIncludes: ["pamela.douglas"],
    tatHours: 2,
    reviewFrequency: "Every 2 hours"
  },

  {
    category: "SACCHEND / SACVOL",
    filenameIncludes: ["kulsum.kasker"],
    tatHours: 8,
    reviewFrequency: "Every 3 hours"
  },

  {
    category: "SACBAT",
    filenameIncludes: ["ricardo.elario"],
    tatHours: null,
    freezerCheck: true,
    reviewFrequency: "Daily freezer check"
  },

  {
    category: "SACX incorrect test code",
    filenameIncludes: ["hoosain.shabudien"],
    testIncludes: ["SACX"],
    tatHours: 24,
    reviewFrequency: "Daily"
  },

  {
    category: "SAVSERO",
    filenameIncludes: ["hoosain.shabudien"],
    testIncludes: ["SAVSERO"],
    tatHours: 24,
    reviewFrequency: "Daily"
  },

  {
    category: "C093 CRP OTL",
    filenameIncludes: ["hoosain.shabudien"],
    testIncludes: ["C093", "CRP"],
    tatHours: 8,
    reviewFrequency: "Twice daily"
  }
];


// ============================================================
// COLUMN NAMES
// ============================================================

const COLUMN_ALIASES = {
  visitNumber: [
    "Visit Number",
    "Episode Number",
    "Episode",
    "Lab Number",
    "Accession Number"
  ],

  patientName: [
    "Patient Name",
    "Patient"
  ],

  location: [
    "Location",
    "Ward",
    "Source"
  ],

  tests: [
    "Tests",
    "Test",
    "Test Set Description",
    "Test Item Description",
    "Analyte"
  ],

  specimenType: [
    "Specimen Type",
    "Specimen"
  ],

  collectionDate: [
    "Collection Date",
    "Collected Date",
    "Collection Date Time"
  ],

  registrationDate: [
    "Registration Date",
    "Registered Date",
    "Registration Date Time"
  ],

  inLabDate: [
    "In Lab Date",
    "In-Lab Date",
    "Received Date",
    "Lab Received Date"
  ],

  storagePositions: [
    "Storage Positions",
    "Storage Position",
    "Storage"
  ],

  referralStatus: [
    "Referral Status",
    "Status",
    "Current Status"
  ],

  alternativeReference: [
    "Alternative Reference"
  ],

  internalReference: [
    "Internal Reference"
  ],

  hospital: [
    "Hospital",
    "Facility"
  ]
};


// ============================================================
// COLUMN / STRING HELPERS
// ============================================================

function normaliseName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_/()-]/g, " ")
    .replace(/\s+/g, " ");
}


function getValue(row, aliasList) {

  const keyMap = {};

  Object.keys(row).forEach(key => {
    keyMap[normaliseName(key)] = key;
  });

  for (const alias of aliasList) {

    const actual = keyMap[normaliseName(alias)];

    if (actual !== undefined) {
      return row[actual];
    }
  }

  return "";
}


// ============================================================
// CSV
// ============================================================

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

  const headers = splitCSVLine(lines[0])
    .map(h => h.trim());

  return lines
    .slice(1)
    .filter(Boolean)
    .map(line => {

      const values = splitCSVLine(line);
      const obj = {};

      headers.forEach((header, i) => {
        obj[header] = values[i] ?? "";
      });

      return obj;
    });
}


// ============================================================
// READ EXCEL / CSV FILE
// ============================================================

async function readFile(file) {

  const name = file.name.toLowerCase();

  if (name.endsWith(".csv")) {

    return parseCSV(await file.text());

  }

  const buffer = await file.arrayBuffer();

  let workbook;

  try {

    workbook = XLSX.read(buffer, {
      type: "array",
      cellDates: true,
      raw: false
    });

  } catch (error) {

    alert(
      "Could not read Excel file. Try opening the OTL in Excel and saving it again as .xlsx."
    );

    console.error(error);

    return [];
  }


  const sheet =
    workbook.Sheets[workbook.SheetNames[0]];


  const allRows = XLSX.utils.sheet_to_json(
    sheet,
    {
      header: 1,
      defval: "",
      raw: false
    }
  );


  // OTL files contain report information before the true table header.
  // Find the row containing "Visit Number".

  const headerRowIndex = allRows.findIndex(row =>
    row.some(
      cell =>
        normaliseName(cell) === "visit number"
    )
  );


  if (headerRowIndex === -1) {

    alert(
      "Could not find the OTL header row. Expected a column called Visit Number."
    );

    console.log(allRows.slice(0, 20));

    return [];
  }


  const headers =
    allRows[headerRowIndex].map(
      h => String(h || "").trim()
    );


  const dataRows = allRows
    .slice(headerRowIndex + 1)
    .filter(row =>
      row.some(
        cell =>
          String(cell || "").trim() !== ""
      )
    );


  return dataRows.map(row => {

    const obj = {};

    headers.forEach((header, i) => {

      if (header) {

        obj[header] =
          row[i] ?? "";

      }

    });

    return obj;

  });
}


// ============================================================
// DATE HANDLING
// ============================================================

function parseDate(value) {

  if (!value) return null;


  if (
    value instanceof Date &&
    !isNaN(value)
  ) {

    return value;

  }


  if (typeof value === "number") {

    const excelEpoch =
      new Date(Date.UTC(1899, 11, 30));

    return new Date(
      excelEpoch.getTime() +
      value * 86400000
    );

  }


  let text =
    String(value)
      .trim()
      .replace(/\u00A0/g, " ");


  if (!text) return null;


  let d = new Date(text);

  if (!isNaN(d)) {
    return d;
  }


  // YYYY-MM-DD HH:MM

  const m1 = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/
  );

  if (m1) {

    d = new Date(
      Number(m1[1]),
      Number(m1[2]) - 1,
      Number(m1[3]),
      Number(m1[4]),
      Number(m1[5]),
      Number(m1[6] || 0)
    );

    if (!isNaN(d)) {
      return d;
    }
  }


  // DD/MM/YYYY HH:MM

  const m2 = text.match(
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );

  if (m2) {

    d = new Date(
      Number(
        m2[3].length === 2
          ? "20" + m2[3]
          : m2[3]
      ),
      Number(m2[2]) - 1,
      Number(m2[1]),
      Number(m2[4] || 0),
      Number(m2[5] || 0),
      Number(m2[6] || 0)
    );

    if (!isNaN(d)) {
      return d;
    }
  }


  return null;
}


// ============================================================
// 24-HOUR DATE DISPLAY
// ============================================================

function formatDateTime24(date) {

  if (!date || isNaN(date)) {
    return "-";
  }

  const yyyy =
    date.getFullYear();

  const mm =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  const dd =
    String(date.getDate())
      .padStart(2, "0");

  const hh =
    String(date.getHours())
      .padStart(2, "0");

  const min =
    String(date.getMinutes())
      .padStart(2, "0");

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}


// ============================================================
// TAT CALCULATION
// CURRENT TIME - IN LAB DATE
// ============================================================

function currentTatHoursFrom(date) {

  return (
    new Date() - date
  ) / 3600000;

}


function formatTat(hours) {

  if (
    hours == null ||
    !Number.isFinite(hours)
  ) {

    return "-";

  }


  if (hours < 1) {

    return `${Math.round(hours * 60)} min`;

  }


  const h = Math.floor(hours);

  const m =
    Math.round(
      (hours - h) * 60
    );


  if (m === 60) {
    return `${h + 1} h`;
  }

  if (m === 0) {
    return `${h} h`;
  }

  return `${h} h ${m} min`;
}


function median(arr) {

  const values =
    arr.filter(
      v => Number.isFinite(v)
    );

  if (!values.length) {
    return null;
  }

  const sorted =
    [...values]
      .sort((a, b) => a - b);

  const mid =
    Math.floor(
      sorted.length / 2
    );

  return sorted.length % 2
    ? sorted[mid]
    : (
        sorted[mid - 1] +
        sorted[mid]
      ) / 2;
}


// ============================================================
// TAT CATEGORY
// ============================================================

function assignTatCategory(hours) {

  if (hours < 2) {
    return "<2 h";
  }

  if (hours < 4) {
    return "2-4 h";
  }

  if (hours < 8) {
    return "4-8 h";
  }

  if (hours < 24) {
    return "8-24 h";
  }

  return ">24 h";
}


// ============================================================
// WARD TRANSLATION
// ============================================================

function deriveWardFromLocationAndEpisode(
  location,
  visitNumber
) {

  const loc =
    String(location || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, " ");


  const LOCATION_MAP = {

    "91G026 EC--": "GSH EC",

    "91G026 TC--": "GSH TC",

    "91G026 C14-": "GSH C14",

    "91G026 C24-": "GSH C24",

    "91G026 C26-": "GSH C26",

    "91G026 C27-": "GSH C27",

    "91G026 D12-": "GSH D12",

    "91G026 D13-": "GSH D13",

    "91G026 D22-": "GSH D22",

    "91G026 F4--": "GSH F4",

    "91G026 G42U": "GSH G42U",

    "91G026 K41-": "GSH K41",

    "91G026 K41U": "GSH K41U",

    "91F002 CAS-": "FBH CAS",

    "91V009 EC--": "FBH EC"

  };


  // Exact defined locations

  if (
    Object.prototype.hasOwnProperty.call(
      LOCATION_MAP,
      loc
    )
  ) {

    return LOCATION_MAP[loc];

  }


  // Any other GSH location

  if (
    loc.startsWith("91G026")
  ) {

    return "GSH Other";

  }


  // Any other combination

  return "Other";
}


// ============================================================
// IDENTIFY WHICH OTL LIST THE FILE BELONGS TO
// ============================================================

function classifyOTL(
  row,
  sourceFile
) {

  const filename =
    String(sourceFile || "")
      .toLowerCase();

  const location =
    String(row.location || "")
      .toUpperCase();

  const test =
    String(row.test || "")
      .toUpperCase();


  for (
    const rule of OTL_RULES
  ) {

    const filenameOk =
      !rule.filenameIncludes ||
      rule.filenameIncludes.some(
        x =>
          filename.includes(
            x.toLowerCase()
          )
      );


    const locationOk =
      !rule.locationIncludes ||
      rule.locationIncludes.some(
        x =>
          location.includes(
            x.toUpperCase()
          )
      );


    const testOk =
      !rule.testIncludes ||
      rule.testIncludes.some(
        x =>
          test.includes(
            x.toUpperCase()
          )
      );


    if (
      filenameOk &&
      locationOk &&
      testOk
    ) {

      return rule;

    }
  }


  return {
    category: "Unclassified OTL",
    tatHours: 12,
    reviewFrequency: "Unknown"
  };
}


// ============================================================
// TAT STATUS
// ============================================================

function getTatStatus(
  currentTatHours,
  targetTatHours
) {

  if (
    targetTatHours == null
  ) {

    return {
      label: "Freezer check",
      outsideTat: false,
      text: "Check sample is in freezer"
    };

  }


  const diff =
    targetTatHours -
    currentTatHours;


  if (diff >= 2) {

    return {
      label: "Within TAT",
      outsideTat: false,
      text: `${formatTat(diff)} remaining`
    };

  }


  if (diff >= 0) {

    return {
      label: "Near breach",
      outsideTat: false,
      text: `${formatTat(diff)} remaining`
    };

  }


  return {
    label: "Outside TAT",
    outsideTat: true,
    text:
      `${formatTat(Math.abs(diff))} outside TAT`
  };
}


// ============================================================
// UNIQUE SAMPLE KEY
// ============================================================

function makeSampleKey(
  visitNumber,
  test,
  referenceDate
) {

  const datePart =
    referenceDate
      ? referenceDate
          .toISOString()
          .slice(0, 10)
      : "";


  return [
    String(visitNumber || "")
      .trim()
      .toUpperCase(),

    String(test || "")
      .trim()
      .toUpperCase(),

    datePart

  ].join("||");
}


// ============================================================
// COMMENTS / STATUS MEMORY
// ============================================================

function getSavedComments() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "otlComments"
      ) || "{}"
    );

  } catch {

    return {};

  }
}


function saveComment(
  sampleKey,
  payload
) {

  const comments =
    getSavedComments();

  comments[sampleKey] =
    payload;

  localStorage.setItem(
    "otlComments",
    JSON.stringify(comments)
  );
}


// ============================================================
// PREPARE OTL ROWS
// ============================================================

async function prepareRows(
  rows,
  sourceFile
) {

  const comments =
    getSavedComments();

  const prepared = [];


  rows.forEach(row => {

    const visitNumber =
      getValue(
        row,
        COLUMN_ALIASES.visitNumber
      );

    const patientName =
      getValue(
        row,
        COLUMN_ALIASES.patientName
      );

    const location =
      getValue(
        row,
        COLUMN_ALIASES.location
      );

    const test =
      getValue(
        row,
        COLUMN_ALIASES.tests
      );

    const specimenType =
      getValue(
        row,
        COLUMN_ALIASES.specimenType
      );


    const collectionDate =
      parseDate(
        getValue(
          row,
          COLUMN_ALIASES.collectionDate
        )
      );


    const registrationDate =
      parseDate(
        getValue(
          row,
          COLUMN_ALIASES.registrationDate
        )
      );


    const inLabDate =
      parseDate(
        getValue(
          row,
          COLUMN_ALIASES.inLabDate
        )
      );


    const storagePositions =
      getValue(
        row,
        COLUMN_ALIASES.storagePositions
      );


    const referralStatus =
      getValue(
        row,
        COLUMN_ALIASES.referralStatus
      );


    const alternativeReference =
      getValue(
        row,
        COLUMN_ALIASES.alternativeReference
      );


    const internalReference =
      getValue(
        row,
        COLUMN_ALIASES.internalReference
      );


    const hospital =
      getValue(
        row,
        COLUMN_ALIASES.hospital
      );


    // ========================================================
    // TAT START = IN LAB DATE
    // ========================================================

    const tatStart =
      inLabDate ||
      registrationDate ||
      collectionDate;


    if (
      !visitNumber ||
      !test ||
      !tatStart
    ) {

      return;

    }


    const currentTatHours =
      currentTatHoursFrom(
        tatStart
      );


    if (
      !Number.isFinite(
        currentTatHours
      )
    ) {

      return;

    }


    // ========================================================
    // AR FLAG
    // In Lab Date > Registration Date
    // ========================================================

    const arFlag =
      Boolean(
        registrationDate &&
        inLabDate &&
        inLabDate > registrationDate
      );


    // ========================================================
    // WARD
    // ========================================================

    const ward =
      deriveWardFromLocationAndEpisode(
        location,
        visitNumber
      );


    // ========================================================
    // OTL TYPE
    // ========================================================

    const otlRule =
      classifyOTL(
        {
          location,
          test
        },
        sourceFile
      );


    const tatStatus =
      getTatStatus(
        currentTatHours,
        otlRule.tatHours
      );


    const sampleKey =
      makeSampleKey(
        visitNumber,
        test,
        inLabDate ||
        registrationDate ||
        collectionDate
      );


    const saved =
      comments[sampleKey] || {};


    prepared.push({

      sampleKey,

      visitNumber:
        String(
          visitNumber || ""
        ).trim(),

      patientName:
        String(
          patientName || ""
        ).trim(),

      hospital:
        String(
          hospital || ""
        ).trim(),

      location:
        String(
          location || ""
        ).trim(),

      ward,

      test:
        String(
          test || ""
        ).trim(),

      specimenType:
        String(
          specimenType || ""
        ).trim(),

      collectionDate,

      registrationDate,

      inLabDate,

      tatStart,

      arFlag,

      tatStartDisplay:
        formatDateTime24(
          tatStart
        ),

      currentTatHours,

      tatCategory:
        assignTatCategory(
          currentTatHours
        ),

      otlCategory:
        otlRule.category,

      reviewFrequency:
        otlRule.reviewFrequency,

      freezerCheck:
        otlRule.freezerCheck ||
        false,

      targetTatHours:
        otlRule.tatHours == null
          ? "Freezer check"
          : otlRule.tatHours,

      tatLabel:
        tatStatus.label,

      tatText:
        tatStatus.text,

      outsideTat:
        tatStatus.outsideTat,

      storagePositions:
        String(
          storagePositions || ""
        ).trim(),

      referralStatus:
        String(
          referralStatus || ""
        ).trim(),

      alternativeReference:
        String(
          alternativeReference || ""
        ).trim(),

      internalReference:
        String(
          internalReference || ""
        ).trim(),

      sourceFile,

      techStatus:
        saved.techStatus ||
        "Not located",

      comment:
        saved.comment ||
        "",

      commentUpdatedAt:
        saved.updatedAt ||
        ""

    });

  });


  return prepared;
}


// ============================================================
// GENERAL HELPERS
// ============================================================

function safeContains(
  value,
  query
) {

  if (!query) return true;

  return String(
    value || ""
  )
    .toLowerCase()
    .includes(
      query.toLowerCase()
    );
}


function escapeHTML(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,
    ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    }[ch])
  );
}


function setMetric(
  id,
  value
) {

  const el =
    document.getElementById(id);

  if (el) {
    el.textContent = value;
  }
}


// ============================================================
// FILTER MENU
// ============================================================

function populateWardFilter() {

  const select =
    document.getElementById(
      "wardGroupFilter"
    );

  if (!select) return;


  const current =
    select.value;


  const groups =
    [...new Set(
      currentRows.map(
        r => r.otlCategory
      )
    )].sort();


  select.innerHTML =
    '<option value="">All OTL Sections</option>';


  groups.forEach(group => {

    const opt =
      document.createElement(
        "option"
      );

    opt.value = group;
    opt.textContent = group;

    select.appendChild(opt);

  });


  if (
    groups.includes(current)
  ) {

    select.value = current;

  }
}


// ============================================================
// FILTERS
// ============================================================

function applyFilters() {

  const selectedSection =
    document.getElementById(
      "wardGroupFilter"
    )?.value || "";


  const selectedTat =
    document.getElementById(
      "ageFilter"
    )?.value || "";


  const selectedStatus =
    document.getElementById(
      "statusFilter"
    )?.value || "";


  const wardText =
    document.getElementById(
      "wardTextFilter"
    )?.value.trim() || "";


  const testText =
    document.getElementById(
      "testTextFilter"
    )?.value.trim() || "";


  const episodeText =
    document.getElementById(
      "episodeTextFilter"
    )?.value.trim() || "";


  filteredRows =
    currentRows.filter(r =>

      (
        !selectedSection ||
        r.otlCategory === selectedSection
      )

      &&

      (
        !selectedTat ||
        r.tatCategory === selectedTat
      )

      &&

      (
        !selectedStatus ||
        r.techStatus === selectedStatus
      )

      &&

      safeContains(
        r.ward,
        wardText
      )

      &&

      safeContains(
        r.test,
        testText
      )

      &&

      safeContains(
        r.visitNumber,
        episodeText
      )

    );


  renderDashboard();
}


// ============================================================
// SPLIT MULTIPLE TESTS INTO INDIVIDUAL TESTS
// ============================================================

function splitTests(testString) {

  return String(
    testString || ""
  )
    .split(/[,\n;]+/)
    .map(
      t =>
        t
          .trim()
          .replace(/^-/, "")
          .trim()
    )
    .filter(Boolean);
}


function testItemCounts(rows) {

  const counts = {};


  rows.forEach(row => {

    const tests =
      splitTests(
        row.test
      );


    tests.forEach(test => {

      counts[test] =
        (counts[test] || 0) + 1;

    });

  });


  return counts;
}


// ============================================================
// COUNT VALUES
// ============================================================

function groupCount(
  rows,
  field
) {

  const counts = {};


  rows.forEach(row => {

    const key =
      row[field] ||
      "Unknown";

    counts[key] =
      (counts[key] || 0) + 1;

  });


  return counts;
}


// ============================================================
// CHARTS
// ============================================================

function updateCharts(rows) {

  const sectionCounts =
    groupCount(
      rows,
      "otlCategory"
    );


  const tatCounts = {};

  TAT_CATEGORIES.forEach(
    category => {

      tatCounts[category] =
        rows.filter(
          r =>
            r.tatCategory ===
            category
        ).length;

    }
  );


  // Ward counts

  const wardCountsRaw =
    groupCount(
      rows,
      "ward"
    );


  const wardCounts =
    Object.fromEntries(

      Object.entries(
        wardCountsRaw
      )

        .sort(
          (a, b) =>
            b[1] - a[1]
        )

        .map(
          ([ward, count]) =>
            [
              `${ward} (${count})`,
              count
            ]
        )

    );


  // Individual test counts

  const testCountsRaw =
    testItemCounts(rows);


  const testCounts =
    Object.fromEntries(

      Object.entries(
        testCountsRaw
      )

        .sort(
          (a, b) =>
            b[1] - a[1]
        )

        .map(
          ([test, count]) =>
            [
              `${test} (${count})`,
              count
            ]
        )

    );


  // ----------------------------------------------------------
  // OTL CATEGORY BAR CHART
  // ----------------------------------------------------------

  const wardCanvas =
    document.getElementById(
      "wardChart"
    );


  if (wardCanvas) {

    const ctx =
      wardCanvas.getContext(
        "2d"
      );


    if (wardChart) {
      wardChart.destroy();
    }


    wardChart =
      new Chart(
        ctx,
        {

          type: "bar",

          data: {

            labels:
              Object.keys(
                sectionCounts
              ),

            datasets: [
              {

                label:
                  "Current OTL rows",

                data:
                  Object.values(
                    sectionCounts
                  )

              }
            ]

          },

          options: {

            responsive: true,

            scales: {

              y: {
                beginAtZero: true
              }

            }

          }

        }
      );

  }


  // ----------------------------------------------------------
  // TAT CATEGORY BAR CHART
  // ----------------------------------------------------------

  const tatCanvas =
    document.getElementById(
      "ageChart"
    );


  if (tatCanvas) {

    const ctx =
      tatCanvas.getContext(
        "2d"
      );


    if (tatChart) {
      tatChart.destroy();
    }


    tatChart =
      new Chart(
        ctx,
        {

          type: "bar",

          data: {

            labels:
              Object.keys(
                tatCounts
              ),

            datasets: [
              {

                label:
                  "Current OTL rows",

                data:
                  Object.values(
                    tatCounts
                  )

              }
            ]

          },

          options: {

            responsive: true,

            scales: {

              y: {
                beginAtZero: true
              }

            }

          }

        }
      );

  }


  // ----------------------------------------------------------
  // WARD PIE CHART
  // ----------------------------------------------------------

  const wardPieCanvas =
    document.getElementById(
      "wardPieChart"
    );


  if (wardPieCanvas) {

    const ctx =
      wardPieCanvas.getContext(
        "2d"
      );


    if (wardPieChart) {
      wardPieChart.destroy();
    }


    wardPieChart =
      new Chart(
        ctx,
        {

          type: "pie",

          data: {

            labels:
              Object.keys(
                wardCounts
              ),

            datasets: [
              {

                label:
                  "Ward distribution",

                data:
                  Object.values(
                    wardCounts
                  )

              }
            ]

          },

          options: {

            responsive: true,

            plugins: {

              legend: {
                position: "bottom"
              }

            }

          }

        }
      );

  }


  // ----------------------------------------------------------
  // OUTSTANDING TEST PIE CHART
  // ----------------------------------------------------------

  const testPieCanvas =
    document.getElementById(
      "testPieChart"
    );


  if (testPieCanvas) {

    const ctx =
      testPieCanvas.getContext(
        "2d"
      );


    if (testPieChart) {
      testPieChart.destroy();
    }


    testPieChart =
      new Chart(
        ctx,
        {

          type: "pie",

          data: {

            labels:
              Object.keys(
                testCounts
              ),

            datasets: [
              {

                label:
                  "Outstanding test distribution",

                data:
                  Object.values(
                    testCounts
                  )

              }
            ]

          },

          options: {

            responsive: true,

            plugins: {

              legend: {
                position: "bottom"
              }

            }

          }

        }
      );

  }

}


// ============================================================
// SUMMARY TABLE
// HOVER = SHOW EPISODES
// CLICK = FILTER TO THOSE ROWS
// ============================================================

function updateSummaryTable(rows) {

  const tbody =
    document.querySelector(
      "#summaryTable tbody"
    );


  if (!tbody) return;


  tbody.innerHTML = "";


  const groups =
    [...new Set(
      rows.map(
        r => r.otlCategory
      )
    )].sort();


  groups.forEach(group => {

    const g =
      rows.filter(
        r =>
          r.otlCategory ===
          group
      );


    const tr =
      document.createElement(
        "tr"
      );


    const locatedRows =
      g.filter(
        r =>
          [
            "Located in lab",
            "With section",
            "Resolved",
            "Sample in fridge",
            "Sample in freezer"
          ].includes(
            r.techStatus
          )
      );


    const issueRows =
      g.filter(
        r =>
          r.techStatus ===
          "Issue / follow-up"
      );


    const cells = [

      {
        label: group,
        rows: g,
        clickable: false
      },

      {
        label: g.length,
        rows: g,
        clickable: true
      },

      ...TAT_CATEGORIES.map(
        category => {

          const matchingRows =
            g.filter(
              r =>
                r.tatCategory ===
                category
            );


          return {

            label:
              matchingRows.length,

            rows:
              matchingRows,

            clickable: true

          };

        }
      ),

      {
        label:
          locatedRows.length,

        rows:
          locatedRows,

        clickable: true
      },

      {
        label:
          issueRows.length,

        rows:
          issueRows,

        clickable: true
      }

    ];


    cells.forEach(cell => {

      const td =
        document.createElement(
          "td"
        );


      if (
        cell.clickable &&
        cell.rows.length > 0
      ) {

        td.textContent =
          cell.label;

        td.classList.add(
          "summary-click"
        );


        // Hover shows episodes

        td.title =
          cell.rows
            .map(
              r =>
                `${r.visitNumber} | ${r.ward} | ${r.test}`
            )
            .join("\n");


        // Click shows only those rows

        td.addEventListener(
          "click",
          () => {

            filteredRows =
              [...cell.rows];


            renderDashboard();


            const table =
              document.querySelector(
                "#otlTable"
              );


            if (table) {

              table.scrollIntoView(
                {
                  behavior: "smooth",
                  block: "start"
                }
              );

            }

          }
        );

      } else {

        td.textContent =
          cell.label;

      }


      tr.appendChild(td);

    });


    tbody.appendChild(tr);

  });

}


// ============================================================
// TAT BADGE
// ============================================================

function tatBadge(row) {

  let cls = "";


  if (row.outsideTat) {

    cls = "old";

  } else if (
    row.tatLabel ===
    "Near breach"
  ) {

    cls = "warn";

  }


  return `
    <span class="age-badge ${cls}">
      ${formatTat(row.currentTatHours)}
      <br>
      <small>${escapeHTML(row.tatText)}</small>
    </span>
  `;
}


// ============================================================
// CURRENT OTL TRACKER TABLE
// ============================================================

function renderTable(rows) {

  const tbody =
    document.querySelector(
      "#otlTable tbody"
    );


  if (!tbody) return;


  tbody.innerHTML = "";


  const sorted =
    [...rows]
      .sort(
        (a, b) =>
          b.currentTatHours -
          a.currentTatHours
      );


  sorted.forEach(row => {

    const tr =
      document.createElement(
        "tr"
      );


    tr.dataset.sampleKey =
      row.sampleKey;


    // ========================================================
    // WHOLE ROW TAT COLOUR
    // ========================================================

    if (row.outsideTat) {

      tr.classList.add(
        "tat-bad"
      );

    } else if (
      row.tatLabel ===
      "Near breach"
    ) {

      tr.classList.add(
        "tat-warn"
      );

    } else {

      tr.classList.add(
        "tat-ok"
      );

    }


    const statusOptions =
      STATUS_OPTIONS
        .map(
          status =>
            `<option value="${escapeHTML(status)}" ${
              status === row.techStatus
                ? "selected"
                : ""
            }>${escapeHTML(status)}</option>`
        )
        .join("");


    tr.innerHTML = `

      <!-- TAT -->

      <td>
        ${tatBadge(row)}
      </td>


      <!-- EPISODE -->

      <td>

        <div class="episode-copy-wrap">

          ${
            row.arFlag
              ? `
                <span
                  class="ar-flag"
                  title="In Lab Date is later than Registration Date"
                >
                  AR
                </span>
              `
              : ""
          }

          <strong>
            ${escapeHTML(row.visitNumber)}
          </strong>

          <button
            type="button"
            class="copy-episode-btn"
            data-episode="${escapeHTML(row.visitNumber)}"
            title="Copy episode number"
          >
            Copy
          </button>

        </div>

        <span class="small-text">
          ${escapeHTML(row.patientName)}
        </span>

      </td>


      <!-- WARD -->

      <td>

        <strong>
          ${escapeHTML(row.ward)}
        </strong>

        <br>

        <span class="small-text">
          ${escapeHTML(row.location)}
        </span>

      </td>


      <!-- TEST -->

      <td>

        <strong>
          ${escapeHTML(row.test)}
        </strong>

        <br>

        <span class="small-text">
          ${escapeHTML(row.specimenType)}
        </span>

        <br>

        <span class="small-text">
          ${escapeHTML(row.otlCategory)}
        </span>

      </td>


      <!-- IN LAB DATE -->

      <td>

        ${escapeHTML(row.tatStartDisplay)}

        <br>

        <span class="small-text">
          TAT from In Lab Date
        </span>

        <br>

        <span class="small-text">
          Target:
          ${escapeHTML(row.targetTatHours)}
          ${
            typeof row.targetTatHours ===
            "number"
              ? " h"
              : ""
          }
        </span>

      </td>


      <!-- CURRENT LAB STATUS -->

      <td>

        <strong>
          ${escapeHTML(
            row.referralStatus ||
            "On OTL"
          )}
        </strong>

        <br>

        <span class="small-text">
          ${escapeHTML(
            row.storagePositions ||
            "No storage position listed"
          )}
        </span>

        <br>

        <span class="small-text">
          Review:
          ${escapeHTML(
            row.reviewFrequency
          )}
        </span>

      </td>


      <!-- TECH STATUS -->

      <td>

        <select
          class="row-status"
        >
          ${statusOptions}
        </select>

      </td>


      <!-- COMMENT -->

      <td>

        <textarea
          class="row-comment"
          placeholder="Add comment..."
        >${escapeHTML(row.comment)}</textarea>

      </td>


      <!-- AUTO SAVE -->

      <td>

        <span
          class="small-text autosave-label"
        >
          Auto-saved
        </span>

      </td>

    `;


    tbody.appendChild(tr);


    // ========================================================
    // COPY EPISODE BUTTON
    // ========================================================

    const copyBtn =
      tr.querySelector(
        ".copy-episode-btn"
      );


    if (copyBtn) {

      copyBtn.addEventListener(
        "click",
        async () => {

          const episode =
            copyBtn.dataset.episode;


          try {

            await navigator
              .clipboard
              .writeText(
                episode
              );


            const oldText =
              copyBtn.textContent;


            copyBtn.textContent =
              "✓";


            setTimeout(
              () => {

                copyBtn.textContent =
                  oldText;

              },
              1200
            );


          } catch (error) {

            console.error(
              "Could not copy episode number:",
              error
            );

          }

        }
      );

    }

  });


  // ==========================================================
  // AUTO-SAVE COMMENTS / STATUS
  // ==========================================================

  document
    .querySelectorAll(
      "#otlTable tbody tr"
    )
    .forEach(tr => {


      const statusEl =
        tr.querySelector(
          ".row-status"
        );


      const commentEl =
        tr.querySelector(
          ".row-comment"
        );


      const labelEl =
        tr.querySelector(
          ".autosave-label"
        );


      let saveTimer = null;


      function autoSave() {

        if (labelEl) {

          labelEl.textContent =
            "Saving...";

        }


        clearTimeout(
          saveTimer
        );


        saveTimer =
          setTimeout(
            () => {


              saveRowComment(

                tr.dataset.sampleKey,

                statusEl.value,

                commentEl.value,

                false

              );


              if (labelEl) {

                labelEl.textContent =
                  "Auto-saved";

              }

            },
            500
          );

      }


      statusEl.addEventListener(
        "change",
        autoSave
      );


      commentEl.addEventListener(
        "input",
        autoSave
      );

    });

}


// ============================================================
// SAVE COMMENT
// ============================================================

function saveRowComment(
  sampleKey,
  techStatus,
  comment,
  rerender = true
) {

  const payload = {

    techStatus,

    comment,

    updatedAt:
      new Date()
        .toISOString()

  };


  saveComment(
    sampleKey,
    payload
  );


  currentRows =
    currentRows.map(row =>

      row.sampleKey ===
      sampleKey

        ? {
            ...row,
            techStatus,
            comment,
            commentUpdatedAt:
              payload.updatedAt
          }

        : row

    );


  filteredRows =
    filteredRows.map(row =>

      row.sampleKey ===
      sampleKey

        ? {
            ...row,
            techStatus,
            comment,
            commentUpdatedAt:
              payload.updatedAt
          }

        : row

    );


  if (rerender) {
    applyFilters();
  }
}


// ============================================================
// INTERPRETATION BOX
// ============================================================

function updateInterpretation(rows) {

  const el =
    document.getElementById(
      "interpretationBox"
    );


  if (!el) return;


  if (!rows.length) {

    el.textContent =
      currentRows.length

        ? "No current OTL rows match the filter. Press Clear Filters to show all loaded rows."

        : "No OTL rows loaded. Upload an OTL extract to begin.";


    return;
  }


  const worst =
    [...rows]
      .sort(
        (a, b) =>
          b.currentTatHours -
          a.currentTatHours
      )[0];


  const outsideTat =
    rows.filter(
      r => r.outsideTat
    ).length;


  const near =
    rows.filter(
      r =>
        r.tatLabel ===
        "Near breach"
    ).length;


  const over24 =
    rows.filter(
      r =>
        r.currentTatHours >=
        24
    ).length;


  const freezer =
    rows.filter(
      r => r.freezerCheck
    ).length;


  const issue =
    rows.filter(
      r =>
        r.techStatus ===
        "Issue / follow-up"
    ).length;


  el.innerHTML = `

    There are
    <strong>${rows.length}</strong>
    current OTL row(s) in this view.

    <strong>${outsideTat}</strong>
    are outside TAT,

    <strong>${near}</strong>
    are near breach and

    <strong>${over24}</strong>
    have a TAT greater than 24 hours.

    <br><br>

    <strong>${freezer}</strong>
    row(s) are freezer-check OTLs.

    <strong>${issue}</strong>
    item(s) are marked as issue / follow-up.

    <br><br>

    The longest TAT item is
    <strong>${escapeHTML(worst.test)}</strong>

    from
    <strong>${escapeHTML(worst.ward)}</strong>,

    with a current TAT of
    <strong>${formatTat(worst.currentTatHours)}</strong>.

    It is classified as
    <strong>${escapeHTML(worst.otlCategory)}</strong>

    and is currently
    <strong>${escapeHTML(worst.tatText)}</strong>.

  `;
}


// ============================================================
// DASHBOARD
// ============================================================

function renderDashboard() {

  const rows =
    filteredRows;


  setMetric(
    "rowsMetric",
    rows.length.toLocaleString()
  );


  setMetric(
    "episodesMetric",
    new Set(
      rows.map(
        r => r.visitNumber
      )
    )
      .size
      .toLocaleString()
  );


  setMetric(
    "medianAgeMetric",
    formatTat(
      median(
        rows.map(
          r => r.currentTatHours
        )
      )
    )
  );


  setMetric(
    "over24Metric",
    rows
      .filter(
        r =>
          r.currentTatHours >=
          24
      )
      .length
      .toLocaleString()
  );


  setMetric(
    "locatedMetric",
    rows
      .filter(
        r =>
          [
            "Located in lab",
            "With section",
            "Resolved",
            "Sample in fridge",
            "Sample in freezer"
          ].includes(
            r.techStatus
          )
      )
      .length
      .toLocaleString()
  );


  setMetric(
    "notLocatedMetric",
    rows
      .filter(
        r =>
          r.techStatus ===
          "Not located"
      )
      .length
      .toLocaleString()
  );


  setMetric(
    "problemMetric",
    rows
      .filter(
        r =>
          r.techStatus ===
          "Issue / follow-up"
      )
      .length
      .toLocaleString()
  );


  const last =
    localStorage.getItem(
      "otlLastExtractTime"
    );


  setMetric(
    "extractTimeMetric",
    last
      ? formatDateTime24(
          new Date(last)
        )
      : "-"
  );


  updateCharts(rows);

  updateSummaryTable(rows);

  renderTable(rows);

  updateInterpretation(rows);
}


// ============================================================
// TAT HISTORY
// ============================================================

function saveTatSnapshot(rows) {

  const extractTime =
    new Date()
      .toISOString();


  let history = [];


  try {

    history =
      JSON.parse(
        localStorage.getItem(
          "otlTatHistory"
        ) || "[]"
      );

  } catch {

    history = [];

  }


  history.push({

    extractTime,

    count:
      rows.length,

    rows:
      rows.map(row => ({

        sampleKey:
          row.sampleKey,

        visitNumber:
          row.visitNumber,

        test:
          row.test,

        ward:
          row.ward,

        location:
          row.location,

        otlCategory:
          row.otlCategory,

        currentTatHours:
          Number(
            row.currentTatHours
              .toFixed(2)
          ),

        tatLabel:
          row.tatLabel,

        techStatus:
          row.techStatus

      }))

  });


  localStorage.setItem(

    "otlTatHistory",

    JSON.stringify(
      history.slice(-50)
    )

  );


  localStorage.setItem(

    "otlLastExtractTime",

    extractTime

  );
}


// ============================================================
// EXPORT CURRENT OTL WITH COMMENTS TO EXCEL
// ============================================================

function exportOTLWithComments() {

  if (!currentRows.length) {

    alert(
      "No OTL data loaded."
    );

    return;
  }


  const exportRows =
    currentRows.map(row => ({

      "OTL Category":
        row.otlCategory,

      "Visit Number":
        row.visitNumber,

      "AR Flag":
        row.arFlag
          ? "AR"
          : "",

      "Patient Name":
        row.patientName,

      "Ward":
        row.ward,

      "Location":
        row.location,

      "Test":
        row.test,

      "Specimen Type":
        row.specimenType,

      "In Lab Date & Time":
        row.tatStartDisplay,

      "Current TAT Hours":
        row.currentTatHours
          .toFixed(2),

      "TAT Target":
        row.targetTatHours,

      "TAT Status":
        row.tatLabel,

      "TAT Comment":
        row.tatText,

      "Referral Status":
        row.referralStatus,

      "Storage Positions":
        row.storagePositions,

      "Tech Status":
        row.techStatus,

      "Tech Comment":
        row.comment,

      "Comment Updated At":
        row.commentUpdatedAt,

      "Source File":
        row.sourceFile

    }));


  const worksheet =
    XLSX.utils.json_to_sheet(
      exportRows
    );


  const workbook =
    XLSX.utils.book_new();


  XLSX.utils.book_append_sheet(

    workbook,

    worksheet,

    "Current OTL"

  );


  const stamp =
    formatDateTime24(
      new Date()
    )
      .replace(" ", "_")
      .replace(":", "");


  XLSX.writeFile(

    workbook,

    `OTL_with_comments_${stamp}.xlsx`

  );
}


// ============================================================
// CSV EXPORT
// ============================================================

function toCSV(rows) {

  const headers = [

    "otl_category",
    "current_tat_hours",
    "tat_target",
    "tat_status",
    "tat_text",
    "tat_category",
    "visit_number",
    "ar_flag",
    "patient_name",
    "ward",
    "location",
    "test",
    "specimen_type",
    "in_lab_date_time",
    "referral_status",
    "storage_positions",
    "tech_status",
    "comment",
    "comment_updated_at",
    "source_file"

  ];


  const lines = [
    headers.join(",")
  ];


  rows.forEach(row => {

    const values = [

      row.otlCategory,

      row.currentTatHours
        .toFixed(2),

      row.targetTatHours,

      row.tatLabel,

      row.tatText,

      row.tatCategory,

      row.visitNumber,

      row.arFlag
        ? "AR"
        : "",

      row.patientName,

      row.ward,

      row.location,

      row.test,

      row.specimenType,

      row.tatStartDisplay,

      row.referralStatus,

      row.storagePositions,

      row.techStatus,

      row.comment,

      row.commentUpdatedAt,

      row.sourceFile

    ];


    lines.push(

      values
        .map(
          value =>
            `"${String(value ?? "")
              .replace(/"/g, '""')}"`
        )
        .join(",")

    );

  });


  return lines.join("\n");
}


function downloadCSV(
  rows,
  filename
) {

  const blob =
    new Blob(
      [toCSV(rows)],
      {
        type:
          "text/csv;charset=utf-8"
      }
    );


  const url =
    URL.createObjectURL(
      blob
    );


  const a =
    document.createElement(
      "a"
    );


  a.href = url;

  a.download =
    filename;

  a.click();


  URL.revokeObjectURL(
    url
  );
}


// ============================================================
// FILE UPLOAD
// ============================================================

document
  .getElementById(
    "otlFiles"
  )
  .addEventListener(
    "change",
    async event => {


      const files =
        [...event.target.files];


      if (!files.length) {
        return;
      }


      const all = [];


      for (
        const file of files
      ) {

        const raw =
          await readFile(file);


        const prepared =
          await prepareRows(
            raw,
            file.name
          );


        all.push(
          ...prepared
        );

      }


      // De-duplicate same sample/test/date

      const deduped =
        new Map();


      all.forEach(row => {

        deduped.set(
          row.sampleKey,
          row
        );

      });


      currentRows =
        [...deduped.values()];


      filteredRows =
        [...currentRows];


      saveTatSnapshot(
        currentRows
      );


      populateWardFilter();


      renderDashboard();


      alert(
        `Loaded ${currentRows.length} OTL row(s).`
      );

    }
  );


// ============================================================
// APPLY FILTER
// ============================================================

document
  .getElementById(
    "applyFilterBtn"
  )
  .addEventListener(
    "click",
    applyFilters
  );


// ============================================================
// CLEAR FILTER
// ============================================================

document
  .getElementById(
    "clearFilterBtn"
  )
  .addEventListener(
    "click",
    () => {


      [
        "wardGroupFilter",
        "ageFilter",
        "statusFilter"
      ].forEach(id => {

        const el =
          document.getElementById(
            id
          );

        if (el) {
          el.value = "";
        }

      });


      [
        "wardTextFilter",
        "testTextFilter",
        "episodeTextFilter"
      ].forEach(id => {

        const el =
          document.getElementById(
            id
          );

        if (el) {
          el.value = "";
        }

      });


      filteredRows =
        [...currentRows];


      renderDashboard();

    }
  );


// ============================================================
// EXPORT EXCEL
// ============================================================

document
  .getElementById(
    "exportCurrentBtn"
  )
  .addEventListener(
    "click",
    exportOTLWithComments
  );


// ============================================================
// EXPORT FILTERED CSV
// ============================================================

document
  .getElementById(
    "exportViewBtn"
  )
  .addEventListener(
    "click",
    () => {

      downloadCSV(
        filteredRows,
        "filtered_otl_view.csv"
      );

    }
  );


// ============================================================
// LIVE FILTER EVENTS
// ============================================================

[
  "wardGroupFilter",
  "ageFilter",
  "statusFilter",
  "wardTextFilter",
  "testTextFilter",
  "episodeTextFilter"
]
.forEach(id => {

  const el =
    document.getElementById(id);


  if (!el) {
    return;
  }


  el.addEventListener(
    "change",
    applyFilters
  );


  el.addEventListener(
    "keyup",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        applyFilters();

      }

    }
  );

});
