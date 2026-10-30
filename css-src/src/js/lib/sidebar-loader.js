import { isAdmin } from './auth-guards.js';

const LINKS = [
  { href: '/day',       label: 'Day',        icon: 'bi-calendar3' },
  { href: '/book',      label: 'Book',       icon: 'bi-plus-square' },
  { href: '/patients',  label: 'Patients',   icon: 'bi-people' },
  { href: '/followups', label: 'Follow-ups', icon: 'bi-arrow-repeat' },
  { href: '/calls',     label: 'Calls',      icon: 'bi-telephone' },
  { href: '/reports',   label: 'Reports',    icon: 'bi-bar-chart', adminOnly: true },
  { href: '/settings',  label: 'Settings',   icon: 'bi-gear',      adminOnly: true }
];

export function loadSidebar(containerId, mode = 'desktop') {
  const el = document.getElementById(containerId);
  if (!el) return;

  const path = normalizePath(location.pathname);
  const items = LINKS.filter((l) => !l.adminOnly || isAdmin());

  const html = items.map((l) => {
    const active = isActive(path, l.href);
    return `
      <a href="${l.href}"
        class="flex items-center gap-2.5 px-3 h-10 rounded-lg text-[14px]
               transition-colors
               ${active
                 ? 'bg-accent-soft text-accent font-medium'
                 : 'text-ink-mute hover:bg-surface-hover'}">
        <i class="bi ${l.icon} text-[15px]" aria-hidden="true"></i>
        <span>${l.label}</span>
      </a>`;
  }).join('');

  el.innerHTML = `<nav class="flex flex-col gap-0.5 p-2" aria-label="Main">${html}</nav>`;

  if (mode === 'mobile') {
    el.addEventListener('click', (e) => {
      if (e.target.closest('a')) {
        document.dispatchEvent(new CustomEvent('sidebar:navigate'));
      }
    });
  }
}

function normalizePath(p) {
  let s = p || '/';
  if (s.endsWith('.html')) s = s.slice(0, -5);
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s === '' ? '/' : s;
}

function isActive(path, href) {
  if (path === href) return true;
  return path.startsWith(href + '/');
}