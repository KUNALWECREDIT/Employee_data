/* ==========================================================================
   WorkCollar Ledger — shared core (auth, data loading, formatting)
   Loaded on every page. Exposes window.WCLedger
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------- AUTH -------------------------------------------------
     Demo-only client-side auth. Fine for a small internal team on a
     private repo; not real access control (source is readable by anyone
     who can view the page). Swap USERS below, or move to a real auth
     provider, before using this for anything sensitive.
  ------------------------------------------------------------------------- */
  var USERS = {
    admin:  { password: "Admin@123",  role: "admin",  label: "Admin" },
    viewer: { password: "Viewer@123", role: "viewer", label: "Viewer" }
  };
  var SESSION_KEY = "wcledger_session";

  var auth = {
    attempt: function (role, username, password) {
      var u = USERS[username];
      if (u && u.role === role && u.password === password) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({ username: username, role: u.role, label: u.label, at: Date.now() }));
        return { ok: true };
      }
      return { ok: false };
    },
    current: function () {
      try {
        var raw = sessionStorage.getItem(SESSION_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { return null; }
    },
    logout: function () {
      sessionStorage.removeItem(SESSION_KEY);
      window.location.href = "index.html";
    },
    /** Call at the top of a protected page. Redirects to login if not signed
     *  in, or to the dashboard if the role isn't allowed on this page. */
    guard: function (allowedRoles) {
      var s = auth.current();
      if (!s) { window.location.href = "index.html"; return null; }
      if (allowedRoles && allowedRoles.indexOf(s.role) === -1) {
        window.location.href = "dashboard.html";
        return null;
      }
      return s;
    }
  };

  /* ---------------- DATA -------------------------------------------------
     Loads data/data.json (committed by the admin's publish flow / GitHub
     Action). Falls back to a locally-cached override so an admin can
     preview a freshly parsed sheet in this browser before/while GitHub
     Pages finishes rebuilding.
  ------------------------------------------------------------------------- */
  var OVERRIDE_KEY = "wcledger_data_override";
  var FEEDBACK_OVERRIDE_KEY = "wcledger_feedback_override";
  var PENDING_FEEDBACK_KEY = "wcledger_pending_feedback";

  var dataStore = {
    _cache: null,
    _feedbackCache: null,
    load: function () {
      if (dataStore._cache) return Promise.resolve(dataStore._cache);
      var override = null;
      try {
        var raw = localStorage.getItem(OVERRIDE_KEY);
        if (raw) override = JSON.parse(raw);
      } catch (e) { /* ignore corrupt override */ }

      return fetch("data/data.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (published) {
          // Prefer the override only if it looks newer than the published file
          if (override && override.meta && published && published.meta &&
              String(override.meta.generatedAt) > String(published.meta.generatedAt)) {
            dataStore._cache = override;
          } else {
            dataStore._cache = published;
          }
          return dataStore._cache;
        })
        .catch(function () {
          if (override) { dataStore._cache = override; return dataStore._cache; }
          throw new Error("Could not load data/data.json. If you're previewing this locally, serve the folder with a local web server (fetch() of JSON is blocked on file://).");
        });
    },
    setOverride: function (json) {
      try { localStorage.setItem(OVERRIDE_KEY, JSON.stringify(json)); } catch (e) { /* storage full/unavailable — ignore */ }
      dataStore._cache = json;
    },
    clearOverride: function () {
      localStorage.removeItem(OVERRIDE_KEY);
    },

    /** Published, admin-reviewed feedback log (data/feedback.json). Same
     *  override pattern as the main sheet, so a just-published log previews
     *  instantly in the publishing admin's own browser. */
    loadFeedback: function () {
      if (dataStore._feedbackCache) return Promise.resolve(dataStore._feedbackCache);
      var override = null;
      try {
        var raw = localStorage.getItem(FEEDBACK_OVERRIDE_KEY);
        if (raw) override = JSON.parse(raw);
      } catch (e) { /* ignore */ }

      return fetch("data/feedback.json", { cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("http " + r.status); return r.json(); })
        .then(function (published) {
          if (override && override.updatedAt && published && String(override.updatedAt) > String(published.updatedAt || "")) {
            dataStore._feedbackCache = override;
          } else {
            dataStore._feedbackCache = published;
          }
          return dataStore._feedbackCache;
        })
        .catch(function () {
          var fallback = override || { feedbackLog: [], updatedAt: null };
          dataStore._feedbackCache = fallback;
          return fallback;
        });
    },
    setFeedbackOverride: function (json) {
      try { localStorage.setItem(FEEDBACK_OVERRIDE_KEY, JSON.stringify(json)); } catch (e) { /* ignore */ }
      dataStore._feedbackCache = json;
    }
  };

  /* ---------------- PENDING FEEDBACK CACHE ---------------------------------
     Feedback anyone adds from the Quality Feedback tab, before an admin
     publishes it. Lives only in this browser's localStorage — it is NOT
     synced to other devices or users. See the Quality Feedback tab copy
     for the honest explanation of that limitation.
  ------------------------------------------------------------------------- */
  var feedbackCache = {
    list: function () {
      try { return JSON.parse(localStorage.getItem(PENDING_FEEDBACK_KEY) || "[]"); }
      catch (e) { return []; }
    },
    add: function (entry) {
      var list = feedbackCache.list();
      entry = Object.assign({
        id: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
        at: new Date().toISOString()
      }, entry);
      list.push(entry);
      try { localStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify(list)); } catch (e) { /* storage full — ignore */ }
      return entry;
    },
    remove: function (id) {
      var list = feedbackCache.list().filter(function (x) { return x.id !== id; });
      localStorage.setItem(PENDING_FEEDBACK_KEY, JSON.stringify(list));
    },
    clear: function () {
      localStorage.removeItem(PENDING_FEEDBACK_KEY);
    }
  };

  /* ---------------- GITHUB CONTENTS API HELPER ------------------------------
     Shared by the "Publish Sheet" and "Publish Feedback" flows. Commits a
     JSON object to a given repo/path using a token kept only in memory.
  ------------------------------------------------------------------------- */
  var github = {
    commitJSON: function (opts) {
      // opts: { owner, repo, branch, path, token, content(object), message }
      var apiBase = "https://api.github.com/repos/" + opts.owner + "/" + opts.repo + "/contents/" + opts.path;
      var authHeaders = { "Authorization": "token " + opts.token, "Accept": "application/vnd.github+json" };

      return fetch(apiBase + "?ref=" + encodeURIComponent(opts.branch), { headers: authHeaders })
        .then(function (r) { return r.status === 200 ? r.json() : null; })
        .then(function (existing) {
          var body = {
            message: opts.message,
            content: b64EncodeUnicode(JSON.stringify(opts.content, null, 2)),
            branch: opts.branch
          };
          if (existing && existing.sha) body.sha = existing.sha;
          return fetch(apiBase, { method: "PUT", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders), body: JSON.stringify(body) });
        })
        .then(function (r) {
          if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("GitHub returned " + r.status)); });
          return r.json();
        });
    }
  };
  function b64EncodeUnicode(str) { return btoa(unescape(encodeURIComponent(str))); }

  /* ---------------- REPO CONFIG (owner / repo / branch — never the token) --
     Shared between "Publish Sheet" and "TL Feedback → Publish" so filling
     it in once on either tab pre-fills the other. This is the fix for the
     most common cause of a "Not Found" publish error: retyping the repo
     details slightly differently on two separate forms.
  ------------------------------------------------------------------------- */
  var REPO_CONFIG_KEY = "wcledger_repo_config";
  var repoConfig = {
    load: function () {
      try { return JSON.parse(localStorage.getItem(REPO_CONFIG_KEY) || "{}"); }
      catch (e) { return {}; }
    },
    save: function (cfg) {
      try { localStorage.setItem(REPO_CONFIG_KEY, JSON.stringify(cfg)); } catch (e) { /* ignore */ }
    }
  };

  /* ---------------- FORMAT ------------------------------------------------ */
  var fmt = {
    inr: function (n) {
      n = Number(n) || 0;
      return "₹" + Math.round(n).toLocaleString("en-IN");
    },
    inrShort: function (n) {
      n = Number(n) || 0;
      if (Math.abs(n) >= 100000) return "₹" + (n / 100000).toFixed(2) + "L";
      if (Math.abs(n) >= 1000) return "₹" + (n / 1000).toFixed(1) + "k";
      return "₹" + Math.round(n);
    },
    pct: function (n) {
      n = Number(n) || 0;
      return (n * 100).toFixed(1) + "%";
    },
    num: function (n) {
      return (Math.round((Number(n) || 0) * 10) / 10).toLocaleString("en-IN");
    },
    date: function (iso) {
      if (!iso) return "—";
      var d = new Date(iso + "T00:00:00");
      if (isNaN(d)) return iso;
      return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    },
    initials: function (name) {
      return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join("").toUpperCase();
    }
  };

  /* ---------------- MISC HELPERS ------------------------------------------ */
  var helpers = {
    processColor: function (proc) {
      var palette = {
        "KB": "#E3A94C", "Money View": "#4FC9A8", "Olyv": "#6C93E0",
        "Zapcash": "#C77DD1", "HDFC PQ": "#E36767", "Credit Plus": "#7FD1E0",
        "L&T": "#D1A05E", "HFCL": "#9AA6C4", "Quality": "#8FD16A", "Prefer": "#E0A9D1",
        "Unassigned": "#5D6478"
      };
      return palette[proc] || "#8890A4";
    },
    monthOrder: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
    debounce: function (fn, ms) {
      var t;
      return function () {
        var args = arguments, ctx = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(ctx, args); }, ms);
      };
    }
  };

  global.WCLedger = { auth: auth, dataStore: dataStore, feedbackCache: feedbackCache, github: github, repoConfig: repoConfig, fmt: fmt, helpers: helpers };
})(window);
