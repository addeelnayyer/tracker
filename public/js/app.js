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

// Format currency
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
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
