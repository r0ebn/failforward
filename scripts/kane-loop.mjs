// FailForward Kane loop — the closed loop between the coding agent and Kane CLI.
//
// For every flow in kane/flows/*.md this script:
//   1. reads the plain-English objective out of the flow file,
//   2. runs it in a real browser with `kane-cli run` (--agent --headless),
//   3. parses the NDJSON stream, scripting against the stable `run_end` event,
//   4. writes kane-report.json (per-flow verdicts + evidence links) and
//      appends one line to kane/runs.jsonl (run history),
//   5. on any failure writes kane-failure.md and exits 1; on all pass exits 0.
//
// The loop NEVER edits app code. That is the honest loop: the agent reads
// kane-failure.md, fixes the code, and re-runs this script until it is green.
//
// Kane CLI facts this script relies on (all verified, see README):
//   - `kane-cli run "<objective>" --agent` streams NDJSON on stdout; the
//     terminal `run_end` event has the stable schema {type, status, summary,
//     reason, duration, credits, test_url, session_dir, ...}.
//   - Exit codes: 0 passed, 1 failed, 2 setup/auth error, 3 timeout.
//     NOTE: v0.10.6 was observed exiting 1 (not 2) for "Not authenticated",
//     so auth failures are also detected by message, not by exit code alone.
//   - `kane-cli run` takes an inline objective string only; it does NOT
//     accept .md paths. The flow files here are objective sources, not
//     _test.md recordings (those run via `kane-cli testmd run`).
//
// Usage:
//   node scripts/kane-loop.mjs [--flow <name>] [--base-url <url>]
//                              [--timeout <seconds>] [--max-steps <n>]

import { spawn, spawnSync } from 'node:child_process';
import { appendFile, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const FLOWS_DIR = path.join(ROOT, 'kane', 'flows');
const REPORT_PATH = path.join(ROOT, 'kane-report.json');
const FAILURE_PATH = path.join(ROOT, 'kane-failure.md');
const HISTORY_PATH = path.join(ROOT, 'kane', 'runs.jsonl');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_TIMEOUT_SECONDS = 300;
const DEFAULT_MAX_STEPS = 50;
const AUTH_PATTERNS = /not authenticated|not logged in|not configured|token\s+missing/i;

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { flow: null, baseUrl: DEFAULT_BASE_URL, timeout: DEFAULT_TIMEOUT_SECONDS, maxSteps: DEFAULT_MAX_STEPS };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: node scripts/kane-loop.mjs [--flow <name>] [--base-url <url>] [--timeout <seconds>] [--max-steps <n>]');
      console.log('  --flow       Run one flow by name (e.g. checkout-happy-path). Default: all flows.');
      console.log(`  --base-url   App under test. Default: ${DEFAULT_BASE_URL}`);
      console.log(`  --timeout    Per-flow Kane timeout in seconds. Default: ${DEFAULT_TIMEOUT_SECONDS}`);
      console.log(`  --max-steps  Per-flow Kane agent step cap. Default: ${DEFAULT_MAX_STEPS}`);
      process.exit(0);
    } else if (arg === '--flow') {
      args.flow = argv[++i];
    } else if (arg === '--base-url') {
      args.baseUrl = argv[++i];
    } else if (arg === '--timeout') {
      args.timeout = Number(argv[++i]);
    } else if (arg === '--max-steps') {
      args.maxSteps = Number(argv[++i]);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!args.flow && (args.flow === '')) args.flow = null;
  if (!args.baseUrl || Number.isNaN(args.timeout) || Number.isNaN(args.maxSteps)) {
    console.error('Invalid arguments. Run with --help for usage.');
    process.exit(2);
  }
  args.baseUrl = args.baseUrl.replace(/\/$/, '');
  return args;
}

// ---------------------------------------------------------------------------
// Flow files
// ---------------------------------------------------------------------------

