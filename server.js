// FailForward demo store — Express server.
//
// A small, dependency-light storefront built for the Kane CLI Hackathon:
//   - product catalog, cart (client-side), guest checkout, order confirmation
//   - seeded demo account (see README for credentials)
//   - a chaos toggle: CHECKOUT_BUG=1 makes the checkout button silently do
//     nothing in the browser. The API keeps working; the bug is UI-only, the
//     way a real frontend regression would be. Kane is expected to catch it.
//
// No database, no external services. State lives in memory and resets on
// restart, which is exactly what a demo store wants.

import express from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const REPORT_PATH = path.join(__dirname, 'kane-report.json');

const PORT = Number(process.env.PORT || 3000);
const CHECKOUT_BUG = process.env.CHECKOUT_BUG === '1';

// ---------------------------------------------------------------------------
// Data (in-memory demo state)
// ---------------------------------------------------------------------------

export const PRODUCTS = [
  { id: 'lamp', name: 'Aurora Desk Lamp', price: 49.99, description: 'Warm dimmable light with a weighted brass base.' },
  { id: 'headphones', name: 'Nimbus Wireless Headphones', price: 89.0, description: 'Noise cancelling over-ears, 40 hour battery.' },
  { id: 'mug', name: 'Terra Ceramic Mug', price: 18.5, description: 'Hand-glazed stoneware, 350 ml, dishwasher safe.' },
  { id: 'keyboard', name: 'Orbit Mechanical Keyboard', price: 129.0, description: 'Hot-swappable 75% board with quiet tactile switches.' },
  { id: 'stand', name: 'Drift Laptop Stand', price: 39.99, description: 'Foldable aluminium stand, fits 11 to 17 inch laptops.' },
  { id: 'candle', name: 'Ember Smart Candle', price: 24.0, description: 'Flickering LED candle with a 6 hour auto-off timer.' },
  { id: 'backpack', name: 'Atlas Backpack', price: 79.5, description: '22 litre everyday carry with a padded laptop sleeve.' },
  { id: 'band', name: 'Pulse Fitness Band', price: 59.0, description: 'Heart rate, sleep and step tracking, 10 day battery.' },
];

// Demo users. Passwords are plaintext in memory on purpose: this is a demo
// store with no real data. Never copy this pattern into a real app.
const users = new Map([
  ['demo@failforward.dev', { email: 'demo@failforward.dev', password: 'demo1234', name: 'Demo User' }],
]);

const sessions = new Map(); // token -> email
const orders = new Map(); // orderId -> order

function newOrderId() {
  const stamp = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SG-${stamp}-${rand}`;
}

function money(n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use(express.static(PUBLIC_DIR));

// Health check. The Kane loop and the smoke test poll this before doing work.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'failforward', checkoutBug: CHECKOUT_BUG, time: new Date().toISOString() });
});

// Small public config the browser reads. This is how the checkout page learns
// whether the chaos toggle is on.
app.get('/api/config', (_req, res) => {
  res.json({ checkoutBug: CHECKOUT_BUG });
});

app.get('/api/products', (_req, res) => {
  res.json(PRODUCTS);
});

app.post('/api/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }
  if (users.has(email)) {
    return res.status(409).json({ error: 'An account with this email already exists.' });
  }
  users.set(email, { email, password, name: name || email.split('@')[0] });
  return res.status(201).json({ email });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = users.get(email);
  if (!user || user.password !== password) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  const token = `sg-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  sessions.set(token, email);
  return res.json({ token, email, name: user.name });
});

// Fake checkout. Payment always succeeds: no real money moves anywhere.
// NOTE: this endpoint keeps working even with CHECKOUT_BUG=1. The bug lives
// in the checkout button (public/checkout.js), not in the API.
app.post('/api/checkout', (req, res) => {
  const { items, name, email, address, cardNumber } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Your cart is empty.' });
  }
  if (!name || !email || !address) {
    return res.status(400).json({ error: 'Name, email and address are required.' });
  }
  const lines = [];
  for (const item of items) {
    const product = PRODUCTS.find((p) => p.id === item.id);
    const qty = Number(item.qty);
    if (!product || !Number.isInteger(qty) || qty < 1) {
      return res.status(400).json({ error: `Invalid cart item: ${JSON.stringify(item)}` });
    }
    lines.push({ id: product.id, name: product.name, price: product.price, qty, lineTotal: money(product.price * qty) });
  }
  const total = money(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const orderId = newOrderId();
  const order = {
    orderId,
    name,
    email,
    address,
    cardLast4: String(cardNumber || '').replace(/\D/g, '').slice(-4) || '4242',
    items: lines,
    total,
    status: 'confirmed',
    createdAt: new Date().toISOString(),
  };
  orders.set(orderId, order);
  return res.status(201).json(order);
});

app.get('/api/orders/:id', (req, res) => {
  const order = orders.get(req.params.id);
  if (!order) {
    return res.status(404).json({ error: 'Order not found.' });
  }
  return res.json(order);
});

// Latest Kane loop report, if a run has happened. 404 before the first run;
// the dashboard treats that as its empty state.
app.get('/api/kane-report', async (_req, res) => {
  try {
    const raw = await readFile(REPORT_PATH, 'utf8');
    res.type('application/json').send(raw);
  } catch {
    res.status(404).json({ error: 'No Kane report yet. Run: npm run kane' });
  }
});

// Dashboard page (also reachable as /kane.html).
app.get('/kane', (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'kane.html'));
});

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Unknown API route.' });
});

app.listen(PORT, () => {
  console.log(`FailForward store running at http://localhost:${PORT}`);
  console.log(`Checkout bug toggle: ${CHECKOUT_BUG ? 'ON (CHECKOUT_BUG=1) — the checkout button does nothing' : 'off'}`);
  console.log(`Kane dashboard: http://localhost:${PORT}/kane`);
});
