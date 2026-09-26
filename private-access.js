/* Dragonfall private phone access: one local unlock per browser device. */
const ACCESS_STORAGE_KEY = 'dragonfall-private-access-v1';
const ACCESS_SALT = 'dragonfall-phone-2026-09';
const ACCESS_HASH = 'e3e66f86267371e4923688ca152f4c54e38753e0df1e924a890ac156b7d1e9e2';

const pageScript = (() => {
  const path = location.pathname;
  if (path.includes('/close-flight/')) return './scenic.js?v=4';
  if (path.endsWith('/scenic.html')) return './scenic.js';
  return './game.js?v=24';
})();

function addStyles() {
  const style = document.createElement('style');
  style.textContent = `
    #private-access { position:fixed; inset:0; z-index:9999; display:grid; place-items:center; padding:24px; color:#edf7f5; background:radial-gradient(circle at 50% 15%,#123c42 0,#07171b 58%); font-family:Manrope,Arial,sans-serif; }
    #private-access .access-card { width:min(390px,100%); padding:30px 24px 24px; border:1px solid #b4e8d84d; border-radius:18px; background:#0a2027eF; box-shadow:0 20px 80px #0009; text-align:center; }
    #private-access .access-mark { margin:0 0 10px; color:#cdfae8; font:42px Georgia,serif; }
    #private-access h1 { margin:0; font:400 34px 'Cormorant Garamond',Georgia,serif; letter-spacing:.5px; }
    #private-access p { margin:10px 0 22px; color:#b7d0cb; line-height:1.5; font-size:14px; }
    #private-access label { display:block; margin:0 0 8px; text-align:left; color:#d8eee8; font-size:12px; letter-spacing:1.5px; text-transform:uppercase; }
    #private-access input { width:100%; padding:14px 15px; border:1px solid #5b7578; border-radius:10px; background:#172b2f; color:#fff; font:700 18px Manrope,Arial,sans-serif; letter-spacing:3px; text-align:center; text-transform:uppercase; outline:none; }
    #private-access input:focus { border-color:#c9ffe7; box-shadow:0 0 0 3px #c9ffe733; }
    #private-access button { width:100%; margin-top:14px; padding:14px 18px; border:0; border-radius:10px; background:#c4ebdc; color:#082026; font-weight:800; letter-spacing:1px; }
    #private-access button:active { transform:translateY(1px); }
    #private-access .access-error { min-height:21px; margin:10px 0 0; color:#ffb4a0; font-size:13px; }
  `;
  document.head.append(style);
}

async function digest(value) {
  const bytes = new TextEncoder().encode(`${ACCESS_SALT}:${value.trim().toUpperCase()}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function unlock(code) {
  return (await digest(code)) === ACCESS_HASH;
}

function showGate() {
  const gate = document.createElement('section');
  gate.id = 'private-access';
  gate.setAttribute('aria-labelledby', 'private-access-title');
  gate.innerHTML = `
    <div class="access-card">
      <div class="access-mark" aria-hidden="true">↟</div>
      <h1 id="private-access-title">Dragonfall</h1>
      <p>This game is private. Enter the access code once on this phone.</p>
      <form>
        <label for="private-access-code">Access code</label>
        <input id="private-access-code" inputmode="text" autocomplete="current-password" autocapitalize="characters" spellcheck="false" maxlength="24" aria-describedby="private-access-error">
        <button type="submit">UNLOCK GAME</button>
        <div id="private-access-error" class="access-error" role="status" aria-live="polite"></div>
      </form>
    </div>`;
  document.body.append(gate);
  const form = gate.querySelector('form');
  const input = gate.querySelector('input');
  const error = gate.querySelector('.access-error');
  input.focus();
  form.addEventListener('submit', async event => {
    event.preventDefault();
    error.textContent = '';
    if (!(await unlock(input.value))) {
      error.textContent = 'That code is not correct.';
      input.select();
      return;
    }
    localStorage.setItem(ACCESS_STORAGE_KEY, 'unlocked');
    gate.remove();
    await import(pageScript);
  });
}

async function start() {
  addStyles();
  if (localStorage.getItem(ACCESS_STORAGE_KEY) === 'unlocked') {
    await import(pageScript);
    return;
  }
  showGate();
}

start().catch(error => {
  console.error('Dragonfall private access failed', error);
  document.body.textContent = 'Dragonfall could not open. Refresh this page.';
});
