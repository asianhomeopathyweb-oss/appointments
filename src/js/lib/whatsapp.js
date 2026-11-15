// ============================================================
// WhatsApp Utility
// Single source of truth for generating WhatsApp links.
// ============================================================

import { fmtDate, fmtSlot } from '../date-utils.js';

/**
 * Opens WhatsApp with a pre-filled confirmation message.
 * 
 * @param {object} options
 * @param {string} options.name - Patient name
 * @param {string} options.phone - Patient phone number
 * @param {string} [options.dateISO] - Appointment date (YYYY-MM-DD)
 * @param {string} [options.slot] - Appointment time (HH:MM)
 * @param {string} [options.customText] - Override the default message
 */
export function openWhatsApp({ name, phone, dateISO, slot, customText }) {
  if (!phone) {
    alert('No phone number on file for this patient.');
    return;
  }

  // 1. Clean the phone number (remove spaces, dashes, plus signs)
  let cleanPhone = String(phone).replace(/[^0-9]/g, '');
  
  // 2. Ensure it has the country code (91 for India)
  if (cleanPhone.length === 10) {
    cleanPhone = '91' + cleanPhone;
  }

  // 3. Build the message
  const firstName = (name || 'Patient').split(' ')[0];
  let message = customText;

  if (!message) {
    if (dateISO && slot) {
      const d = fmtDate(dateISO);
      const t = fmtSlot(slot);
      message = `Hi ${firstName}, your appointment at Asian Homeocare is confirmed for ${d} at ${t}.\n\nPlease reply YES to confirm.\nIf you need to reschedule, please let us know.`;
    } else {
      // Generic fallback if no appointment details are passed
      message = `Hi ${firstName}, this is Asian Homeocare. How can we help you today?`;
    }
  }

  // 4. Encode and open
  const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, '_blank');
}