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

  var dataStore = {
    _cache: null,
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

  global.WCLedger = { auth: auth, dataStore: dataStore, fmt: fmt, helpers: helpers };
})(window);
