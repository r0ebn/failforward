// Order confirmation page: reads ?id= from the URL and renders the order
// from GET /api/orders/:id.

function money(n) {
  return `$${n.toFixed(2)}`;
}

document.addEventListener('DOMContentLoaded', async () => {
  const orderId = new URLSearchParams(window.location.search).get('id');
  const loadingEl = document.getElementById('loading');
  if (!orderId) {
    loadingEl.hidden = true;
    document.getElementById('order-missing').hidden = false;
    return;
  }
  const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}`);
  loadingEl.hidden = true;
  if (!res.ok) {
    document.getElementById('order-missing').hidden = false;
    return;
  }
  const order = await res.json();
  document.getElementById('order-id').textContent = order.orderId;
  document.getElementById('order-total').textContent = money(order.total);
  document.getElementById('order-meta').textContent =
    `Placed by ${order.name} (${order.email}) on ${new Date(order.createdAt).toLocaleString()}. ` +
    `Card ending ${order.cardLast4}. Status: ${order.status}.`;
  const linesEl = document.getElementById('order-lines');
  for (const item of order.items) {
    const row = document.createElement('div');
    row.className = 'cart-line';
    row.innerHTML = `<div><strong>${item.name}</strong> × ${item.qty}</div><div>${money(item.lineTotal)}</div>`;
    linesEl.appendChild(row);
  }
  document.getElementById('order-details').hidden = false;
});
