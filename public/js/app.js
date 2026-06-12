// Utility function to make API calls
async function apiCall(endpoint, method = 'GET', data = null, isFormData = false) {
  const options = {
    method,
    headers: isFormData ? {} : {
      'Content-Type': 'application/json'
    }
  };

  if (data) {
    if (isFormData) {
      options.body = data;
    } else {
      options.body = JSON.stringify(data);
    }
  }

  try {
    const response = await fetch(endpoint, options);
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || `HTTP Error: ${response.status}`);
    }

    return result;
  } catch (error) {
    console.error('API Error:', error);
    throw error;
  }
}

// Show message
function showMessage(elementId, message, type = 'success') {
  const element = document.getElementById(elementId);
  if (element) {
    element.innerHTML = `<div class="${type}">${message}</div>`;
    setTimeout(() => {
      element.innerHTML = '';
    }, 5000);
  }
}

// Get URL parameters
function getQueryParam(param) {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get(param);
}

// Format currency — whole amounts render without trailing .00
function formatCurrency(amount, currency = 'USD') {
  const value = Number(amount) || 0;
  const fractionDigits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    }).format(value);
  } catch (e) {
    // Unknown currency code — fall back to a plain prefix
    return `${currency} ${value.toLocaleString('en-US', {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: 2
    })}`;
  }
}

// Format date
function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// Format file size
function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Get file type icon
function getFileTypeIcon(mimeType) {
  if (mimeType.includes('image')) return '🖼️';
  if (mimeType.includes('pdf')) return '📄';
  if (mimeType.includes('word')) return '📝';
  if (mimeType.includes('sheet')) return '📊';
  if (mimeType.includes('presentation')) return '🎥';
  return '📎';
}

// Map the Safepay redirect `?payment=` return param to a donor-facing landing
// banner (issue #7). The success state is deliberately PENDING-AWARE: the donor
// redirect is never proof of payment — only the signed webhook confirms a
// donation — so it says "received, confirming" rather than claiming the gift is
// already confirmed. Cancel/failure both reassure the donor they weren't
// charged. Returns null when there is no (recognised) payment param.
function paymentLandingState(param) {
  switch (param) {
    case 'success':
      return {
        type: 'success',
        title: 'Thank you — your payment was received',
        message: 'We’re confirming it with the payment provider now. Your donation will appear in the ledger below as soon as it clears, usually within a minute.',
      };
    case 'cancelled':
    case 'cancel':
    case 'failed':
      return {
        type: 'error',
        title: 'Your payment didn’t go through',
        message: 'It looks like the payment was cancelled — you have not been charged. You’re welcome to try again whenever you’re ready.',
      };
    default:
      return null;
  }
}

// Exported for Node unit tests; in the browser these stay plain globals loaded
// via <script src="/js/app.js">.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { paymentLandingState };
}
