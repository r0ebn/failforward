// FailForward chaos toggle: start the store with the intentional checkout bug on.
// Equivalent to CHECKOUT_BUG=1 npm start, but cross-platform.

process.env.CHECKOUT_BUG = '1';
await import('../server.js');
