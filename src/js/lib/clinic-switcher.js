import { listClinics, getActiveClinicId, setActiveClinicId } from './clinic-context.js';

export function initClinicSwitcher(slotId) {
  const slot = document.getElementById(slotId);
  if (!slot) return;
  const clinics = listClinics();
  if (clinics.length === 0) return;
  const activeId = getActiveClinicId();
  const active = clinics.find((c) => c.id === activeId) || clinics[0];

  if (clinics.length === 1) {
    slot.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-surface-press text-ink-mute text-[13px]"><i class="bi bi-geo-alt" aria-hidden="true"></i><span>${escapeHtml(active.name)}</span></span>`;
    return;
  }

  const uid = `cs-${slotId}`;
  slot.style.position = 'relative';
  slot.innerHTML = `<button type="button" id="${uid}-btn" aria-haspopup="menu" aria-expanded="false" class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-surface-press hover:bg-hairline text-ink text-[13px] font-medium transition-colors focus:outline-none focus:shadow-focus"><i class="bi bi-geo-alt" aria-hidden="true"></i><span>${escapeHtml(active.name)}</span><i class="bi bi-chevron-down text-[11px] text-ink-faint" aria-hidden="true"></i></button><div id="${uid}-menu" role="menu" hidden class="absolute left-0 mt-1 z-50 min-w-[180px] rounded-xl bg-white shadow-panel border border-hairline py-1">${clinics.map((c) => `<button type="button" role="menuitem" data-clinic="${escapeHtml(c.id)}" class="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-hover ${c.id === active.id ? 'text-accent font-medium' : 'text-ink'}">${escapeHtml(c.name)}</button>`).join('')}</div>`;

  const btn = document.getElementById(`${uid}-btn`);
  const menu = document.getElementById(`${uid}-menu`);
  const open = () => { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('click', onDocClick); document.addEventListener('keydown', onKeyDown); };
  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', onDocClick); document.removeEventListener('keydown', onKeyDown); };
  function onDocClick(e) { if (!slot.contains(e.target)) close(); }
  function onKeyDown(e) { if (e.key === 'Escape') close(); }
  btn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? open() : close(); });
  menu.addEventListener('click', (e) => {
    const target = e.target.closest('[data-clinic]');
    if (!target) return;
    const id = target.dataset.clinic;
    if (id === active.id) { close(); return; }
    setActiveClinicId(id); location.reload();
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
