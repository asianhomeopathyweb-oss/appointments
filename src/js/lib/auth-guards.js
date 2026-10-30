import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { onAuth } from './auth.js';

let _me = null;

export function requireAuth() {
  if (_me) return Promise.resolve(_me);
  return new Promise((resolve) => {
    onAuth(async (user) => {
      if (!user) {
        const here = encodeURIComponent(location.pathname + location.search);
        location.replace(`/login?next=${here}`);
        return;
      }
      try {
        const snap = await getDoc(doc(db, 'users', user.uid));
        if (!snap.exists()) { location.replace('/login?error=no-profile'); return; }
        const data = snap.data();
        _me = {
          uid: user.uid,
          email: user.email || '',
          name: data.name || user.email || 'User',
          role: data.role === 'admin' ? 'admin' : 'staff',
          clinicIds: Array.isArray(data.clinicIds) ? data.clinicIds : []
        };
        resolve(_me);
      } catch (err) {
        console.error('[auth-guards] profile fetch failed:', err);
        location.replace('/login?error=no-profile');
      }
    });
  });
}

export function me() { return _me; }
export function isAdmin() { return _me?.role === 'admin'; }
export function isStaff() { return _me?.role === 'staff'; }
export function belongsTo(clinicId) {
  return Array.isArray(_me?.clinicIds) && _me.clinicIds.includes(clinicId);
}
