/* ==========================================================================
   WorkCollar Ledger — admin publish flow
   Parses an uploaded .xlsx entirely in the browser (mirrors the same column
   layout as the original master sheet), previews it, then commits the
   resulting data.json straight to GitHub using the Contents API and a
   Personal Access Token the admin pastes in for this session only.
   ========================================================================== */
(function () {
  "use strict";
  var WC = window.WCLedger;
  var session = WC.auth.current();
  if (!session || session.role !== "admin") return; // publish tab doesn't exist for viewers

  var MONTH_COLS = [
    ["Jun", 8, 9, 10], ["May", 11, 12, 13], ["Apr", 14, 15, 16],
    ["Mar", 17, 18, 19], ["Feb", 20, 21, 22], ["Jan", 23, 24, 25]
  ];
  var PIP_COLS = [["Jan", 33], ["Feb", 34], ["Mar", 35], ["Apr", 36], ["May", 37], ["Jun", 38]];

  var PROCESS_FIX = {
    "olyv": "Olyv", "kb": "KB", "zapcash": "Zapcash", "money view": "Money View",
    "hdfc pq": "HDFC PQ", "credit plus": "Credit Plus", "l&t": "L&T", "hfcl": "HFCL",
    "quality": "Quality", "prefer": "Prefer"
  };

  function num(v, d) {
    d = d || 0;
    if (v === null || v === undefined) return d;
    if (typeof v === "string") {
      var s = v.trim();
      if (s === "" || s === "-" || s === "—" || s.toLowerCase() === "nan") return d;
      v = s;
    }
    var f = parseFloat(v);
    return isNaN(f) ? d : f;
  }
  function txt(v, d) {
    d = d || "";
    if (v === null || v === undefined) return d;
    var s = String(v).trim();
    if (s === "" || s === "-" || s.toLowerCase() === "nan") return d;
    return s;
  }
  function normDesignation(v) {
    var s = txt(v).toLowerCase().replace(/\./g, "");
    if (s.indexOf("senior") !== -1 || s.indexOf("sr") === 0 || s.indexOf(" sr") !== -1) return "Senior Executive - Sales";
    return "Executive - Sales";
  }
  function normProcess(v) {
    var s = txt(v);
    if (!s) return "Unassigned";
    var key = s.replace(/\s+/g, " ").trim().toLowerCase();
    return PROCESS_FIX[key] || s.replace(/\s+/g, " ").trim();
  }
  function isoDate(v) {
    if (v === null || v === undefined || v === "") return null;
    var d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
  function pad(n) { return n < 10 ? "0" + n : "" + n; }

  function parseWorkbook(arrayBuffer) {
    var wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });
    var sheetName = wb.SheetNames.indexOf("Sheet1") !== -1 ? "Sheet1" : wb.SheetNames[0];
    var sheet = wb.Sheets[sheetName];
    var rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });

    var employees = [];
    for (var i = 2; i < rows.length; i++) {
      var row = rows[i] || [];
      var code = txt(row[0]);
      if (!code) continue;

      var months = {};
      MONTH_COLS.forEach(function (mc) {
        months[mc[0]] = { incentive: num(row[mc[1]]), performance: num(row[mc[2]]), leave: num(row[mc[3]]) };
      });
      var pip = {}, pipCount = 0;
      PIP_COLS.forEach(function (pc) {
        var flag = txt(row[pc[1]]) === "1" ? 1 : 0;
        pip[pc[0]] = flag;
        pipCount += flag;
      });

      employees.push({
        code: code,
        remarks: txt(row[1]),
        name: txt(row[2]),
        doj: isoDate(row[3]),
        asOfDate: isoDate(row[4]),
        daysOnRoll: Math.round(num(row[5])),
        monthsOnRoll: Math.round(num(row[6]) * 100) / 100,
        designation: normDesignation(row[7]),
        months: months,
        totalIncentive: num(row[26]),
        avgPerformance: num(row[27]),
        totalLeave: num(row[28]),
        currentProcess: normProcess(row[29]),
        qualityFeedback: num(row[30]),
        feedbackPositive: num(row[31]),
        feedbackNegative: num(row[32]),
        pip: pip,
        pipMonthsCount: pipCount,
        pipTotalReported: num(row[39])
      });
    }

    var now = new Date();
    var generatedAt = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) + " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
    return {
      meta: { months: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"], generatedAt: generatedAt, employeeCount: employees.length, sourceFile: "uploaded via Publish Sheet" },
      employees: employees
    };
  }

  /* -------------------- wire up the UI -------------------- */
  var dropZone = document.getElementById("dropZone");
  var fileInput = document.getElementById("fileInput");
  var parseStatus = document.getElementById("parseStatus");
  var publishBtn = document.getElementById("publishBtn");
  var previewCard = document.getElementById("previewCard");
  var parsedData = null;

  if (!dropZone) return; // viewer never has this markup

  (function prefillRepoConfig() {
    var cfg = WC.repoConfig.load();
    if (cfg.owner) document.getElementById("ghOwner").value = cfg.owner;
    if (cfg.repo) document.getElementById("ghRepo").value = cfg.repo;
    if (cfg.branch) document.getElementById("ghBranch").value = cfg.branch;
  })();

  ["dragover", "dragenter"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    dropZone.addEventListener(evt, function (e) { e.preventDefault(); dropZone.classList.remove("drag"); });
  });
  dropZone.addEventListener("drop", function (e) {
    if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });
  fileInput.addEventListener("change", function (e) {
    if (e.target.files.length) handleFile(e.target.files[0]);
  });

  function showStatus(el, kind, html) {
    el.className = "status-box show " + kind;
    el.innerHTML = html;
  }

  function handleFile(file) {
    showStatus(parseStatus, "info", "Parsing " + file.name + " <span class=\"progress-dots\"><span></span><span></span><span></span></span>");
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        parsedData = parseWorkbook(e.target.result);
        if (!parsedData.employees.length) throw new Error("No employee rows found — check the sheet still has two header rows followed by data.");
        showStatus(parseStatus, "ok", "Parsed <b>" + parsedData.employees.length + "</b> executive rows from <b>" + file.name + "</b>. Review the preview below, then publish.");
        publishBtn.disabled = false;
        renderPreview(parsedData);
      } catch (err) {
        showStatus(parseStatus, "err", "Couldn't parse that file: " + err.message);
        publishBtn.disabled = true;
        previewCard.style.display = "none";
      }
    };
    reader.onerror = function () { showStatus(parseStatus, "err", "Couldn't read that file."); };
    reader.readAsArrayBuffer(file);
  }

  function renderPreview(data) {
    previewCard.style.display = "";
    document.getElementById("previewCount").textContent = data.employees.length + " total rows parsed — showing the first 6.";
    document.getElementById("previewTbody").innerHTML = data.employees.slice(0, 6).map(function (e) {
      return "<tr><td class=\"mono\">" + e.code + "</td><td>" + e.name + "</td><td>" + e.currentProcess + "</td><td class=\"num\">" + WC.fmt.inr(e.totalIncentive) + "</td><td class=\"num\">" + WC.fmt.pct(e.avgPerformance) + "</td></tr>";
    }).join("");
  }

  publishBtn.addEventListener("click", function () {
    if (!parsedData) return;
    var owner = document.getElementById("ghOwner").value.trim();
    var repo = document.getElementById("ghRepo").value.trim();
    var branch = document.getElementById("ghBranch").value.trim() || "main";
    var path = document.getElementById("ghPath").value.trim() || "data/data.json";
    var token = document.getElementById("ghToken").value.trim();
    var statusEl = document.getElementById("publishStatus");

    if (!owner || !repo || !token) {
      showStatus(statusEl, "err", "Fill in the repo owner, repo name, and a GitHub token first.");
      return;
    }

    publishBtn.disabled = true;
    showStatus(statusEl, "info", "Publishing to " + owner + "/" + repo + " <span class=\"progress-dots\"><span></span><span></span><span></span></span>");

    WC.github.commitJSON({
      owner: owner, repo: repo, branch: branch, path: path, token: token,
      content: parsedData,
      message: "Publish updated employee sheet (" + parsedData.employees.length + " rows) — " + parsedData.meta.generatedAt
    })
      .then(function (res) {
        WC.dataStore.setOverride(parsedData); // preview instantly in this browser while Pages rebuilds
        WC.repoConfig.save({ owner: owner, repo: repo, branch: branch }); // remember what worked, so TL Feedback pre-fills the same values
        var commitUrl = res.commit && res.commit.html_url;
        showStatus(statusEl, "ok",
          "Published! Committed to <b>" + owner + "/" + repo + "@" + branch + "</b>." +
          (commitUrl ? " <a href=\"" + commitUrl + "\" target=\"_blank\" rel=\"noopener\" style=\"color:#0F7A54;text-decoration:underline;\">View commit ↗</a>" : "") +
          " GitHub Pages usually takes 30–60 seconds to rebuild — this browser already shows the new numbers. Reload the dashboard tabs to see them."
        );
        document.getElementById("ghToken").value = ""; // never leave the token sitting in the field
      })
      .catch(function (err) {
        showStatus(statusEl, "err", "Publish failed: " + err.message);
      })
      .finally(function () {
        publishBtn.disabled = false;
      });
  });
})();
