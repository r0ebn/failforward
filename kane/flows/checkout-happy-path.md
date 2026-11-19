# checkout-happy-path

Flow: checkout-happy-path
Target: http://localhost:3000
Objective: Go to http://localhost:3000/, add the first product to the cart, go to checkout, fill in the name, email, address and card number 4242 4242 4242 4242, click Place order, and assert the confirmation page shows an order id starting with SG- and the correct total.
Expected: Checkout completes, the cart is cleared, and the confirmation page shows an order id like SG-XXXX-XXXX plus the product and total.
Fix hint: Check POST /api/checkout in server.js (it validates items and computes the total server-side) and the redirect to order.html in public/checkout.js. If the button does nothing at all, the chaos toggle may be on — check /api/config and the CHECKOUT_BUG environment variable.

## Notes

- Payment is fake: any card number is accepted and no real money moves.
- This flow passes only when CHECKOUT_BUG is off.