function parseFlowFile(text, file) {
  const field = (name) => {
    const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const name = field('Flow') || path.basename(file, '.md');
  const objective = field('Objective');
  if (!objective) {
    throw new Error(`${file} has no "Objective:" line.`);
  }
  return {
    name,
    file,
    target: field('Target') || DEFAULT_BASE_URL,
    objective,
    expected: field('Expected'),
    fixHint: field('Fix hint'),
  };
}

async function loadFlows(onlyName) {
  const files = (await readdir(FLOWS_DIR)).filter((f) => f.endsWith('.md')).sort();
  const flows = [];
  for (const file of files) {
    const text = await readFile(path.join(FLOWS_DIR, file), 'utf8');
    flows.push(parseFlowFile(text, file));
  }
  if (onlyName) {
    const match = flows.filter((f) => f.name === onlyName);
    if (match.length === 0) {
      console.error(`No flow named "${onlyName}". Available: ${flows.map((f) => f.name).join(', ')}`);
      process.exit(2);
    }
    return match;
  }
  return flows;
}

// ---------------------------------------------------------------------------
// Preflight checks (fail fast with a clear message, before spending credits)
// ---------------------------------------------------------------------------

function checkCliInstalled() {
  const result = spawnSync('kane-cli', ['--version'], { encoding: 'utf8', timeout: 15000 });
  if (result.error && result.error.code === 'ENOENT') {
    console.error('ERROR: kane-cli is not installed.');
    console.error('Install it with: npm install -g @testmuai/kane-cli');
    console.error('Then authenticate with: kane-cli login');
    return false;
  }
  if (result.status !== 0) {
    console.error(`ERROR: kane-cli --version failed (exit ${result.status}). Try reinstalling it.`);
    return false;
  }
  console.log(`kane-cli ${result.stdout.trim()} detected.`);
  return true;
}

async function checkAppReachable(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      console.error(`ERROR: ${baseUrl}/health returned HTTP ${res.status}. Is the FailForward store running?`);
      return false;
    }
    const health = await res.json();
    console.log(`App is up at ${baseUrl} (checkout bug: ${health.checkoutBug ? 'ON' : 'off'}).`);
    return true;
  } catch {
    console.error(`ERROR: cannot reach the app at ${baseUrl}.`);
    console.error('Start it first with: npm start');
    console.error('(In another terminal, or as a background process.)');
    return false;
  }
}

