/* ==========================================================================
   WorkCollar Ledger — TL Feedback tab (live crowd-sourced feedback log)
   Note: the sheet-derived Quality Feedback KPIs/charts in the Quality
   Feedback tab are rendered here too (renderSheetKpisAndCharts), since they
   read the same employees array — but the manual add/pending/publish flow
   below now lives on its own "TL Feedback" tab, not mixed into Quality
   Feedback.
   Two halves:
   1) Sheet-derived KPIs/charts, from the existing feedbackPositive /
      feedbackNegative / qualityFeedback columns in data/data.json.
   2) A live, crowd-sourced feedback log: anyone signed in can log a note
      on an executive; it's cached in THIS browser's localStorage and shows
      up instantly ("pending"). It is NOT synced to other devices — an
      admin has to publish it (commits data/feedback.json to GitHub) before
      it becomes visible to everyone else.
   ========================================================================== */
(function () {
  "use strict";
  var WC = window.WCLedger;
  var fmt = WC.fmt, helpers = WC.helpers;
  var session = WC.auth.current();
  if (!session) return; // dashboard.js's guard already redirects; this is just a safety net

  var employees = [];
  var employeeByKey = {};
  var qfCharts = {};

  function mkChart(id, config) {
    var el = document.getElementById(id);
    if (!el) return;
    if (qfCharts[id]) qfCharts[id].destroy();
    qfCharts[id] = new Chart(el.getContext("2d"), config);
  }

  function baseOptions(extra) {
    var opt = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { backgroundColor: "#FFFFFF", borderColor: "#CFE6F7", borderWidth: 1, titleColor: "#14304A", bodyColor: "#14304A", padding: 10, titleFont: { family: "Space Grotesk" }, bodyFont: { family: "IBM Plex Mono", size: 11.5 } }
      },
      scales: {
        x: { ticks: { color: "#5C7994", font: { family: "IBM Plex Mono", size: 10.5 } }, grid: { color: "transparent" } },
        y: { ticks: { color: "#5C7994", font: { family: "IBM Plex Mono", size: 10.5 } }, grid: { color: "rgba(20,48,74,0.07)" } }
      }
    };
    return Object.assign(opt, extra || {});
  }

  /* -------------------- load data, render both halves -------------------- */
  WC.dataStore.load().then(function (json) {
    employees = json.employees;
    employees.forEach(function (e) {
      employeeByKey[(e.name + " — " + e.code).toLowerCase()] = e;
      employeeByKey[e.code.toLowerCase()] = e;
    });
    document.getElementById("fbEmployeeList").innerHTML = employees.map(function (e) {
      return '<option value="' + e.name + " — " + e.code + '">';
    }).join("");

    renderSheetKpisAndCharts();
  }).catch(function () { /* dashboard.js already shows a load error if this fails */ });

  function renderSheetKpisAndCharts() {
    var totalQF = employees.reduce(function (s, e) { return s + e.qualityFeedback; }, 0);
    var totalPos = employees.reduce(function (s, e) { return s + e.feedbackPositive; }, 0);
    var totalNeg = employees.reduce(function (s, e) { return s + e.feedbackNegative; }, 0);
    var netSentiment = (totalPos + totalNeg) ? (totalPos / (totalPos + totalNeg)) * 100 : 0;

    document.getElementById("qfKpis").innerHTML = [
      { lbl: "Total Quality Feedback", val: fmt.num(totalQF), accent: "var(--gold)" },
      { lbl: "Positive Mentions", val: fmt.num(totalPos), accent: "var(--teal)" },
      { lbl: "Negative Mentions", val: fmt.num(totalNeg), accent: "var(--coral)" },
      { lbl: "Net Sentiment", val: Math.round(netSentiment) + "%", accent: "var(--blue)" }
    ].map(function (k) {
      return '<div class="ticket" style="--accent:' + k.accent + '"><div class="ticket-notch"></div><div class="lbl">' + k.lbl + '</div><div class="val mono">' + k.val + '</div></div>';
    }).join("");

    var top10 = employees.slice().sort(function (a, b) { return b.feedbackPositive - a.feedbackPositive; }).slice(0, 10);
    mkChart("chartQfTop", {
      type: "bar",
      data: { labels: top10.map(function (e) { return e.name; }), datasets: [{ data: top10.map(function (e) { return e.feedbackPositive; }), backgroundColor: "#1FA184", borderRadius: 5, maxBarThickness: 22 }] },
      options: baseOptions({ indexAxis: "y" })
    });

    mkChart("chartQfSplit", {
      type: "doughnut",
      data: { labels: ["Positive", "Negative"], datasets: [{ data: [totalPos, totalNeg], backgroundColor: ["#1FA184", "#D6494E"], borderColor: "#FFFFFF", borderWidth: 2 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: "62%", plugins: { legend: { display: true, labels: { color: "#5C7994", font: { family: "Inter", size: 11.5 } } } } }
    });
  }

  /* -------------------- resolve typed employee input -------------------- */
  function resolveEmployee(text) {
    text = (text || "").trim().toLowerCase();
    if (!text) return null;
    if (employeeByKey[text]) return employeeByKey[text];
    // fallback: unique case-insensitive substring match on name
    var matches = employees.filter(function (e) { return e.name.toLowerCase().indexOf(text) !== -1; });
    return matches.length === 1 ? matches[0] : null;
  }

  /* -------------------- add-feedback form -------------------- */
  var fbEmployee = document.getElementById("fbEmployee");
  var fbType = document.getElementById("fbType");
  var fbComment = document.getElementById("fbComment");
  var fbSubmitBtn = document.getElementById("fbSubmitBtn");
  var fbFormStatus = document.getElementById("fbFormStatus");

  function showBox(el, kind, html) { el.className = "status-box show " + kind; el.innerHTML = html; }

  fbSubmitBtn.addEventListener("click", function () {
    var emp = resolveEmployee(fbEmployee.value);
    var comment = fbComment.value.trim();
    if (!emp) { showBox(fbFormStatus, "err", "Couldn't match that to one executive — pick a suggestion from the list or use their code."); return; }
    if (!comment) { showBox(fbFormStatus, "err", "Add a short comment before submitting."); return; }

    WC.feedbackCache.add({ code: emp.code, name: emp.name, type: fbType.value, comment: comment, by: session.label + " (" + session.username + ")" });
    fbEmployee.value = ""; fbComment.value = "";
    showBox(fbFormStatus, "ok", "Added to the pending list below — visible instantly in this browser.");
    renderPending();
  });

  /* -------------------- pending (this-browser) list -------------------- */
  var TYPE_CLASS = { positive: "pos", negative: "risk", note: "warn" };
  var TYPE_LABEL = { positive: "Positive", negative: "Negative", note: "Note" };

  function renderPending() {
    var list = WC.feedbackCache.list().slice().sort(function (a, b) { return b.at.localeCompare(a.at); });
    document.getElementById("fbPendingCount").textContent = list.length;
    var tbody = document.getElementById("fbPendingTbody");
    tbody.innerHTML = list.length ? list.map(function (f) {
      return "<tr><td>" + f.name + " <span class=\"proc\">" + f.code + "</span></td>" +
        "<td class=\"" + TYPE_CLASS[f.type] + "\">" + TYPE_LABEL[f.type] + "</td>" +
        "<td>" + escapeHtml(f.comment) + "</td>" +
        "<td class=\"proc\">" + escapeHtml(f.by) + "</td>" +
        "<td class=\"proc\">" + new Date(f.at).toLocaleString() + "</td>" +
        "<td><button class=\"btn btn-ghost btn-sm\" data-remove=\"" + f.id + "\">Remove</button></td></tr>";
    }).join("") : '<tr><td colspan="6" style="color:var(--slate)">No pending feedback in this browser yet.</td></tr>';

    tbody.querySelectorAll("button[data-remove]").forEach(function (btn) {
      btn.addEventListener("click", function () { WC.feedbackCache.remove(btn.getAttribute("data-remove")); renderPending(); });
    });

    if (session.role === "admin") {
      document.getElementById("fbAdminPublishWrap").style.display = "";
      document.getElementById("fbAdminPublishPanel").style.display = list.length ? "" : "none";
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }

  /* -------------------- published log -------------------- */
  function renderPublishedLog() {
    WC.dataStore.loadFeedback().then(function (fb) {
      var log = (fb.feedbackLog || []).slice().sort(function (a, b) { return (b.at || "").localeCompare(a.at || ""); });
      document.getElementById("fbLogCount").textContent = log.length + " entries";
      document.getElementById("fbLogTbody").innerHTML = log.length ? log.map(function (f) {
        return "<tr><td>" + f.name + " <span class=\"proc\">" + f.code + "</span></td>" +
          "<td class=\"" + TYPE_CLASS[f.type] + "\">" + TYPE_LABEL[f.type] + "</td>" +
          "<td>" + escapeHtml(f.comment) + "</td>" +
          "<td class=\"proc\">" + escapeHtml(f.by) + "</td>" +
          "<td class=\"proc\">" + new Date(f.at).toLocaleString() + "</td></tr>";
      }).join("") : '<tr><td colspan="5" style="color:var(--slate)">Nothing published yet.</td></tr>';
    });
  }

  /* -------------------- admin: publish pending to GitHub -------------------- */
  var fbPublishBtn = document.getElementById("fbPublishBtn");
  if (fbPublishBtn) {
    fbPublishBtn.addEventListener("click", function () {
      var pending = WC.feedbackCache.list();
      if (!pending.length) return;
      var owner = document.getElementById("fbGhOwner").value.trim();
      var repo = document.getElementById("fbGhRepo").value.trim();
      var branch = document.getElementById("fbGhBranch").value.trim() || "main";
      var path = document.getElementById("fbGhPath").value.trim() || "data/feedback.json";
      var token = document.getElementById("fbGhToken").value.trim();
      var statusEl = document.getElementById("fbPublishStatus");

      if (!owner || !repo || !token) { showBox(statusEl, "err", "Fill in the repo owner, repo name, and a GitHub token first."); return; }

      fbPublishBtn.disabled = true;
      showBox(statusEl, "info", "Merging and publishing <span class=\"progress-dots\"><span></span><span></span><span></span></span>");

      WC.dataStore.loadFeedback().then(function (current) {
        var merged = {
          feedbackLog: (current.feedbackLog || []).concat(pending),
          updatedAt: new Date().toISOString()
        };
        return WC.github.commitJSON({
          owner: owner, repo: repo, branch: branch, path: path, token: token,
          content: merged,
          message: "Publish " + pending.length + " feedback entr" + (pending.length === 1 ? "y" : "ies")
        }).then(function (res) {
          WC.dataStore.setFeedbackOverride(merged);
          WC.feedbackCache.clear();
          var commitUrl = res.commit && res.commit.html_url;
          showBox(statusEl, "ok",
            "Published " + pending.length + " entr" + (pending.length === 1 ? "y" : "ies") + " to <b>" + owner + "/" + repo + "@" + branch + "</b>." +
            (commitUrl ? " <a href=\"" + commitUrl + "\" target=\"_blank\" rel=\"noopener\" style=\"color:#0F7A54;text-decoration:underline;\">View commit ↗</a>" : "")
          );
          document.getElementById("fbGhToken").value = "";
          renderPending();
          renderPublishedLog();
        });
      }).catch(function (err) {
        showBox(statusEl, "err", "Publish failed: " + err.message);
      }).finally(function () {
        fbPublishBtn.disabled = false;
      });
    });
  }

  renderPending();
  renderPublishedLog();
})();
