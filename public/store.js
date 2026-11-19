// Storefront: renders the catalog from /api/products and owns the cart.
// Cart state lives in localStorage under "failforward-cart" as [{id, qty}].

const CART_KEY = 'failforward-cart';

function getCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY) || '[]');
  } catch {
    return [];
  }
}

function setCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  renderCartBadge();
}

function cartCount() {
  return getCart().reduce((sum, item) => sum + item.qty, 0);
}

function renderCartBadge() {
  const badge = document.getElementById('cart-count');
  if (badge) badge.textContent = String(cartCount());
}

function money(n) {
  return `$${n.toFixed(2)}`;
}

let products = [];

async function loadProducts() {
  const res = await fetch('/api/products');
  products = await res.json();
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '';
  for (const product of products) {
    const card = document.createElement('article');
    card.className = 'card';
    card.innerHTML = `
      <h2>${product.name}</h2>
      <p>${product.description}</p>
      <div class="price">${money(product.price)}</div>
    `;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Add to cart';
    button.setAttribute('data-product-id', product.id);
    button.setAttribute('aria-label', `Add ${product.name} to cart`);
    button.addEventListener('click', () => addToCart(product.id));
    card.appendChild(button);
    grid.appendChild(card);
  }
}

function addToCart(productId) {
  const cart = getCart();
  const line = cart.find((item) => item.id === productId);
  if (line) {
    line.qty += 1;
  } else {
    cart.push({ id: productId, qty: 1 });
  }
  setCart(cart);
  renderCartPanel();
}

function changeQty(productId, delta) {
  const cart = getCart();
  const line = cart.find((item) => item.id === productId);
  if (!line) return;
  line.qty += delta;
  const next = cart.filter((item) => item.qty > 0);
  setCart(next);
  renderCartPanel();
}

function renderCartPanel() {
  const linesEl = document.getElementById('cart-lines');
  const totalEl = document.getElementById('cart-total');
  const cart = getCart();
  if (cart.length === 0) {
    linesEl.innerHTML = '<p>Your cart is empty.</p>';
    totalEl.textContent = money(0);
    return;
  }
  linesEl.innerHTML = '';
  let total = 0;
  for (const item of cart) {
    const product = products.find((p) => p.id === item.id);
    if (!product) continue;
    total += product.price * item.qty;
    const row = document.createElement('div');
    row.className = 'cart-line';
    row.innerHTML = `
      <div><strong>${product.name}</strong><br>${money(product.price)} each</div>
      <div class="qty">
        <button type="button" aria-label="Decrease quantity">−</button>
        <span>${item.qty}</span>
        <button type="button" aria-label="Increase quantity">+</button>
      </div>
      <div>${money(product.price * item.qty)}</div>
    `;
    const [minus, plus] = row.querySelectorAll('button');
    minus.addEventListener('click', () => changeQty(item.id, -1));
    plus.addEventListener('click', () => changeQty(item.id, 1));
    linesEl.appendChild(row);
  }
  totalEl.textContent = money(total);
}

document.addEventListener('DOMContentLoaded', () => {
  renderCartBadge();
  loadProducts().then(renderCartPanel);
  const panel = document.getElementById('cart-panel');
  document.getElementById('cart-open').addEventListener('click', () => {
    renderCartPanel();
    panel.hidden = false;
  });
  document.getElementById('cart-close').addEventListener('click', () => {
    panel.hidden = true;
  });
});
