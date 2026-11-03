// ============================================================
// Invoice Auto-Sync
// ============================================================

import {
  collection,
  query,
  where,
  onSnapshot,
  doc,
  updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './firebase-init.js';

export function startInvoiceSync(clinicId, getAppointments) {
  if (!clinicId) return () => {};
  if (typeof getAppointments !== 'function') return () => {};

  const q = query(
    collection(db, 'invoices'),
    where('clinicId', '==', clinicId)
  );

  return onSnapshot(
    q,
    (snap) => {
      snap.docChanges().forEach(async (change) => {
        if (change.type !== 'added') return;

        const inv = change.doc.data();
        if (!inv) return;
        if (inv.deleted === true) return;
        if (!inv.patientId || !inv.invoiceDate) return;

        const invoiceNumber = inv.invoiceNumber || change.doc.id;
        if (!invoiceNumber) return;

        const appointments = getAppointments();
        if (!Array.isArray(appointments) || appointments.length === 0) return;

        const matches = appointments.filter((a) => {
          if (!a) return false;
          if (a.deleted === true) return false;
          if (a.patientId !== inv.patientId) return false;
          if (a.date !== inv.invoiceDate) return false;
          if (a.status !== 'seen') return false;
          return true;
        });

        if (matches.length === 0) return;

        const target = pickBestMatch(matches, inv.createdAt);

        const existingNotes = target.notes || '';
        const alreadyTagged = existingNotes.includes('Invoice:');

        if (alreadyTagged) {
          if (existingNotes.includes(`Invoice: ${invoiceNumber}`)) return;
        }

        const cleanNotes = existingNotes
          .replace(/Invoice:\s*\S+/g, '')
          .replace(/\[No Bill\]/g, '')
          .trim();
        const newNotes = (cleanNotes + ` Invoice: ${invoiceNumber}`).trim();

        try {
          await updateDoc(doc(db, 'appointments', target.id), {
            notes: newNotes
          });
        } catch (err) {
          console.error('[invoice-sync] failed to tag appointment', target.id, err);
        }
      });
    },
    (err) => {
      console.error('[invoice-sync] subscribe failed:', err);
    }
  );
}

function pickBestMatch(matches, createdAt) {
  if (matches.length === 1) return matches[0];
  if (!createdAt) return matches[0];

  let invMinutes = null;
  try {
    const d = typeof createdAt.toDate === 'function'
      ? createdAt.toDate()
      : new Date(createdAt);
    invMinutes = d.getHours() * 60 + d.getMinutes();
  } catch {
    return matches[0];
  }
  if (invMinutes === null) return matches[0];

  let best = matches[0];
  let bestScore = Infinity;

  for (const a of matches) {
    if (!a.slot) continue;
    const [h, m] = a.slot.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;
    const apptMinutes = h * 60 + m;

    const delta = apptMinutes - invMinutes;
    const score = delta <= 0 ? -delta : delta + 60;

    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }

  return best;
}