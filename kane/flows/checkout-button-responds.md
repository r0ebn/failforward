# checkout-button-responds

Flow: checkout-button-responds
Target: http://localhost:3000
Objective: Go to http://localhost:3000/, add the first product to the cart, go to checkout, fill in the name, email, address and card number 4242 4242 4242 4242, click Place order, and assert the page navigates to the order confirmation page within 10 seconds. If clicking Place order does nothing and the page stays on checkout, the test FAILS.
Expected: Clicking "Place order" navigates away from checkout to the confirmation page. When CHECKOUT_BUG=1 is set on the server, the button silently does nothing and this flow must FAIL — that failure is the bug being caught, not a flaky test.
Fix hint: The checkout button handler lives in public/checkout.js (placeOrder). When CHECKOUT_BUG=1, placeOrder returns { status: 'blocked' } and the handler returns early on purpose. To heal: stop the server and restart it without CHECKOUT_BUG (npm run demo:heal), then re-run the loop.

## Notes

- This is the chaos-catcher flow. It is the one the break-then-heal demo is built around: run it with CHECKOUT_BUG=1 (red), then without it (green).
- The 10 second bound matters: without it, an agent might wait forever on a dead button instead of calling the failure.
