# browse-add-to-cart

Flow: browse-add-to-cart
Target: http://localhost:3000
Objective: Go to http://localhost:3000/ and browse the product catalog, add the first two products to the cart, open the cart, and assert the cart shows 2 items and a total greater than $0.
Expected: The catalog shows 8 products, the cart badge counts up to 2, and the cart panel lists both products with a non-zero total.
Fix hint: Check that /api/products returns 8 products, that each product card has an "Add to cart" button, and that the cart badge in public/store.js updates from localStorage.

## Notes

- The cart is stored in localStorage under "failforward-cart", so it survives page navigation within the same browser session.
