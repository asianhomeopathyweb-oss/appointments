import { listClinics, getActiveClinicId, setActiveClinicId } from './clinic-context.js';

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
    
    // If only 1 clinic, show a static chip
    if (clinics.length === 1) {
      slot.innerHTML = `
        <span class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-surface-hover text-ink-mute text-[12px] font-semibold border border-hairline">
          <i class="bi bi-geo-alt text-[12px]"></i>
          <span>${active.name}</span>
        </span>`;
      return;
    }
    
    // If multiple clinics, show a dropdown
    const uid = `cs-${slotId}`;
    slot.innerHTML = `
      <div class="relative">
        <button type="button" id="${uid}-btn" class="inline-flex items-center gap-1.5 px-3 h-8 rounded-full bg-white hover:bg-surface-hover border border-hairline text-ink text-[12px] font-bold transition-colors shadow-sm">
          <i class="bi bi-geo-alt text-accent"></i>
          <span>${active.name}</span>
          <i class="bi bi-chevron-down text-[10px] text-ink-faint"></i>
        </button>
        <div id="${uid}-menu" hidden class="absolute left-0 mt-2 z-50 min-w-[160px] rounded-xl bg-white shadow-xl border border-hairline py-1 overflow-hidden">
          ${clinics.map(c => `
            <button type="button" data-clinic="${c.id}" class="w-full text-left px-4 py-2.5 text-[13px] font-semibold hover:bg-surface-hover transition-colors ${c.id === active.id ? 'text-accent bg-accent-soft/50' : 'text-ink'}">
              ${c.name}
            </button>
          `).join('')}
        </div>
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