const DISMISS_MS = 2200;
const FADE_MS = 220;

let _host = null;

function ensureHost() {
  if (_host && document.body.contains(_host)) return _host;
  _host = document.createElement('div');
  _host.id = 'toast-host';
  _host.setAttribute('role', 'status');
  _host.setAttribute('aria-live', 'polite');
  _host.className = 'fixed left-1/2 -translate-x-1/2 bottom-6 z-[80] flex flex-col gap-2 items-center pointer-events-none pb-[env(safe-area-inset-bottom)]';
  document.body.appendChild(_host);
  return _host;
}

export function showToast(message, type = 'info') {
  const host = ensureHost();
  const el = document.createElement('div');
  const bg = type === 'error' ? 'bg-[#b91c1c]' : 'bg-ink';
  el.className = `${bg} text-white text-[13px] px-4 py-2.5 rounded-lg shadow-panel transition-all duration-200 ease-out`;
  el.textContent = message;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduce) { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; }
  host.appendChild(el);
  if (!reduce) {
    requestAnimationFrame(() => { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });
  }
  setTimeout(() => {
    if (reduce) { el.remove(); return; }
    el.style.opacity = '0'; el.style.transform = 'translateY(8px)';
    setTimeout(() => el.remove(), FADE_MS);
  }, DISMISS_MS);
}
