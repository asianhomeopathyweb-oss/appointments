import { setActiveClinicId } from './clinic-context.js';

export function initClinicSwitcher(user) {
  if (!user || !user.clinicIds || user.clinicIds.length === 0) return;

  const CLINIC_NAMES = { 'ah-ubl': 'Hubballi', 'ah-bza': 'Vijayawada' };
  const clinics = user.clinicIds.map(id => ({ id, name: CLINIC_NAMES[id] || id }));
  
  const storedId = localStorage.getItem('ah.activeClinicId');
  const activeId = (storedId && clinics.find(c => c.id === storedId)) ? storedId : clinics[0].id;
  const active = clinics.find(c => c.id === activeId) || clinics[0];

  const renderSlot = (slotId) => {
    const slot = document.getElementById(slotId);
    if (!slot) return;
    
    if (clinics.length === 1) {
      slot.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-surface-press text-ink-mute text-[13px]"><i class="bi bi-geo-alt"></i><span>${active.name}</span></span>`;
      return;
    }
    
    const uid = `cs-${slotId}`;
    slot.style.position = 'relative';
    slot.innerHTML = `
      <button type="button" id="${uid}-btn" class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-surface-press hover:bg-hairline text-ink text-[13px] font-medium transition-colors">
        <i class="bi bi-geo-alt"></i>
        <span>${active.name}</span>
        <i class="bi bi-chevron-down text-[11px] text-ink-faint"></i>
      </button>
      <div id="${uid}-menu" hidden class="absolute left-0 mt-1 z-50 min-w-[180px] rounded-xl bg-white shadow-panel border border-hairline py-1">
        ${clinics.map(c => `<button type="button" data-clinic="${c.id}" class="w-full text-left px-3 py-2 text-[13px] hover:bg-surface-hover ${c.id === active.id ? 'text-accent font-medium' : 'text-ink'}">${c.name}</button>`).join('')}
      </div>`;
      
    const btn = document.getElementById(`${uid}-btn`);
    const menu = document.getElementById(`${uid}-menu`);
    
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.hidden = !menu.hidden;
    });
    
    menu.addEventListener('click', (e) => {
      const target = e.target.closest('[data-clinic]');
      if (!target) return;
      setActiveClinicId(target.dataset.clinic);
      location.reload();
    });
    
    document.addEventListener('click', (e) => {
      if (!slot.contains(e.target)) menu.hidden = true;
    });
  };

  renderSlot('clinic-switcher-slot-desktop');
  renderSlot('clinic-switcher-slot-mobile');
}