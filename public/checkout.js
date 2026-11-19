// Checkout page logic.
//
// THE INTENTIONAL BUG lives here. When the server reports
// { checkoutBug: true } (CHECKOUT_BUG=1 on the server), placeOrder() returns
// { status: 'blocked' } and the click handler does nothing at all: no
// request, no navigation, no error message, no console output. That silence
// is the point — it is exactly the kind of regression a user would report
// as "the button is dead", and it is what the Kane flow
// checkout-button-responds.md is written to catch.
//
// This module is also imported by scripts/smoke.mjs in Node to prove the bug
// behaviour without a browser, so all DOM access is guarded by
// `typeof document !== 'undefined'` and placeOrder() takes its inputs
// explicitly instead of reading the page.

export async function placeOrder({ config, cart, form, fetchImpl }) {
  const fetchFn = fetchImpl || fetch;
  if (config && config.checkoutBug) {
    // Intentional demo bug: silently do nothing.
    return { status: 'blocked' };
  }
  const res = await fetchFn('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: cart, ...form }),
  });
  const data = await res.json();
  if (!res.ok) {
    return { status: 'error', error: data.error || 'Checkout failed.' };
  }
  return { status: 'placed', order: data };
}

function money(n) {
  return `$${n.toFixed(2)}`;
}

function getCart() {
  try {
    return JSON.parse(localStorage.getItem('failforward-cart') || '[]');
  } catch {
    return [];
  }
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', async () => {
    const cart = getCart();
    const emptyEl = document.getElementById('empty-cart');
    const mainEl = document.getElementById('checkout-main');

    if (cart.length === 0) {
      emptyEl.hidden = false;
      mainEl.hidden = true;
      return;
    }

    const products = await (await fetch('/api/products')).json();
    const linesEl = document.getElementById('summary-lines');
    let total = 0;
    for (const item of cart) {
      const product = products.find((p) => p.id === item.id);
      if (!product) continue;
      total += product.price * item.qty;
      const row = document.createElement('div');
      row.className = 'cart-line';
      row.innerHTML = `<div><strong>${product.name}</strong> × ${item.qty}</div><div>${money(product.price * item.qty)}</div>`;
      linesEl.appendChild(row);
    }
    document.getElementById('summary-total').textContent = money(total);

    const config = await (await fetch('/api/config')).json();

    document.getElementById('checkout-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = {
        name: document.getElementById('field-name').value.trim(),
        email: document.getElementById('field-email').value.trim(),
        address: document.getElementById('field-address').value.trim(),
        cardNumber: document.getElementById('field-card').value.trim(),
      };
      const errorEl = document.getElementById('checkout-error');
      errorEl.hidden = true;
      const result = await placeOrder({ config, cart, form });
      if (result.status === 'blocked') {
        // The bug: nothing happens. Deliberately no feedback of any kind.
        return;
      }
      if (result.status === 'error') {
        errorEl.textContent = result.error;
        errorEl.hidden = false;
        return;
      }
      localStorage.removeItem('failforward-cart');
      window.location.href = `/order.html?id=${encodeURIComponent(result.order.orderId)}`;
    });
  });
}
