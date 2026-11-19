# signup-login

Flow: signup-login
Target: http://localhost:3000
Objective: Go to http://localhost:3000/login.html and create a new account with a unique email address and password Test1234, then log out, then sign in with email demo@failforward.dev and password demo1234, and assert the page shows a welcome message containing demo@failforward.dev.
Expected: Registration succeeds, logout returns to the sign-in form, and signing in with the demo account shows "Welcome back, demo@failforward.dev".
Fix hint: Check the /api/register and /api/login endpoints in server.js and the form handlers in public/auth.js. A likely cause is a wrong form field id or a missing JSON Content-Type header on the request.

## Notes

- The demo account (demo@failforward.dev / demo1234) is seeded by the server on startup.
- Registration uses a unique email each run (for example a timestamped address) so the flow is repeatable.
