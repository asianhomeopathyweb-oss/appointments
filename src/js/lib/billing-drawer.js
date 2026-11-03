// ============================================================
// Billing Drawer (Iframe)
// ============================================================

let checkInterval = null;
let activeAppointmentId = null; // Which appointment we are billing
let savedThisSession = false;   // Did we dispatch invoice-saved for this open?

export function openBillingDrawer(patientId = null, appointmentId = null) {
  const drawer = document.getElementById('billing-drawer');
  const iframe = document.getElementById('billing-iframe');
  const backdrop = document.getElementById('billing-backdrop');

  if (!drawer || !iframe || !backdrop) {
    console.error('Billing drawer elements not found');
    return;
  }

  activeAppointmentId = appointmentId;
  savedThisSession = false;

  const url = patientId
    ? `https://billbook.asianhomeocare.in/invoice.html?patientId=${patientId}&embed=true`
    : `https://billbook.asianhomeocare.in/invoice.html?embed=true`;

  iframe.src = url;

  backdrop.classList.remove('hidden');
  setTimeout(() => {
    backdrop.classList.remove('opacity-0');
    backdrop.classList.add('opacity-100');
  }, 10);

  drawer.classList.remove('hidden', 'opacity-0', 'scale-95');
  drawer.classList.add('block', 'opacity-100', 'scale-100');

  if (checkInterval) clearInterval(checkInterval);
  checkInterval = setInterval(() => {
    try {
      const iframeUrl = iframe.contentWindow.location.href;
      // If BillBook redirects to invoice-view.html, it means it saved
      if (iframeUrl.includes('invoice-view.html')) {
        const urlParams = new URLSearchParams(new URL(iframeUrl).search);
        // Null-guard: if BillBook hasn't put ?id= yet, wait for next tick.
        // Fall back to 'saved' only if param is present-but-empty.
        const rawId = urlParams.get('id');
        if (!rawId) return;
        const invoiceId = rawId;

        savedThisSession = true;
        window.dispatchEvent(new CustomEvent('invoice-saved', {
          detail: { invoiceId, appointmentId: activeAppointmentId }
        }));

        closeBillingDrawer();
        if (window.showToast) window.showToast('Invoice saved successfully', 'success');
      }
    } catch (e) {}
  }, 1000);
}

export function closeBillingDrawer() {
  const drawer = document.getElementById('billing-drawer');
  const iframe = document.getElementById('billing-iframe');
  const backdrop = document.getElementById('billing-backdrop');

  if (!drawer || !iframe || !backdrop) return;

  // Capture the appointmentId for this close session so the 300ms
  // timeout can't clobber a newer open's activeAppointmentId.
  const closingApptId = activeAppointmentId;
  const wasSaved = savedThisSession;

  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }

  drawer.classList.remove('opacity-100', 'scale-100', 'block');
  drawer.classList.add('opacity-0', 'scale-95');

  backdrop.classList.remove('opacity-100');
  backdrop.classList.add('opacity-0');

  setTimeout(() => {
    backdrop.classList.add('hidden');
    drawer.classList.add('hidden');
    iframe.src = '';
    // Only clear if it still refers to the appointment we closed.
    if (activeAppointmentId === closingApptId) {
      activeAppointmentId = null;
    }
  }, 300);

  // Notify listeners when the drawer was closed WITHOUT a save,
  // so the Day View can reset its cameFromFollowup flag.
  if (!wasSaved) {
    window.dispatchEvent(new CustomEvent('billing-drawer-closed', {
      detail: { appointmentId: closingApptId }
    }));
  }
}

// Listen for messages from the iframe (BillBook)
window.addEventListener('message', (event) => {
  if (event.origin !== 'https://billbook.asianhomeocare.in') return;

  if (event.data && event.data.action === 'closeBillingDrawer') {
    closeBillingDrawer();
  }

  if (event.data && event.data.action === 'invoiceSaved') {
    savedThisSession = true;
    window.dispatchEvent(new CustomEvent('invoice-saved', {
      detail: {
        invoiceId: event.data.invoiceId || 'saved',
        appointmentId: activeAppointmentId
      }
    }));
    closeBillingDrawer();
    if (window.showToast) {
      window.showToast('Invoice saved successfully', 'success');
    }
  }
});