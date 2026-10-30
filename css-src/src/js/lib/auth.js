import {
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from './firebase-init.js';

/**
 * Sign in with email + password.
 * Throws on failure (wrong password, unknown user, network error, etc.)
 * The caller decides what to show.
 */
export function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

/**
 * Sign out the current user.
 * Returns a promise; the app usually redirects to /login after this.
 */
export function signOut() {
  return fbSignOut(auth);
}

/**
 * Subscribe to auth state changes.
 * Fires immediately with the current user (or null), then again on every change.
 * Returns the unsubscribe function.
 */
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

/**
 * The current user synchronously, or null.
 * Firebase hydrates this after the first onAuth callback.
 * Do not rely on this before onAuth has fired at least once.
 */
export function currentUser() {
  return auth.currentUser;
}
