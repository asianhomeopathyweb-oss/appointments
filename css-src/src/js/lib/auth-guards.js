import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { onAuth } from './auth.js';

let _me = null;

/**
 * Call this at the top of every authenticated page.
 *
 * - If no Firebase user      → redirect to /login (preserving current path)
 * - If user but no profile   → redirect to /login?error=no-profile
 * - Otherwise                → resolve with the profile object
 *
 * The profile shape:
 *   { uid, email, name, role: 'admin'|'staff', clinicIds: string[] }
 *
 * Idempotent: safe to call multiple times on the same page (returns the
 * cached profile after the first successful call).
 */
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
        if (!snap.exists()) {
          location.replace('/login?error=no-profile');
          return;
        }
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
        // Profile fetch failed (network, rules, etc.). Fail closed.
        console.error('[auth-guards] profile fetch failed:', err);
        location.replace('/login?error=no-profile');
      }
    });
  });
}

/** The current profile, or null if requireAuth hasn't resolved yet. */
export function me() {
  return _me;
}

/** True if the signed-in user's role is 'admin'. */
export function isAdmin() {
  return _me?.role === 'admin';
}

/** True if the signed-in user's role is 'staff'. */
export function isStaff() {
  return _me?.role === 'staff';
}

/**
 * Synchronously test whether the current user belongs to a given clinic.
 * Useful in rules-adjacent UI (e.g. hiding the clinic switcher for staff).
 */
export function belongsTo(clinicId) {
  return Array.isArray(_me?.clinicIds) && _me.clinicIds.includes(clinicId);
}