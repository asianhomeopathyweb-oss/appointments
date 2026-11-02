// ============================================================
// Toast notifications
// ============================================================

export function showToast(msg, type = 'info') {
  // Remove existing toasts so they don't stack up
  const existing = document.querySelector('.custom-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  
  // Base styles (dark, rounded, shadow, fixed at bottom center)
  const baseClass = 'custom-toast fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2.5 px-4 py-3 rounded-2xl shadow-xl font-bold text-[13px] transition-all duration-300 transform translate-y-10 opacity-0 pointer-events-none';

  // Icon and color based on type
  let icon = '';
  let colorClass = '';
  
  if (type === 'error') {
    icon = '<i class="bi bi-exclamation-circle-fill text-[16px]"></i>';
    colorClass = 'bg-red-500 text-white';
  } else if (type === 'success') {
    icon = '<i class="bi bi-check-circle-fill text-[16px]"></i>';
    colorClass = 'bg-emerald-500 text-white';
  } else {
    icon = '<i class="bi bi-info-circle-fill text-[16px]"></i>';
    colorClass = 'bg-ink text-white';
  }

  toast.className = `${baseClass} ${colorClass}`;
  toast.innerHTML = `${icon} <span>${msg}</span>`;

  document.body.appendChild(toast);

  // Trigger the slide-up animation
  requestAnimationFrame(() => {
    toast.classList.remove('translate-y-10', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');
  });

  // Auto dismiss after 2.5 seconds
  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('translate-y-10', 'opacity-0');
    
    // Remove from DOM after animation finishes
    setTimeout(() => {
      if (toast.parentNode) toast.remove();
    }, 300);
  }, 2500);
}