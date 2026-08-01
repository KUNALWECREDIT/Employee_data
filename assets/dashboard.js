/* ==========================================================================
   WorkCollar Ledger — dashboard rendering
   ========================================================================== */
(function () {
  "use strict";
  var WC = window.WCLedger;
  var fmt = WC.fmt, helpers = WC.helpers;
  var session = WC.auth.guard(["admin", "viewer"]);
  if (!session) return;

  var MONTHS = helpers.monthOrder;
  var charts = {}; // keep references so we can destroy/rebuild on re-render
  var employees = [];
  var meta = {};
  var maxTenureMonths = 0;

  var TITLES = {
    overview: ["Overview", "Company-wide snapshot across every executive and every month."],
    rawdata: ["Raw Data", "The master sheet, row for row."],
    monthly: ["Monthly Report", "How the whole team trended, month by month."],
    insights: ["Insights", "Four views built to represent every executive at a glance."],
    quality: ["Quality Feedback", "Sheet-level feedback stats, plus a live log anyone can add to."],
    publish: ["Publish Sheet", "Upload a fresh sheet and push it live."]
  };

  /* -------------------- shell: nav, topbar, logout -------------------- */
  document.getElementById("roleLabel").textContent = session.label;
  document.getElementById("rolePill").className = "role-pill " + session.role;
  if (session.role === "admin") document.getElementById("adminNavGroup").style.display = "";
  document.getElementById("logoutBtn").addEventListener("click", WC.auth.logout);

  document.querySelectorAll(".navlink").forEach(function (link) {
    link.addEventListener("click", function () {
      var tab = link.getAttribute("data-tab");
      if (tab === "publish" && session.role !== "admin") return;
      activateTab(tab);
    });
  });

  function activateTab(tab) {
    document.querySelectorAll(".navlink").forEach(function (l) {
      l.classList.toggle("active", l.getAttribute("data-tab") === tab);
    });
    document.querySelectorAll(".tab-panel").forEach(function (p) {
      var show = p.getAttribute("data-panel") === tab;
      p.style.display = show ? "" : "none";
      if (show) { p.classList.remove("panel-fade"); void p.offsetWidth; p.classList.add("panel-fade"); }
    });
    document.getElementById("topbarTitle").textContent = TITLES[tab][0];
    document.getElementById("topbarMeta").textContent = TITLES[tab][1];
    window.location.hash = tab;
  }

  var initialTab = (window.location.hash || "").replace("#", "");
  if (!initialTab || !TITLES[initialTab] || (initialTab === "publish" && session.role !== "admin")) initialTab = "overview";

  /* -------------------- load data & render everything -------------------- */
  WC.dataStore.load().then(function (json) {
    meta = json.meta;
    employees = json.employees;
    maxTenureMonths = employees.reduce(function (m, e) { return Math.max(m, e.monthsOnRoll || 0); }, 0);
    document.getElementById("topbarMeta").textContent = TITLES[initialTab][1];
    document.getElementById("lastUpdatedChip").innerHTML =
      '<span class="dot" style="background:var(--teal)"></span> ' + meta.employeeCount + ' executives · updated ' + meta.generatedAt;

    renderOverview();
    renderRawData();
    renderMonthly();
    renderInsights();
    activateTab(initialTab);
  }).catch(function (err) {
    document.getElementById("content").innerHTML =
      '<div class="card"><h3 style="color:var(--coral)">Couldn\'t load the ledger</h3><p style="color:var(--slate)">' + err.message + '</p></div>';
  });

  /* -------------------- shared calc helpers -------------------- */
  function monthTotals() {
    return MONTHS.map(function (m) {
      var incentive = 0, perfSum = 0, perfN = 0, leave = 0, active = 0, pip = 0;
      employees.forEach(function (e) {
        var md = e.months[m];
        if (!md) return;
        incentive += md.incentive;
        leave += md.leave;
        if (md.incentive > 0) { active++; }
        if (md.performance > 0 || md.incentive > 0) { perfSum += md.performance; perfN++; }
        if (e.pip[m]) pip++;
      });
      return { month: m, incentive: incentive, avgPerf: perfN ? perfSum / perfN : 0, leave: leave, active: active, pip: pip };
    });
  }

  function byProcess() {
    var map = {};
    employees.forEach(function (e) {
      var p = e.currentProcess || "Unassigned";
      if (!map[p]) map[p] = { process: p, count: 0, incentive: 0, perfSum: 0 };
      map[p].count++;
      map[p].incentive += e.totalIncentive;
      map[p].perfSum += e.avgPerformance;
    });
    return Object.keys(map).map(function (k) {
      var r = map[k];
      return { process: r.process, count: r.count, incentive: r.incentive, avgPerf: r.perfSum / r.count };
    }).sort(function (a, b) { return b.incentive - a.incentive; });
  }

  function chartTheme() {
    return {
      color: "#5C7994",
      grid: "rgba(20,48,74,0.07)"
    };
  }

  function baseOptions(extra) {
    var t = chartTheme();
    var opt = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false, labels: { color: t.color, font: { family: "Inter", size: 11 } } },
        tooltip: { backgroundColor: "#FFFFFF", borderColor: "#CFE6F7", borderWidth: 1, titleColor: "#14304A", bodyColor: "#14304A", padding: 10, titleFont: { family: "Space Grotesk" }, bodyFont: { family: "IBM Plex Mono", size: 11.5 }, boxPadding: 4 }
      },
      scales: {
        x: { ticks: { color: t.color, font: { family: "IBM Plex Mono", size: 10.5 } }, grid: { color: "transparent" } },
        y: { ticks: { color: t.color, font: { family: "IBM Plex Mono", size: 10.5 } }, grid: { color: t.grid } }
      }
    };
    return Object.assign(opt, extra || {});
  }

  function mkChart(id, config) {
    var el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el.getContext("2d"), config);
  }

  /* ==================== OVERVIEW ==================== */
  function renderOverview() {
    var totals = monthTotals();
    var totalIncentive = employees.reduce(function (s, e) { return s + e.totalIncentive; }, 0);
    var avgPerf = employees.reduce(function (s, e) { return s + e.avgPerformance; }, 0) / (employees.length || 1);
    var totalLeave = employees.reduce(function (s, e) { return s + e.totalLeave; }, 0);
    var pipCount = employees.filter(function (e) { return e.pipMonthsCount > 0; }).length;
    var top = employees.slice().sort(function (a, b) { return b.totalIncentive - a.totalIncentive; })[0];

    var kpis = [
      { lbl: "Executives Tracked", val: employees.length, accent: "var(--blue)" },
      { lbl: "Total Incentive Paid", val: fmt.inrShort(totalIncentive), accent: "var(--gold)" },
      { lbl: "Avg. Performance", val: fmt.pct(avgPerf), accent: "var(--teal)" },
      { lbl: "Total Leave Days", val: fmt.num(totalLeave), accent: "var(--coral)" },
      { lbl: "On a PIP", val: pipCount, sub: "at least 1 month flagged", accent: "var(--coral)" },
      { lbl: "Top Earner", val: top ? top.name.split(" ")[0] : "—", sub: top ? fmt.inr(top.totalIncentive) : "", accent: "var(--gold)" }
    ];
    document.getElementById("ovKpis").innerHTML = kpis.map(function (k) {
      return '<div class="ticket" style="--accent:' + k.accent + '"><div class="ticket-notch"></div><div class="lbl">' + k.lbl + '</div><div class="val mono">' + k.val + '</div>' + (k.sub ? '<div class="sub">' + k.sub + '</div>' : '') + '</div>';
    }).join("");

    mkChart("chartOvIncentive", {
      type: "bar",
      data: {
        labels: totals.map(function (t) { return t.month; }),
        datasets: [{ data: totals.map(function (t) { return t.incentive; }), backgroundColor: "#E3A94C", borderRadius: 5, maxBarThickness: 44 }]
      },
      options: baseOptions({ plugins: { tooltip: { callbacks: { label: function (c) { return fmt.inr(c.parsed.y); } } } } })
    });

    var procs = byProcess();
    mkChart("chartOvProcess", {
      type: "doughnut",
      data: {
        labels: procs.map(function (p) { return p.process; }),
        datasets: [{ data: procs.map(function (p) { return p.count; }), backgroundColor: procs.map(function (p) { return helpers.processColor(p.process); }), borderColor: "#FFFFFF", borderWidth: 2 }]
      },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: false }, tooltip: baseOptions().plugins.tooltip } }
    });
    document.getElementById("ovProcessLegend").innerHTML = procs.map(function (p) {
      return '<span class="chip"><span class="dot" style="background:' + helpers.processColor(p.process) + '"></span>' + p.process + ' · ' + p.count + '</span>';
    }).join("");

    var top8 = employees.slice().sort(function (a, b) { return b.totalIncentive - a.totalIncentive; }).slice(0, 8);
    mkChart("chartOvTop", {
      type: "bar",
      data: {
        labels: top8.map(function (e) { return e.name; }),
        datasets: [{ data: top8.map(function (e) { return e.totalIncentive; }), backgroundColor: "#4FC9A8", borderRadius: 5, maxBarThickness: 30 }]
      },
      options: baseOptions({ indexAxis: "y", plugins: { tooltip: { callbacks: { label: function (c) { return fmt.inr(c.parsed.x); } } } } })
    });
  }

  /* ==================== RAW DATA ==================== */
  var rawState = { search: "", process: "", sort: "totalIncentive_desc", filters: [] };
  var filterIdSeq = 1;

  var MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var FIELD_DEFS = {
    totalIncentive: { label: "Total Incentive", get: function (e) { return e.totalIncentive; }, disp: function (v) { return fmt.inr(v); } },
    avgPerformance: { label: "Avg Performance", get: function (e) { return e.avgPerformance * 100; }, disp: function (v) { return v + "%"; } },
    totalLeave: { label: "Total Leave", get: function (e) { return e.totalLeave; }, disp: function (v) { return v + " days"; } },
    daysOnRoll: { label: "Days on Roll", get: function (e) { return e.daysOnRoll; }, disp: function (v) { return v; } },
    pipMonthsCount: { label: "PIP Months", get: function (e) { return e.pipMonthsCount; }, disp: function (v) { return v; } },
    tenurePct: { label: "Tenure", get: function (e) { return maxTenureMonths ? (e.monthsOnRoll / maxTenureMonths) * 100 : 0; }, disp: function (v) { return v + "%"; } },
    dojMonth: { label: "Joined Month", get: function (e) { return e.doj ? (new Date(e.doj + "T00:00:00").getMonth() + 1) : null; }, disp: function (v) { return MONTH_NAMES[v - 1]; }, isMonth: true }
  };
  var OP_LABEL = { ">": ">", ">=": "≥", "<": "<", "<=": "≤", "=": "=" };

  function cmp(a, op, b) {
    if (a === null || a === undefined || isNaN(a)) return false;
    switch (op) {
      case ">": return a > b;
      case ">=": return a >= b;
      case "<": return a < b;
      case "<=": return a <= b;
      case "=": return a === b;
      default: return true;
    }
  }

  function tenurePctOf(e) { return maxTenureMonths ? (e.monthsOnRoll / maxTenureMonths) * 100 : 0; }

  function renderRawData() {
    var procSel = document.getElementById("rawProcessFilter");
    var procs = Array.from(new Set(employees.map(function (e) { return e.currentProcess; }))).sort();
    procSel.innerHTML = '<option value="">All processes</option>' + procs.map(function (p) { return '<option value="' + p + '">' + p + '</option>'; }).join("");

    document.getElementById("rawSearch").addEventListener("input", helpers.debounce(function (e) { rawState.search = e.target.value.toLowerCase(); drawRawTable(); }, 150));
    procSel.addEventListener("change", function (e) { rawState.process = e.target.value; drawRawTable(); });
    document.getElementById("rawSort").addEventListener("change", function (e) { rawState.sort = e.target.value; drawRawTable(); });

    var fieldSel = document.getElementById("filterField");
    var valInput = document.getElementById("filterValue");
    var valMonthSel = document.getElementById("filterValueMonth");
    valMonthSel.innerHTML = MONTH_NAMES.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join("");

    function syncValueInput() {
      var isMonth = FIELD_DEFS[fieldSel.value].isMonth;
      valInput.style.display = isMonth ? "none" : "";
      valMonthSel.style.display = isMonth ? "" : "none";
    }
    fieldSel.addEventListener("change", syncValueInput);
    syncValueInput();

    document.getElementById("filterAddBtn").addEventListener("click", function () {
      var field = fieldSel.value;
      var def = FIELD_DEFS[field];
      var op = document.getElementById("filterOp").value;
      var mode = document.getElementById("filterMode").value;
      var value = def.isMonth ? parseInt(valMonthSel.value, 10) : parseFloat(valInput.value);
      if (isNaN(value)) { valInput.focus(); return; }
      rawState.filters.push({ id: filterIdSeq++, field: field, op: op, value: value, mode: mode, label: def.label + " " + OP_LABEL[op] + " " + def.disp(value) });
      valInput.value = "";
      drawRawTable();
    });

    drawRawTable();
  }

  function renderFilterChips() {
    var box = document.getElementById("filterChips");
    if (!rawState.filters.length) { box.innerHTML = ""; return; }
    box.innerHTML = rawState.filters.map(function (f) {
      return '<span class="filter-chip mode-' + f.mode + '">' + f.label + ' · ' + (f.mode === "filter" ? "Filter" : "Highlight") +
        ' <button data-fid="' + f.id + '" title="Remove">✕</button></span>';
    }).join("") + '<button class="btn btn-ghost btn-sm" id="clearFiltersBtn" type="button">Clear all</button>';
    box.querySelectorAll("button[data-fid]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = parseInt(btn.getAttribute("data-fid"), 10);
        rawState.filters = rawState.filters.filter(function (f) { return f.id !== id; });
        drawRawTable();
      });
    });
    var clearBtn = document.getElementById("clearFiltersBtn");
    if (clearBtn) clearBtn.addEventListener("click", function () { rawState.filters = []; drawRawTable(); });
  }

  function drawRawTable() {
    renderFilterChips();

    var hideFilters = rawState.filters.filter(function (f) { return f.mode === "filter"; });
    var highlightFilters = rawState.filters.filter(function (f) { return f.mode === "highlight"; });

    var rows = employees.filter(function (e) {
      var s = rawState.search;
      var matchesSearch = !s || (e.name + " " + e.code + " " + e.currentProcess + " " + e.designation).toLowerCase().indexOf(s) !== -1;
      var matchesProcess = !rawState.process || e.currentProcess === rawState.process;
      var matchesHideFilters = hideFilters.every(function (f) { return cmp(FIELD_DEFS[f.field].get(e), f.op, f.value); });
      return matchesSearch && matchesProcess && matchesHideFilters;
    });

    var sortMap = {
      totalIncentive_desc: function (a, b) { return b.totalIncentive - a.totalIncentive; },
      totalIncentive_asc: function (a, b) { return a.totalIncentive - b.totalIncentive; },
      avgPerformance_desc: function (a, b) { return b.avgPerformance - a.avgPerformance; },
      totalLeave_desc: function (a, b) { return b.totalLeave - a.totalLeave; },
      tenure_desc: function (a, b) { return b.monthsOnRoll - a.monthsOnRoll; },
      name_asc: function (a, b) { return a.name.localeCompare(b.name); }
    };
    rows = rows.slice().sort(sortMap[rawState.sort]);

    var hiddenCount = employees.length - rows.length;
    document.getElementById("rawCount").textContent = rows.length + " of " + employees.length + " rows shown" + (hiddenCount ? " (" + hiddenCount + " filtered out)" : "");

    document.getElementById("rawTbody").innerHTML = rows.map(function (e) {
      var perfClass = e.avgPerformance >= 0.5 ? "pos" : (e.avgPerformance < 0.25 ? "risk" : "warn");
      var isHighlighted = highlightFilters.length > 0 && highlightFilters.some(function (f) { return cmp(FIELD_DEFS[f.field].get(e), f.op, f.value); });
      return "<tr data-code=\"" + e.code + "\"" + (isHighlighted ? ' class="row-highlight"' : "") + ">" +
        "<td class=\"mono\">" + e.code + "</td>" +
        "<td class=\"name\">" + e.name + "</td>" +
        "<td>" + e.designation + "</td>" +
        "<td><span class=\"proc\">" + e.currentProcess + "</span></td>" +
        "<td>" + fmt.date(e.doj) + "</td>" +
        "<td class=\"num\">" + e.daysOnRoll + "</td>" +
        "<td class=\"num\">" + Math.round(tenurePctOf(e)) + "%</td>" +
        "<td class=\"num\" style=\"color:var(--gold)\">" + fmt.inr(e.totalIncentive) + "</td>" +
        "<td class=\"num " + perfClass + "\">" + fmt.pct(e.avgPerformance) + "</td>" +
        "<td class=\"num\" style=\"color:var(--coral)\">" + fmt.num(e.totalLeave) + "</td>" +
        "<td class=\"num\">" + (e.pipMonthsCount > 0 ? '<span class="risk">' + e.pipMonthsCount + "</span>" : "—") + "</td>" +
        "<td>" + sparkline(e) + "</td>" +
        "</tr>";
    }).join("");

    document.querySelectorAll("#rawTbody tr").forEach(function (tr) {
      tr.addEventListener("click", function () { openModal(tr.getAttribute("data-code")); });
    });
  }

  function sparkline(e) {
    var vals = MONTHS.map(function (m) { return e.months[m].incentive; });
    var max = Math.max.apply(null, vals.concat([1]));
    var w = 60, h = 20, bw = w / MONTHS.length;
    var bars = vals.map(function (v, i) {
      var bh = Math.max(1, (v / max) * (h - 2));
      return '<rect x="' + (i * bw + 1) + '" y="' + (h - bh) + '" width="' + (bw - 2) + '" height="' + bh + '" rx="1" fill="#E3A94C" opacity="' + (v > 0 ? 1 : 0.25) + '"/>';
    }).join("");
    return '<svg class="spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' + bars + '</svg>';
  }

  /* ==================== EMPLOYEE MODAL ==================== */
  function openModal(code) {
    var e = employees.find(function (x) { return x.code === code; });
    if (!e) return;
    var tenurePct = maxTenureMonths ? Math.round((e.monthsOnRoll / maxTenureMonths) * 100) : 0;
    document.getElementById("modalName").textContent = e.name;
    document.getElementById("modalSub").textContent = e.code + " · " + e.designation + " · " + e.currentProcess + " · joined " + fmt.date(e.doj);
    document.getElementById("modalKpis").innerHTML = [
      ["Total Incentive", fmt.inr(e.totalIncentive)],
      ["Avg Performance", fmt.pct(e.avgPerformance)],
      ["Total Leave", fmt.num(e.totalLeave) + " days"],
      ["Days on Roll", e.daysOnRoll],
      ["Tenure", fmt.num(e.monthsOnRoll) + " mo · " + tenurePct + "%"],
      ["PIP Months", e.pipMonthsCount]
    ].map(function (kv) { return '<div class="d"><div class="k">' + kv[0] + '</div><div class="v">' + kv[1] + '</div></div>'; }).join("");

    document.getElementById("modalFeedback").innerHTML =
      '<div class="feedback-chip yellow"><div class="k">Quality Feedback</div><div class="v">' + fmt.num(e.qualityFeedback) + '</div></div>' +
      '<div class="feedback-chip green"><div class="k">Positive</div><div class="v">' + fmt.num(e.feedbackPositive) + '</div></div>' +
      '<div class="feedback-chip red"><div class="k">Negative</div><div class="v">' + fmt.num(e.feedbackNegative) + '</div></div>';

    document.getElementById("modalMonthly").innerHTML = MONTHS.map(function (m) {
      var md = e.months[m];
      return "<tr><td>" + m + "</td><td style=\"color:var(--gold)\">" + fmt.inr(md.incentive) + "</td><td>" + fmt.pct(md.performance) + "</td><td style=\"color:var(--coral)\">" + fmt.num(md.leave) + "</td><td>" + (e.pip[m] ? '<span class="risk">flagged</span>' : "—") + "</td></tr>";
    }).join("");
    document.getElementById("modalBackdrop").classList.add("open");
  }
  document.getElementById("modalClose").addEventListener("click", function () { document.getElementById("modalBackdrop").classList.remove("open"); });
  document.getElementById("modalBackdrop").addEventListener("click", function (e) { if (e.target === this) this.classList.remove("open"); });

  /* ==================== MONTHLY REPORT ==================== */
  function renderMonthly() {
    var totals = monthTotals();
    mkChart("chartMoIncLeave", {
      type: "bar",
      data: {
        labels: totals.map(function (t) { return t.month; }),
        datasets: [
          { label: "Incentive", data: totals.map(function (t) { return t.incentive; }), backgroundColor: "#E3A94C", borderRadius: 5, yAxisID: "y" },
          { label: "Leave (days)", data: totals.map(function (t) { return t.leave; }), backgroundColor: "#E36767", borderRadius: 5, yAxisID: "y1" }
        ]
      },
      options: baseOptions({
        plugins: { legend: { display: true } },
        scales: {
          x: baseOptions().scales.x,
          y: Object.assign({}, baseOptions().scales.y, { position: "left" }),
          y1: { position: "right", grid: { display: false }, ticks: { color: "#5C7994", font: { family: "IBM Plex Mono", size: 10.5 } } }
        }
      })
    });

    var perfYScale = Object.assign({}, baseOptions().scales.y);
    perfYScale.ticks = { callback: function (v) { return (v * 100) + "%"; }, color: "#5C7994", font: { family: "IBM Plex Mono", size: 10.5 } };
    mkChart("chartMoPerf", {
      type: "line",
      data: {
        labels: totals.map(function (t) { return t.month; }),
        datasets: [{ data: totals.map(function (t) { return t.avgPerf; }), borderColor: "#4FC9A8", backgroundColor: "rgba(79,201,168,0.15)", fill: true, tension: 0.35, pointBackgroundColor: "#4FC9A8", pointRadius: 4 }]
      },
      options: baseOptions({
        plugins: { tooltip: { callbacks: { label: function (c) { return fmt.pct(c.parsed.y); } } } },
        scales: { x: baseOptions().scales.x, y: perfYScale }
      })
    });

    document.getElementById("monthlyTbody").innerHTML = totals.map(function (t) {
      return "<tr><td>" + t.month + "</td><td class=\"num\" style=\"color:var(--gold)\">" + fmt.inr(t.incentive) + "</td><td class=\"num\">" + fmt.pct(t.avgPerf) + "</td><td class=\"num\" style=\"color:var(--coral)\">" + fmt.num(t.leave) + "</td><td class=\"num\">" + t.active + "</td><td class=\"num\">" + t.pip + "</td></tr>";
    }).join("");
  }

  /* ==================== INSIGHTS ==================== */
  function renderInsights() {
    var top15 = employees.slice().sort(function (a, b) { return b.totalIncentive - a.totalIncentive; }).slice(0, 15);
    mkChart("chartInTop15", {
      type: "bar",
      data: {
        labels: top15.map(function (e) { return e.name; }),
        datasets: [{ data: top15.map(function (e) { return e.totalIncentive; }), backgroundColor: top15.map(function (e) { return helpers.processColor(e.currentProcess); }), borderRadius: 5, maxBarThickness: 22 }]
      },
      options: baseOptions({ indexAxis: "y", plugins: { tooltip: { callbacks: { label: function (c) { return fmt.inr(c.parsed.x) + " · " + top15[c.dataIndex].currentProcess; } } } } })
    });

    var procs = byProcess();
    mkChart("chartInProcess", {
      type: "bar",
      data: {
        labels: procs.map(function (p) { return p.process; }),
        datasets: [
          { label: "Avg Performance (%)", data: procs.map(function (p) { return +(p.avgPerf * 100).toFixed(1); }), backgroundColor: "#4FC9A8", borderRadius: 5, yAxisID: "y" },
          { label: "Total Incentive (₹00s)", data: procs.map(function (p) { return Math.round(p.incentive / 100); }), backgroundColor: "#E3A94C", borderRadius: 5, yAxisID: "y1" }
        ]
      },
      options: baseOptions({
        plugins: { legend: { display: true } },
        scales: {
          x: baseOptions().scales.x,
          y: Object.assign({}, baseOptions().scales.y, { position: "left" }),
          y1: { position: "right", grid: { display: false }, ticks: { color: "#5C7994", font: { family: "IBM Plex Mono", size: 10.5 } } }
        }
      })
    });

    mkChart("chartInScatter", {
      type: "bubble",
      data: {
        datasets: [{
          data: employees.map(function (e) { return { x: +(e.avgPerformance * 100).toFixed(1), y: e.totalIncentive, r: Math.min(18, 4 + e.monthsOnRoll) }; }),
          backgroundColor: employees.map(function (e) { return helpers.processColor(e.currentProcess) + "AA"; })
        }]
      },
      options: baseOptions({
        plugins: {
          tooltip: {
            callbacks: {
              label: function (c) {
                var e = employees[c.dataIndex];
                return e.name + " · " + fmt.pct(e.avgPerformance) + " · " + fmt.inr(e.totalIncentive);
              }
            }
          }
        },
        scales: {
          x: Object.assign({}, baseOptions().scales.x, { title: { display: true, text: "Avg performance (%)", color: "#5C7994", font: { family: "Inter", size: 11 } } }),
          y: Object.assign({}, baseOptions().scales.y, { title: { display: true, text: "Total incentive (₹)", color: "#5C7994", font: { family: "Inter", size: 11 } } })
        }
      })
    });

    var totals = monthTotals();
    mkChart("chartInPipByMonth", {
      type: "bar",
      data: { labels: totals.map(function (t) { return t.month; }), datasets: [{ data: totals.map(function (t) { return t.pip; }), backgroundColor: "#E36767", borderRadius: 5, maxBarThickness: 40 }] },
      options: baseOptions({ plugins: { legend: { display: false } } })
    });

    var risk = employees.filter(function (e) { return e.pipMonthsCount >= 2 || e.totalLeave >= 15; })
      .sort(function (a, b) { return (b.pipMonthsCount - a.pipMonthsCount) || (b.totalLeave - a.totalLeave); });
    document.getElementById("riskTbody").innerHTML = risk.length ? risk.map(function (e) {
      return "<tr><td>" + e.name + "</td><td class=\"proc\">" + e.currentProcess + "</td><td class=\"num risk\">" + e.pipMonthsCount + "</td><td class=\"num\">" + fmt.num(e.totalLeave) + "</td></tr>";
    }).join("") : '<tr><td colspan="4" style="color:var(--slate)">No executives currently cross the risk thresholds — nice.</td></tr>';
  }

})();
