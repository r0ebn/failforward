// Account page: sign in, register, log out.
// Session lives in localStorage under "failforward-session" as {token, email}.

const SESSION_KEY = 'failforward-session';

function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  } catch {
    return null;
  }
}

function showWelcome(session) {
  document.getElementById('auth-forms').hidden = true;
  const welcome = document.getElementById('welcome');
  welcome.hidden = false;
  document.getElementById('welcome-text').textContent = `Welcome back, ${session.email}. You are signed in.`;
}

function showForms() {
  document.getElementById('welcome').hidden = true;
  document.getElementById('auth-forms').hidden = false;
}

function showError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
  const session = getSession();
  if (session) showWelcome(session);

  const signinForm = document.getElementById('signin-form');
  const registerForm = document.getElementById('register-form');
  const tabSignin = document.getElementById('tab-signin');
  const tabRegister = document.getElementById('tab-register');

  tabSignin.addEventListener('click', () => {
    tabSignin.classList.add('active');
    tabRegister.classList.remove('active');
    signinForm.hidden = false;
    registerForm.hidden = true;
  });

  tabRegister.addEventListener('click', () => {
    tabRegister.classList.add('active');
    tabSignin.classList.remove('active');
    registerForm.hidden = false;
    signinForm.hidden = true;
  });

  signinForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const email = document.getElementById('signin-email').value.trim();
    const password = document.getElementById('signin-password').value;
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError('signin-error', data.error || 'Sign in failed.');
      return;
    }
    const next = { token: data.token, email: data.email };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    showWelcome(next);
  });

  registerForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password }),
    });
    const data = await res.json();
    if (!res.ok) {
      showError('register-error', data.error || 'Registration failed.');
      return;
    }
    // Auto sign-in after registration so the flow ends on the welcome state.
    const login = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const loginData = await login.json();
    const next = { token: loginData.token, email: loginData.email };
    localStorage.setItem(SESSION_KEY, JSON.stringify(next));
    showWelcome(next);
  });

  document.getElementById('logout-button').addEventListener('click', () => {
    localStorage.removeItem(SESSION_KEY);
    showForms();
  });
});
