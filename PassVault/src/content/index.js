// Secure Content Script for Zero-Knowledge Password Manager
// CRXJS-compatible implementation with hot reload support

// Development hot reload support
if (import.meta.hot) {
  import.meta.hot.accept();
}

console.log('PassVault content script loaded - CRXJS version');

let detectedForms = [];
let autoFillBannerShown = false;
let saveBannerShown = false;

// Enhanced form detection for login forms
function detectLoginForms() {
  const forms = [];
  const formSelectors = [
    'form',
    '[role="form"]',
    'div[class*="login"]',
    'div[class*="signin"]',
    'div[class*="auth"]'
  ];
  
  const formElements = document.querySelectorAll(formSelectors.join(', '));
  
  formElements.forEach((element) => {
    const passwordFields = element.querySelectorAll('input[type="password"]');
    const usernameFields = element.querySelectorAll(
      'input[type="email"], input[type="text"], input[name*="user"], input[name*="email"], input[id*="user"], input[id*="email"]'
    );
    
    if (passwordFields.length > 0 && usernameFields.length > 0) {
      forms.push({
        element,
        passwordFields: Array.from(passwordFields),
        usernameFields: Array.from(usernameFields)
      });
    }
  });
  
  return forms;
}

// Fill credentials into form fields
function fillCredentials(credential) {
  const forms = detectLoginForms();
  
  if (forms.length > 0) {
    const form = forms[0];
    
    // Fill username
    if (form.usernameFields.length > 0) {
      form.usernameFields[0].value = credential.username;
      form.usernameFields[0].dispatchEvent(new Event('input', { bubbles: true }));
      form.usernameFields[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    // Fill password
    if (form.passwordFields.length > 0) {
      form.passwordFields[0].value = credential.password;
      form.passwordFields[0].dispatchEvent(new Event('input', { bubbles: true }));
      form.passwordFields[0].dispatchEvent(new Event('change', { bubbles: true }));
    }
    
    console.log("PassVault: Autofilled credentials for", credential.name || credential.title);
  }
}

// Show auto-fill banner with credential options
function showAutoFillBanner(credentials) {
  if (autoFillBannerShown || credentials.length === 0) return;
  autoFillBannerShown = true;
  
  const banner = document.createElement('div');
  banner.id = 'passvault-autofill-banner';
  banner.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 320px;
    animation: slideIn 0.3s ease-out;
  `;
  
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
      <svg width="20" height="20" fill="white" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
      </svg>
      <strong style="font-size: 14px;">PassVault Auto-fill</strong>
      <button id="passvault-close-banner" style="margin-left: auto; background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 16px; display: flex; align-items: center; justify-content: center;">×</button>
    </div>
    <div style="font-size: 13px; margin-bottom: 12px; opacity: 0.95;">
      Found ${credentials.length} saved ${credentials.length === 1 ? 'credential' : 'credentials'} for this site
    </div>
    <div id="passvault-credential-list" style="max-height: 200px; overflow-y: auto;">
      ${credentials.map((cred, index) => `
        <button 
          class="passvault-fill-btn" 
          data-index="${index}"
          style="
            width: 100%;
            background: rgba(255,255,255,0.15);
            border: 1px solid rgba(255,255,255,0.3);
            color: white;
            padding: 10px 12px;
            border-radius: 8px;
            cursor: pointer;
            margin-bottom: 8px;
            text-align: left;
            font-size: 13px;
            transition: all 0.2s;
          "
          onmouseover="this.style.background='rgba(255,255,255,0.25)'"
          onmouseout="this.style.background='rgba(255,255,255,0.15)'"
        >
          <div style="font-weight: 500;">${cred.name || cred.title || 'Untitled'}</div>
          <div style="font-size: 11px; opacity: 0.8; margin-top: 2px;">${cred.username}</div>
        </button>
      `).join('')}
    </div>
  `;
  
  document.body.appendChild(banner);
  
  // Add click handlers
  credentials.forEach((cred, index) => {
    const btn = banner.querySelector(`[data-index="${index}"]`);
    if (btn) {
      btn.addEventListener('click', () => {
        fillCredentials(cred);
        banner.remove();
      });
    }
  });
  
  banner.querySelector('#passvault-close-banner').addEventListener('click', () => {
    banner.remove();
  });
  
  // Auto-close after 15 seconds
  setTimeout(() => {
    if (banner.parentNode) banner.remove();
  }, 15000);
}

// Show save password banner
function showSavePasswordBanner(username, password, capturedUrl) {
  if (saveBannerShown) return;
  saveBannerShown = true;
  
  const banner = document.createElement('div');
  banner.id = 'passvault-save-banner';
  banner.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 16px 20px;
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.2);
    z-index: 999999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    max-width: 360px;
  `;
  
  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
      <svg width="20" height="20" fill="white" viewBox="0 0 24 24">
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/>
      </svg>
      <strong style="font-size: 14px;">Save Password?</strong>
      <button id="passvault-close-save" style="margin-left: auto; background: rgba(255,255,255,0.2); border: none; color: white; width: 24px; height: 24px; border-radius: 50%; cursor: pointer; font-size: 16px;">×</button>
    </div>
    <div style="font-size: 12px; margin-bottom: 8px; opacity: 0.95;">
      <div style="margin-bottom: 6px;"><strong>${username}</strong></div>
      <input 
        id="passvault-url-edit" 
        type="text" 
        value="${capturedUrl}"
        style="width: 100%; padding: 6px 8px; border-radius: 6px; border: 1px solid rgba(255,255,255,0.3); background: rgba(255,255,255,0.15); color: white; font-size: 11px; outline: none;"
        placeholder="Website URL"
      />
    </div>
    <div style="display: flex; gap: 8px;">
      <button id="passvault-save-yes" style="flex: 1; background: rgba(255,255,255,0.9); border: none; color: #667eea; padding: 10px; border-radius: 8px; cursor: pointer; font-weight: 600; font-size: 13px;">Save</button>
      <button id="passvault-save-no" style="flex: 1; background: rgba(255,255,255,0.2); border: 1px solid rgba(255,255,255,0.3); color: white; padding: 10px; border-radius: 8px; cursor: pointer; font-size: 13px;">Not Now</button>
    </div>
  `;
  
  document.body.appendChild(banner);
  
  banner.querySelector('#passvault-save-yes').addEventListener('click', () => {
    const editedUrl = banner.querySelector('#passvault-url-edit').value;
    
    chrome.runtime.sendMessage({
      type: 'SAVE_CREDENTIAL',
      payload: {
        url: editedUrl || capturedUrl,
        username: username,
        password: password,
        name: document.title || new URL(editedUrl || capturedUrl).hostname
      }
    }, (response) => {
      if (response && response.success) {
        // Show success message
        const successMsg = document.createElement('div');
        successMsg.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          color: white;
          padding: 16px 20px;
          border-radius: 12px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.2);
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          font-size: 14px;
          font-weight: 500;
        `;
        
        if (response.savedToVault) {
          successMsg.textContent = '✓ Password saved to vault!';
        } else if (response.requiresUnlock) {
          successMsg.textContent = '🔒 Open PassVault and unlock to save password';
          successMsg.style.background = 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)';
        }
        
        document.body.appendChild(successMsg);
        setTimeout(() => successMsg.remove(), 4000);
      }
    });
    banner.remove();
  });
  
  banner.querySelector('#passvault-save-no').addEventListener('click', () => {
    banner.remove();
  });
  
  banner.querySelector('#passvault-close-save').addEventListener('click', () => {
    banner.remove();
  });
}

// Request auto-fill on page load
function requestAutoFill() {
  console.log('PassVault: Requesting auto-fill for', window.location.href);
  try {
    chrome.runtime.sendMessage({ 
      type: 'GET_CREDENTIALS', 
      payload: { url: window.location.href } 
    }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('PassVault: Extension context lost', chrome.runtime.lastError);
        return;
      }
      
      console.log('PassVault: Auto-fill response:', response);
      
      if (response && response.credentials && response.credentials.length > 0) {
        // Show auto-fill banner
        showAutoFillBanner(response.credentials);
      } else {
        console.log('PassVault: No credentials found for this site');
      }
    });
  } catch (e) {
    console.log('PassVault: Error requesting auto-fill', e);
  }
}

// Detect form submission and capture credentials
function setupFormCapture() {
  console.log('PassVault: Setting up form capture');
  document.addEventListener('submit', (e) => {
    const form = e.target;
    const userInputs = form.querySelectorAll('input[type="text"], input[type="email"]');
    const passInputs = form.querySelectorAll('input[type="password"]');
    
    if (passInputs.length > 0 && userInputs.length > 0) {
      const username = userInputs[0].value;
      const password = passInputs[0].value;
      
      if (username && password) {
        console.log('PassVault: Credentials captured for:', username);
        
        // Capture URL BEFORE redirect
        const capturedUrl = window.location.href;
        
        // Wait a bit to see if login is successful, but use captured URL
        setTimeout(() => {
          showSavePasswordBanner(username, password, capturedUrl);
        }, 1000);
      }
    }
  }, true);
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    detectedForms = detectLoginForms();
    if (detectedForms.length > 0) {
      requestAutoFill();
      setupFormCapture();
    }
  });
} else {
  detectedForms = detectLoginForms();
  if (detectedForms.length > 0) {
    requestAutoFill();
    setupFormCapture();
  }
}

// Also check after a delay for dynamically loaded forms
setTimeout(() => {
  if (detectedForms.length === 0) {
    detectedForms = detectLoginForms();
    if (detectedForms.length > 0) {
      requestAutoFill();
      setupFormCapture();
    }
  }
}, 2000);
