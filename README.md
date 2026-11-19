# FailForward — the store that refuses to deploy until Kane signs off

**Kane CLI Hackathon entry.** FailForward is a demo store plus a deploy gate: an
AI coding agent builds the store, Kane CLI verifies it in a real browser, and
nothing ships until Kane passes. When Kane finds a bug, the failure lands in
`kane-failure.md`, the agent fixes the code, and the loop runs again.

```
agent writes code ──> kane-loop runs 4 flows in a real browser ──> all pass?
      ▲                                                              │ yes
      │                                                              ▼
      └──── agent reads kane-failure.md, fixes, re-runs ──> deploy gate OPENS
```

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Demo account: **demo@failforward.dev / demo1234** (also shown on the login page).

Requirements: Node 20+, plus Google Chrome and a TestMu AI login for the Kane
runs themselves (see [Running Kane](#running-kane)).

## The demo store

A dependency-light Express app (`server.js`) with a plain HTML/CSS/JS
frontend (`public/`) — no build step, no external services, no real money.

| Page | What it does |
| --- | --- |
| `/` | Product catalog (8 products), cart drawer, checkout link |
| `/login.html` | Sign in / create account, seeded demo account |
| `/checkout.html` | Order summary + checkout form (fake payment, always succeeds) |
| `/order.html?id=SG-…` | Order confirmation with order id |
| `/kane` | Kane dashboard: last run verdicts, evidence links, bug status |

API: `GET /health`, `GET /api/config`, `GET /api/products`,
`POST /api/register`, `POST /api/login`, `POST /api/checkout`,
`GET /api/orders/:id`, `GET /api/kane-report`. State is in-memory and resets
on restart — this is a demo store, and the login has no real security.

## The chaos toggle: break it, then heal it

`CHECKOUT_BUG=1` arms the intentional demo bug: the **Place order** button
silently does nothing. No request, no navigation, no error message — the exact
way a real frontend regression feels to a user. The checkout API keeps
working; the bug lives in the button handler (`public/checkout.js`,
`placeOrder()`), which is why only a real-browser check catches it.

```bash
# 1. Break it
npm run demo:break        # starts the store with CHECKOUT_BUG=1

# 2. Kane catches it (in another terminal)
npm run kane:flow -- checkout-button-responds   # FAILS, writes kane-failure.md

# 3. Heal it: stop the server, restart clean
npm run demo:heal         # normal start, bug off

# 4. Kane confirms the heal
npm run kane              # all 4 flows pass, gate opens
```

`npm run smoke` proves the toggle without a browser: it starts the server in
both modes, checks `/api/config`, and imports `placeOrder()` to show the
button makes zero API calls while the bug is on.

## The Kane flows

Plain-English objectives in `kane/flows/`. The loop extracts the
`Objective:` line from each file and passes it inline to `kane-cli run`
(`kane-cli run` does not accept `.md` paths — see the notes below).

| Flow | Objective (short) | Catches |
| --- | --- | --- |
| `signup-login` | Register, log out, sign in as the demo user | Auth regressions |
| `browse-add-to-cart` | Add two products, assert cart count and total | Catalog / cart regressions |
| `checkout-happy-path` | Full purchase, assert order id `SG-…` | Checkout regressions |
| `checkout-button-responds` | Click Place order, assert navigation within 10s | **The chaos bug** |

## The closed loop

`scripts/kane-loop.mjs` is the loop. It never edits app code — the agent does
that, guided by `kane-failure.md`. That is the honest loop, and it is the
whole point of the entry.

```bash
npm run kane                              # all flows
npm run kane:flow -- checkout-happy-path  # one flow
node scripts/kane-loop.mjs --base-url http://localhost:3000 --timeout 300 --max-steps 50
```

What one run does:

1. **Preflight, before spending credits** — checks `kane-cli` is installed,
   the app answers `/health`, and `kane-cli whoami` shows a login. Any miss
   prints exactly what to do and exits 2.
2. **Runs each flow** with
   `kane-cli run "<objective>" --agent --headless --url <base-url> --timeout <s> --max-steps <n> --name failforward-<flow>`,
   tagged with `KANE_CLI_USER_AGENT=failforward-kane-loop`.
3. **Parses the NDJSON stream**, scripting against the stable `run_end`
   event (`status`, `summary`, `reason`, `duration`, `credits`, `test_url`,
   `session_dir`) and collecting failed step events for the failure report.
4. **Writes `kane-report.json`** (per-flow verdict, exit code, duration,
   credits, evidence links) and appends one line to `kane/runs.jsonl`.
   The `/kane` dashboard reads the report.
5. **On failure writes `kane-failure.md`** — failing flow, failing step,
   evidence link, and the fix direction from the flow file — and exits 1.
   On all pass it deletes any stale failure file and exits 0.

Exit codes follow Kane's contract: `0` passed, `1` failed, `2` setup/auth
error, `3` timeout. One wrinkle, found while building this: v0.10.6 was
observed exiting **1** (not the documented 2) for `Not authenticated`, with
no `run_end` event. The loop therefore detects auth failure by message as
well as by exit code, and aborts the remaining flows instead of burning
credits on runs that cannot start.

## Running Kane

Kane runs need a TestMu AI account and credits — the CLI is free to install,
but every run is billed to the account.

```bash
npm install -g @testmuai/kane-cli
kane-cli login            # interactive OAuth, or:
kane-cli login --username <email> --access-key <key>   # non-interactive
```

New TestMu AI accounts get 10,000 free credits, valid 30 days. The access key
comes from the TestMu AI dashboard under Settings → Keys. Chrome must be
installed locally (Kane drives real Chrome via CDP); in CI the workflow
installs it.

## CI: the merge gate

`.github/workflows/kane-gate.yml` runs on every pull request to `main`:
install → start the store → run the loop → post the verdict (with a link to
each run) as a PR comment → fail the job when Kane fails.

One-time setup:

1. Add two repository secrets: `LT_USERNAME` (TestMu AI email) and
   `LT_ACCESS_KEY` (dashboard access key). This username + access-key pair is
   the login method the Kane CLI docs prescribe for CI; there is no single
   `TESTMU_API_KEY` for `kane-cli login`.
2. Make `kane-gate` a required status check in branch protection for `main`,
   so a red gate actually blocks the merge.

## How this maps to the judging criteria

| Criterion (25% each) | What FailForward shows |
| --- | --- |
| **Ships** | A real store that runs end to end: browse, cart, auth, checkout, order confirmation — `npm install && npm start`, no other services. |
| **Verified** | Kane runs 4 flows in a real browser and catches a real (planted) bug: the dead checkout button. The report and evidence links prove it. |
| **Closed loop** | The loop is the product: `kane-failure.md` feeds the failure back to the agent, the agent fixes, the loop re-runs. The CI gate enforces it on every PR. |
| **Craft** | A gate any team would install tonight: one command to run, one file to read on failure, one workflow to copy into any repo. |

## Kane CLI flags used

Every flag below was verified against the installed CLI (`kane-cli run
--help`, v0.10.6) and the official docs (GitHub `LambdaTest/kane-cli` README,
"NDJSON output" and "Exit codes" sections; `testmuai.com/kane-cli/agents.md`).

| Flag | Why |
| --- | --- |
| `run "<objective>"` | Inline plain-English objective (`.md` paths are not accepted by `run`) |
| `--agent` | NDJSON on stdout; the only output a script can parse |
| `--headless` | No visible browser window; required in CI |
| `--url <base-url>` | Start URL for the run |
| `--timeout <seconds>` | Hard kill per flow (default 300) |
| `--max-steps <n>` | Agent step cap (default 50, the CLI default) |
| `--name failforward-<flow>` | Named session per flow |
| `KANE_CLI_USER_AGENT` | Tags runs as coming from this loop (per the agent guide) |

## Project structure

```
failforward/
├── server.js                  Express demo store (port 3000, /health, API)
├── public/                    Frontend: store, auth, checkout, order, /kane
│   └── checkout.js            Place-order logic incl. the intentional bug
├── kane/flows/                Plain-English Kane objectives (4 flows)
├── scripts/
│   ├── kane-loop.mjs          The closed loop runner
│   ├── smoke.mjs              No-browser smoke test (npm run smoke)
│   └── demo-break.mjs         Start with CHECKOUT_BUG=1
├── .github/workflows/
│   └── kane-gate.yml          PR merge gate
├── kane-report.json           Generated by the loop (gitignored)
├── kane-failure.md            Generated on failure (gitignored)
└── kane/runs.jsonl            Run history, one JSON line per loop run
```

## License

MIT — see `LICENSE`.
