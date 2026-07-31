# WorkCollar Ledger

A static employee incentive/performance dashboard, built to run entirely on
**GitHub Pages** — no server, no database. An **Admin** can upload a refreshed
Excel sheet and publish it straight to the repo from the browser (using a
GitHub Personal Access Token); a **Viewer** gets read-only dashboards.

```
├── index.html            → Login page (role: admin / viewer)
├── dashboard.html         → Main app shell (tabs, modal, chart canvases)
├── assets/
│   ├── style.css          → All design tokens + component styles
│   ├── app.js              → Shared auth + data-loading + formatting helpers
│   ├── dashboard.js        → Renders Overview / Raw Data / Monthly / Insights
│   └── publish.js          → Admin-only: parses .xlsx and commits to GitHub
└── data/
    └── data.json           → Parsed employee data the whole site reads from
```

## Recent updates

- **Theme:** switched to a light sky-blue & white palette with raised "3D" ticket/card surfaces (soft shadows, embossed edges). Data-accent colors (gold=incentive, teal=performance, coral=leave/PIP) stay the same everywhere for consistency.
- **Chart sizing fixed:** every chart canvas now sits in a fixed-height `.chart-box` wrapper — this was the cause of charts growing to an enormous height on Overview/Monthly/Insights.
- **Raw Data — Tenure % column:** shows each executive's tenure as a percentage of the longest-tenured person in the dataset (based on total months on roll).
- **Raw Data — condition filters:** build conditions like "Total Incentive > 20000" or "DOJ Joined Month = March" on any numeric column or join month. Each condition has two modes:
  - **Filter** — hides rows that don't match
  - **Highlight** — keeps every row visible and highlights the matches in amber
  Multiple conditions can be active at once (shown as removable chips); filter-mode conditions combine with AND, highlight-mode conditions combine with OR.
- **Employee modal — feedback breakdown:** now shows Quality Feedback (yellow), Positive (green), and Negative (red) as separate counts, plus tenure.

## 1. What's in each dashboard

| Tab | What it shows |
|---|---|
| **Overview** | KPI tickets (headcount, total incentive, avg performance, leave, PIP count), incentive-by-month chart, client mix donut, top 8 earners |
| **Raw Data** | Every row from the master sheet — searchable, filterable by client process, sortable, with a 6-month incentive sparkline per person. Click any row for full monthly detail |
| **Monthly Report** | Company-wide incentive/leave/performance trend across the 6 months, plus a summary table |
| **Insights** | 4 dashboards: (1) Top 15 earners, (2) performance & incentive by client process, (3) performance-vs-earnings bubble chart, (4) PIP/leave risk board |
| **Publish Sheet** (admin only) | Upload a new `.xlsx`, preview the parsed rows, then commit `data/data.json` to GitHub |

## 2. Deploying to GitHub Pages

1. Create a new GitHub repository (private recommended — see security note below).
2. Push all the files in this folder to the repo's default branch (e.g. `main`):
   ```bash
   git init
   git add .
   git commit -m "Initial WorkCollar Ledger site"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick branch `main`, folder `/ (root)`, Save.
4. Your site will be live at `https://<you>.github.io/<repo>/` within a minute or two.

## 3. Signing in

Demo credentials are hardcoded in `assets/app.js` (`USERS` object):

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `Admin@123` |
| Viewer | `viewer` | `Viewer@123` |

**Change these before sharing the link with anyone**, and read the security
note below — this is intentionally simple, not a real access-control system.

## 4. Publishing an updated sheet (Admin)

1. Log in as Admin → **Publish Sheet** tab.
2. Drop in the updated `.xlsx` (same layout as the original: two header rows,
   then one row per executive — see column mapping below). It's parsed
   entirely in your browser; nothing leaves your machine until you publish.
3. Fill in:
   - **Repo owner / org** — your GitHub username or org
   - **Repository name**
   - **Branch** — usually `main`
   - **File path** — `data/data.json` by default
   - **GitHub Personal Access Token** — see below
4. Click **Publish to GitHub**. This calls the GitHub Contents API to commit
   the new `data/data.json` directly to your repo.
5. GitHub Pages takes ~30–60 seconds to rebuild after the commit. Your own
   browser shows the new numbers immediately (cached locally); ask viewers
   to refresh after a minute.

### Creating the token

Use a **fine-grained personal access token** scoped as narrowly as possible:

1. GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → **Generate new token**.
2. **Repository access:** "Only select repositories" → pick this one repo.
3. **Permissions:** Repository permissions → **Contents: Read and write**. Nothing else is needed.
4. Set a short expiry (30–90 days) and regenerate when it lapses.
5. Paste the token into the Publish tab. It's kept in memory for that page
   load only — never written to localStorage, sessionStorage, or the repo.

## 5. Source sheet column mapping

Both the initial conversion (`convert.py`, used to build the first
`data/data.json`) and the in-browser parser (`assets/publish.js`) expect the
same layout as the original file: **row 1** = month group headers (June, May,
April, March, Feb, Jan, PIP), **row 2** = field names (Code, Remarks,
Employee Name, DOJ, Date, Days, Month, Designation, Incentive/Performance/
Leave × 6 months, Total Incentive, Average Per., Total Leave, Current
Process, Quality Feedback, two unlabeled feedback columns, PIP Jan–Jun +
Total), and data starts on **row 3**. If your sheet's column order changes,
update the index maps at the top of `assets/publish.js` (`MONTH_COLS`,
`PIP_COLS`) and in `convert.py` to match.

## 6. Security notes (read this)

- This is a **static site**. The "login" is a client-side check — anyone who
  opens dev tools or views `assets/app.js` can read the demo passwords and
  could open `dashboard.html` directly. It's meant to keep an internal team's
  casual link-sharing tidy, **not** to protect sensitive data from a
  determined outsider.
- Keep the repository **private** if the incentive data is sensitive, and
  only share the Pages URL / login with people you trust. GitHub Pages sites
  built from a private repo are still publicly reachable at their URL unless
  you're on GitHub Enterprise with Pages access control — plan accordingly.
- The GitHub token an admin pastes into **Publish Sheet** grants write access
  to that one repo's contents. It's never persisted by this app, but treat it
  like a password: don't paste it on a shared computer and let it expire.
- For real authentication (per-user accounts, SSO, audit logs), you'd need a
  backend or a GitHub OAuth App — this app doesn't include one by design, to
  stay 100% static/free to host.

## 7. Local preview

Opening `index.html` directly via `file://` will fail to `fetch()`
`data/data.json` (browsers block that over `file://`). Serve the folder
locally instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```