function checkAuth() {
  const result = spawnSync('kane-cli', ['whoami'], { encoding: 'utf8', timeout: 30000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (result.status !== 0 || AUTH_PATTERNS.test(output)) {
    console.error('ERROR: kane-cli is not logged in.');
    console.error('Authenticate first, then re-run this script:');
    console.error('  kane-cli login            # interactive OAuth in a browser');
    console.error('  kane-cli login --username <email> --access-key <key>   # non-interactive');
    console.error('Get the access key from the TestMu AI dashboard under Settings > Keys.');
    console.error('New TestMu AI accounts get 10,000 free credits, valid for 30 days.');
    return false;
  }
  console.log('kane-cli is logged in.');
  return true;
}

// ---------------------------------------------------------------------------
// One Kane run
// ---------------------------------------------------------------------------

function runKaneFlow(flow, { baseUrl, timeout, maxSteps }) {
  // Retarget the objective when the app runs somewhere other than localhost.
  const objective = flow.objective.replaceAll(DEFAULT_BASE_URL, baseUrl);
  const args = [
    'run', objective,
    '--agent',
    '--headless',
    '--url', baseUrl,
    '--timeout', String(timeout),
    '--max-steps', String(maxSteps),
    '--name', `failforward-${flow.name}`,
  ];
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn('kane-cli', args, {
      env: { ...process.env, KANE_CLI_USER_AGENT: 'failforward-kane-loop' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    // Safety net above Kane's own --timeout: kill the child if it hangs.
    const watchdog = setTimeout(() => {
      child.kill('SIGKILL');
    }, (timeout + 120) * 1000);
    watchdog.unref();
    child.on('error', (error) => {
      clearTimeout(watchdog);
      resolve({ exitCode: null, spawnError: error.message, stdout, stderr, durationSeconds: (Date.now() - startedAt) / 1000 });
    });
    child.on('close', (exitCode) => {
      clearTimeout(watchdog);
      resolve({ exitCode, stdout, stderr, durationSeconds: (Date.now() - startedAt) / 1000 });
    });
  });
}

function parseNdjson(stdout) {
  let runEnd = null;
  const failingSteps = [];
  const progress = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue; // Not JSON — ignore (stdout is NDJSON, but stay defensive).
    }
    if (event.type === 'run_end') {
      runEnd = event;
    } else if (typeof event.step === 'number') {
      progress.push(event);
      if (event.status === 'failed') {
        failingSteps.push({ step: event.step, remark: event.remark || '' });
      }
    }
    // Other typed events (stream_start, recording_state, bifurcation, ...)
    // are informational and intentionally ignored.
  }
  return { runEnd, failingSteps, progress };
}

// ---------------------------------------------------------------------------
// Report + failure files
// ---------------------------------------------------------------------------

async function writeReport(report) {
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

async function appendHistory(report) {
  const line = {
    timestamp: report.generatedAt,
    overall: report.overall,
    baseUrl: report.baseUrl,
    passed: report.flows.filter((f) => f.verdict === 'pass').length,
    failed: report.flows.filter((f) => f.verdict === 'fail').length,
    errored: report.flows.filter((f) => f.verdict === 'error').length,
    totalCredits: report.totalCredits,
    flows: report.flows.map((f) => ({
      name: f.name, verdict: f.verdict, exitCode: f.exitCode, credits: f.credits, testUrl: f.testUrl || null,
    })),
  };
  await appendFile(HISTORY_PATH, `${JSON.stringify(line)}\n`, 'utf8');
}

function renderFailureFile(report) {
  const failed = report.flows.filter((f) => f.verdict !== 'pass');
  const lines = [];
  lines.push('# Kane failure report');
  lines.push('');
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`App under test: ${report.baseUrl}`);
  lines.push(`Failed flows: ${failed.map((f) => f.name).join(', ')}`);
  lines.push('');
  lines.push('This file is the agent\'s work order. Fix the failures below, then re-run the loop:');
  lines.push('');
  lines.push('```');
  lines.push('npm run kane');
  lines.push('```');
  lines.push('');
  for (const flow of failed) {
    lines.push(`## ${flow.name} — ${flow.verdict.toUpperCase()} (exit ${flow.exitCode ?? 'n/a'})`);
    lines.push('');
    lines.push(`Objective: ${flow.objective}`);
    if (flow.expected) lines.push(`Expected: ${flow.expected}`);
    if (flow.summary) lines.push(`Kane summary: ${flow.summary}`);
    if (flow.reason) lines.push(`Reason: ${flow.reason}`);
    if (flow.failingSteps.length > 0) {
      lines.push('Failing steps:');
      for (const step of flow.failingSteps) {
        lines.push(`- Step ${step.step}: ${step.remark}`);
      }
    }
    if (flow.testUrl) lines.push(`Evidence: ${flow.testUrl}`);
    if (flow.sessionDir) lines.push(`Local evidence pack: ${flow.sessionDir}`);
    if (flow.fixHint) lines.push(`Suggested fix direction: ${flow.fixHint}`);
    if (flow.error) lines.push(`Error: ${flow.error}`);
    lines.push('');
  }
  lines.push('## How to close the loop');
  lines.push('');
  lines.push('1. Read the failing flow(s) above and open the evidence link to watch what Kane saw.');
  lines.push('2. Fix the app code (this script never edits code itself).');
  lines.push('3. Re-run the loop: `npm run kane` (or one flow: `npm run kane:flow -- <name>`).');
  lines.push('4. Repeat until the loop exits 0. A green run deletes this file.');
  lines.push('');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`FailForward Kane loop — base URL: ${args.baseUrl}`);

  let flows;
  try {
    flows = await loadFlows(args.flow);
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exit(2);
  }
  console.log(`Flows to run: ${flows.map((f) => f.name).join(', ')}`);

  // Preflight: fail fast before spending any credits.
  if (!checkCliInstalled()) process.exit(2);
  if (!(await checkAppReachable(args.baseUrl))) process.exit(2);
  if (!checkAuth()) {
    await writeReport({
      generatedAt: new Date().toISOString(),
      baseUrl: args.baseUrl,
      overall: 'error',
      error: 'kane-cli is not logged in. Run: kane-cli login',
      flows: [],
      totalCredits: 0,
      durationSeconds: 0,
    });
    process.exit(2);
  }

  const startedAt = Date.now();
  const results = [];
  let abortedForAuth = false;

  for (const flow of flows) {
    console.log(`\n--- Running flow: ${flow.name} ---`);
    const run = await runKaneFlow(flow, args);
    const combinedOutput = `${run.stdout}\n${run.stderr}`;

    if (run.spawnError) {
      results.push({
        name: flow.name, file: flow.file, objective: flow.objective, expected: flow.expected,
        fixHint: flow.fixHint, verdict: 'error', exitCode: run.exitCode,
        durationSeconds: Math.round(run.durationSeconds * 10) / 10,
        error: `Failed to start kane-cli: ${run.spawnError}`,
        failingSteps: [],
      });
      console.log(`ERROR ${flow.name}: could not start kane-cli (${run.spawnError})`);
      continue;
    }

    // Auth can fail mid-run (expired token, revoked key). Detect by message:
    // v0.10.6 exits 1 here, not the documented 2, so the exit code alone lies.
    if (AUTH_PATTERNS.test(combinedOutput) && run.exitCode !== 0) {
      console.error('\nERROR: Kane run failed: not authenticated. The token may have expired.');
      console.error('Re-authenticate with: kane-cli login');
      console.error('Aborting the remaining flows.');
      results.push({
        name: flow.name, file: flow.file, objective: flow.objective, expected: flow.expected,
        fixHint: flow.fixHint, verdict: 'error', exitCode: run.exitCode,
        durationSeconds: Math.round(run.durationSeconds * 10) / 10,
        error: 'Not authenticated (see stderr). Re-run: kane-cli login',
        failingSteps: [],
      });
      abortedForAuth = true;
      break;
    }

    const { runEnd, failingSteps } = parseNdjson(run.stdout);
    const passed = run.exitCode === 0 && runEnd && runEnd.status === 'passed';
    const result = {
      name: flow.name,
      file: flow.file,
      objective: flow.objective,
      expected: flow.expected,
      fixHint: flow.fixHint,
      verdict: passed ? 'pass' : 'fail',
      exitCode: run.exitCode,
      durationSeconds: runEnd && typeof runEnd.duration === 'number'
        ? runEnd.duration
        : Math.round(run.durationSeconds * 10) / 10,
      credits: runEnd && typeof runEnd.credits === 'number' ? runEnd.credits : null,
      summary: runEnd ? runEnd.summary || null : null,
      oneLiner: runEnd ? runEnd.one_liner || null : null,
      reason: runEnd ? runEnd.reason || null : null,
      testUrl: runEnd ? runEnd.test_url || null : null,
      sessionDir: runEnd ? runEnd.session_dir || null : null,
      runDir: runEnd ? runEnd.run_dir || null : null,
      finalState: runEnd ? runEnd.final_state || null : null,
      failingSteps,
    };
    if (!runEnd) {
      result.error = 'No run_end event in the Kane output. The run may have been killed or crashed; see stderr.';
      const stderrTail = run.stderr.trim().split('\n').slice(-5).join('\n');
      if (stderrTail) result.error += `\nLast stderr lines:\n${stderrTail}`;
    }
    results.push(result);
    console.log(`${result.verdict === 'pass' ? 'PASS' : 'FAIL'} ${flow.name} (exit ${run.exitCode})` +
      (result.credits != null ? ` — ${result.credits} credits` : '') +
      (result.testUrl ? ` — ${result.testUrl}` : ''));
  }

  const totalCredits = results.reduce((sum, r) => sum + (r.credits || 0), 0);
  const overall = abortedForAuth || results.some((r) => r.verdict === 'error')
    ? 'error'
    : results.every((r) => r.verdict === 'pass') ? 'pass' : 'fail';
  const report = {
    generatedAt: new Date().toISOString(),
    baseUrl: args.baseUrl,
    overall,
    flows: results,
    totalCredits,
    durationSeconds: Math.round((Date.now() - startedAt) / 100) / 10,
  };
  await writeReport(report);
  await appendHistory(report);

  const passedCount = results.filter((r) => r.verdict === 'pass').length;
  console.log(`\nResult: ${passedCount}/${results.length} flows passed (${totalCredits} credits). Report: kane-report.json`);

  if (overall === 'pass') {
    // A green run clears any stale failure file so nobody fixes old news.
    await rm(FAILURE_PATH, { force: true });
    console.log('All flows passed. The gate is open.');
    process.exit(0);
  }
  if (overall === 'error') {
    console.log('Loop ended with an error (see above). No code was changed. Fix the setup and re-run.');
    process.exit(2);
  }
  await writeFile(FAILURE_PATH, renderFailureFile(report), 'utf8');
  console.log('Failures written to kane-failure.md. Fix them, then re-run: npm run kane');
  process.exit(1);
}

main().catch((error) => {
  console.error(`ERROR: unexpected failure in the Kane loop: ${error.message}`);
  process.exit(2);
});
