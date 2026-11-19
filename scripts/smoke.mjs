// FailForward smoke test — no browser, no Kane credits needed.
//
// Starts the server on throwaway ports and checks, end to end:
//   - /health, all pages, and the API (register, login, checkout, order)
//   - the chaos toggle: CHECKOUT_BUG=1 flips /api/config, and the checkout
//     button logic (placeOrder, imported from public/checkout.js) silently
//     blocks the order instead of calling the API
//
// Usage: npm run smoke

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeOrder } from '../public/checkout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const NORMAL_PORT = 3101;
const BUG_PORT = 3102;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForHealth(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

function startServer(port, extraEnv = {}) {
  const child = spawn('node', ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), ...extraEnv },
    stdio: 'ignore',
  });
  return child;
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
  });
}

async function main() {
  // ---- Normal server ------------------------------------------------------
  const server = startServer(NORMAL_PORT);
  if (!(await waitForHealth(NORMAL_PORT))) {
    check('server starts and /health answers', false);
    await stopServer(server);
    process.exit(1);
  }
  check('server starts and /health answers', true);

  const base = `http://localhost:${NORMAL_PORT}`;
  try {
    const health = await (await fetch(`${base}/health`)).json();
    check('/health reports status ok', health.status === 'ok');
    check('/health reports checkout bug off', health.checkoutBug === false);

    for (const page of ['/', '/login.html', '/checkout.html', '/order.html', '/kane.html', '/kane']) {
      const res = await fetch(`${base}${page}`);
      const body = await res.text();
      check(`GET ${page} returns 200 HTML`, res.ok && body.includes('FailForward'));
    }

    const products = await (await fetch(`${base}/api/products`)).json();
    check('/api/products returns 8 products', Array.isArray(products) && products.length === 8);

    const config = await (await fetch(`${base}/api/config`)).json();
    check('/api/config reports checkout bug off', config.checkoutBug === false);

    const email = `smoke-${Date.now()}@failforward.dev`;
    const register = await fetch(`${base}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Smoke Test', email, password: 'Test1234' }),
    });
    check('POST /api/register creates an account', register.status === 201);

    const login = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@failforward.dev', password: 'demo1234' }),
    });
    const loginData = await login.json();
    check('POST /api/login accepts the demo account', login.ok && Boolean(loginData.token));

    const badLogin = await fetch(`${base}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'demo@failforward.dev', password: 'wrong' }),
    });
    check('POST /api/login rejects a wrong password', badLogin.status === 401);

    const checkout = await fetch(`${base}/api/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: [{ id: products[0].id, qty: 2 }, { id: products[1].id, qty: 1 }],
        name: 'Smoke Test',
        email,
        address: '1 Test Street',
        cardNumber: '4242424242424242',
      }),
    });
    const order = await checkout.json();
    check('POST /api/checkout creates an order', checkout.status === 201 && order.orderId.startsWith('SG-'));
    const expectedTotal = Math.round((products[0].price * 2 + products[1].price) * 100) / 100;
    check('order total is computed server-side', order.total === expectedTotal, `total $${order.total}`);

    const fetched = await fetch(`${base}/api/orders/${order.orderId}`);
    check('GET /api/orders/:id returns the order', fetched.ok);

    const missing = await fetch(`${base}/api/orders/SG-DOES-NOT-EXIST`);
    check('GET /api/orders/:id 404s for unknown ids', missing.status === 404);
  } finally {
    await stopServer(server);
  }

  // ---- Bug-mode server ----------------------------------------------------
  const bugServer = startServer(BUG_PORT, { CHECKOUT_BUG: '1' });
  if (!(await waitForHealth(BUG_PORT))) {
    check('bug-mode server starts', false);
    await stopServer(bugServer);
    process.exit(1);
  }
  try {
    const bugBase = `http://localhost:${BUG_PORT}`;
    const bugConfig = await (await fetch(`${bugBase}/api/config`)).json();
    check('CHECKOUT_BUG=1 flips /api/config to checkoutBug true', bugConfig.checkoutBug === true);
    const bugHealth = await (await fetch(`${bugBase}/health`)).json();
    check('CHECKOUT_BUG=1 flips /health to checkoutBug true', bugHealth.checkoutBug === true);
  } finally {
    await stopServer(bugServer);
  }

  // ---- placeOrder unit checks (the button behaviour, no browser needed) ---
  let fetchCalls = 0;
  const stubFetch = async () => {
    fetchCalls += 1;
    return { ok: true, json: async () => ({ orderId: 'SG-STUB-1' }) };
  };
  const cart = [{ id: 'mug', qty: 1 }];
  const form = { name: 'Smoke', email: 'smoke@failforward.dev', address: '1 Test Street', cardNumber: '4242' };

  const blocked = await placeOrder({ config: { checkoutBug: true }, cart, form, fetchImpl: stubFetch });
  check('placeOrder with bug on returns blocked', blocked.status === 'blocked');
  check('placeOrder with bug on never calls the API', fetchCalls === 0, `${fetchCalls} calls`);

  const placed = await placeOrder({ config: { checkoutBug: false }, cart, form, fetchImpl: stubFetch });
  check('placeOrder with bug off places the order', placed.status === 'placed');
  check('placeOrder with bug off calls the API once', fetchCalls === 1, `${fetchCalls} calls`);

  // ---- Summary ------------------------------------------------------------
  const failed = results.filter((r) => !r.ok);
  console.log(`\nSmoke: ${results.length - failed.length}/${results.length} checks passed.`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`Smoke test crashed: ${error.message}`);
  process.exit(1);
});
