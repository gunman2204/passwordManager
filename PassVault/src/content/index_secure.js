// Secure Content Script for Zero-Knowledge Password Manager
// Enhanced form detection with user confirmation and secure credential handling

class SecureContentScript {
  constructor() {
    this.isInjected = false;
    this.shadowRoot = null;
    this.pendingCredentials = new Map();
    this.init();
  }

  init() {
    // Prevent multiple injections
    if (this.isInjected) return;
    this.isInjected = true;

    // Create secure isolated DOM
    this.createSecureContainer();
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Initial form analysis
    this.analyzeCurrentPage();
  }

  createSecureContainer() {
    // Create isolated container with closed shadow DOM
    const container = document.createElement('passvault-secure-container');
    container.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
    `;
    
    this.shadowRoot = container.attachShadow({ mode: 'closed' });
    document.documentElement.appendChild(container);
  }

  setupEventListeners() {
    // Listen for page load completion
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.analyzeCurrentPage());
    } else {
      this.analyzeCurrentPage();
    }

    // Monitor form submissions for credential capture
    document.addEventListener('submit', (e) => this.handleFormSubmit(e), true);
    
    // Monitor dynamic content changes
    const observer = new MutationObserver(() => this.handleDynamicContent());
    observer.observe(document.body, { 
      childList: true, 
      subtree: true,
      attributes: false 
    });

    // Listen for password field focus (potential auto-fill opportunity)
    document.addEventListener('focusin', (e) => this.handlePasswordFieldFocus(e), true);

    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleBackgroundMessage(message, sender, sendResponse);
    });
  }

  async analyzeCurrentPage() {
    try {
      // Enhanced form detection
      const forms = this.detectLoginForms();
      
      if (forms.length > 0) {
        // Request credentials for this domain
        const response = await this.sendMessageToBackground({
          type: 'GET_CREDENTIALS',
          payload: { url: window.location.href }
        });

        if (response?.credentials?.length > 0) {
          this.showAutoFillPrompt(response.credentials, forms);
        }
      }
    } catch (error) {
      console.debug('Content script analysis error:', error);
    }
  }

  detectLoginForms() {
    const forms = [];
    
    // Enhanced selectors for modern web apps
    const formSelectors = [
      'form',
      '[role="form"]',
      'div[class*="login"]',
      'div[class*="signin"]',
      'div[class*="auth"]',
      'div[id*="login"]',
      'div[id*="signin"]'
    ];

    const formElements = document.querySelectorAll(formSelectors.join(', '));

    formElements.forEach((element, index) => {
      const passwordFields = element.querySelectorAll('input[type="password"]');
      
      if (passwordFields.length === 0) return;

      const usernameFields = element.querySelectorAll([
        'input[type="email"]',
        'input[type="text"]',
        'input[type="username"]',
        'input[name*="email" i]',
        'input[name*="user" i]',
        'input[id*="email" i]',
        'input[id*="user" i]',
        'input[placeholder*="email" i]',
        'input[placeholder*="username" i]'
      ].join(', '));

      // Filter out obvious non-username fields
      const validUsernameFields = Array.from(usernameFields).filter(field => {
        const name = (field.name || '').toLowerCase();
        const id = (field.id || '').toLowerCase();
        const placeholder = (field.placeholder || '').toLowerCase();
        
        // Exclude fields that are clearly not usernames
        const excludePatterns = ['search', 'phone', 'name', 'first', 'last', 'address'];
        return !excludePatterns.some(pattern => 
          name.includes(pattern) || id.includes(pattern) || placeholder.includes(pattern)
        );
      });

      if (validUsernameFields.length > 0) {
        forms.push({
          element,
          index,
          passwordFields: Array.from(passwordFields),
          usernameFields: validUsernameFields,
          isLoginForm: true
        });
      }
    });

    return forms;
  }

  async handleFormSubmit(event) {
    try {
      const form = event.target.closest('form') || event.target;
      
      const passwordFields = form.querySelectorAll('input[type="password"]');
      if (passwordFields.length === 0) return;

      // Extract credential data
      const credentials = [];
      
      passwordFields.forEach(passwordField => {
        if (!passwordField.value) return;

        // Find associated username field
        const usernameField = this.findUsernameField(form, passwordField);
        if (!usernameField?.value) return;

        credentials.push({
          username: usernameField.value,
          password: passwordField.value,
          url: window.location.href,
          title: document.title || window.location.hostname,
          timestamp: Date.now()
        });
      });

      // Send credentials to background for potential saving
      for (const credential of credentials) {
        await this.sendMessageToBackground({
          type: 'SAVE_CREDENTIAL',
          payload: credential
        });
      }

    } catch (error) {
      console.debug('Form submit handler error:', error);
    }
  }

  findUsernameField(container, passwordField) {
    // Look for username field near the password field
    const allInputs = container.querySelectorAll('input[type="text"], input[type="email"], input[type="username"]');
    
    // Sort by proximity to password field
    const inputsWithDistance = Array.from(allInputs).map(input => {
      const rect1 = input.getBoundingClientRect();
      const rect2 = passwordField.getBoundingClientRect();
      const distance = Math.abs(rect1.top - rect2.top) + Math.abs(rect1.left - rect2.left);
      return { input, distance };
    });

    inputsWithDistance.sort((a, b) => a.distance - b.distance);
    
    // Return the closest input that looks like a username field
    for (const { input } of inputsWithDistance) {
      if (this.isUsernameField(input)) {
        return input;
      }
    }

    return null;
  }

  isUsernameField(input) {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const type = (input.type || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();

    // Positive indicators
    const positivePatterns = ['email', 'user', 'login', 'account'];
    const hasPositive = positivePatterns.some(pattern => 
      name.includes(pattern) || id.includes(pattern) || placeholder.includes(pattern)
    );

    // Negative indicators
    const negativePatterns = ['search', 'phone', 'first', 'last', 'address', 'zip', 'code'];
    const hasNegative = negativePatterns.some(pattern => 
      name.includes(pattern) || id.includes(pattern) || placeholder.includes(pattern)
    );

    return (type === 'email' || hasPositive) && !hasNegative;
  }

  async handlePasswordFieldFocus(event) {
    if (event.target.type !== 'password') return;

    try {
      // Check if we have credentials for this site
      const response = await this.sendMessageToBackground({
        type: 'GET_CREDENTIALS',
        payload: { url: window.location.href }
      });

      if (response?.credentials?.length > 0) {
        this.showQuickFillPrompt(event.target, response.credentials);
      }
    } catch (error) {
      console.debug('Password field focus handler error:', error);
    }
  }

  showAutoFillPrompt(credentials, forms) {
    // Create secure prompt UI in shadow DOM
    const prompt = this.createSecurePrompt({
      type: 'autofill',
      credentials,
      forms,
      message: `Auto-fill login for ${window.location.hostname}?`
    });

    this.shadowRoot.appendChild(prompt);
  }

  showQuickFillPrompt(passwordField, credentials) {
    // Show inline prompt near password field
    const prompt = this.createSecurePrompt({
      type: 'quickfill',
      credentials,
      passwordField,
      message: 'Fill saved password?'
    });

    this.shadowRoot.appendChild(prompt);
  }

  createSecurePrompt(options) {
    const prompt = document.createElement('div');
    prompt.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.1);
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 14px;
      max-width: 300px;
      pointer-events: auto;
    `;

    prompt.innerHTML = `
      <div style="margin-bottom: 12px; font-weight: 600; color: #1e293b;">
        🔐 PassVault
      </div>
      <div style="margin-bottom: 12px; color: #475569;">
        ${options.message}
      </div>
      <div style="display: flex; gap: 8px;">
        <button id="accept" style="
          background: #4f46e5;
          color: white;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
        ">Fill</button>
        <button id="decline" style="
          background: #f1f5f9;
          color: #64748b;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          cursor: pointer;
          font-size: 13px;
        ">Cancel</button>
      </div>
    `;

    // Add event handlers
    prompt.querySelector('#accept').addEventListener('click', () => {
      this.fillCredentials(options.credentials[0], options.forms?.[0]);
      prompt.remove();
    });

    prompt.querySelector('#decline').addEventListener('click', () => {
      prompt.remove();
    });

    // Auto-remove after 10 seconds
    setTimeout(() => prompt.remove(), 10000);

    return prompt;
  }

  fillCredentials(credential, form) {
    try {
      const container = form?.element || document;
      
      // Find and fill username field
      const usernameField = container.querySelector([
        'input[type="email"]',
        'input[type="text"][name*="user" i]',
        'input[type="text"][id*="user" i]',
        'input[type="text"][name*="email" i]',
        'input[type="text"][id*="email" i]'
      ].join(', '));

      // Find and fill password field
      const passwordField = container.querySelector('input[type="password"]');

      if (usernameField) {
        usernameField.value = credential.username;
        usernameField.dispatchEvent(new Event('input', { bubbles: true }));
        usernameField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      if (passwordField) {
        passwordField.value = credential.password;
        passwordField.dispatchEvent(new Event('input', { bubbles: true }));
        passwordField.dispatchEvent(new Event('change', { bubbles: true }));
      }

      console.log(`PassVault: Filled credentials for ${credential.username}`);

    } catch (error) {
      console.error('Credential fill error:', error);
    }
  }

  handleDynamicContent() {
    // Debounce dynamic content analysis
    clearTimeout(this.dynamicContentTimeout);
    this.dynamicContentTimeout = setTimeout(() => {
      this.analyzeCurrentPage();
    }, 1000);
  }

  handleBackgroundMessage(message, sender, sendResponse) {
    switch (message.type) {
      case 'FILL_CREDENTIALS':
        this.fillCredentials(message.credential);
        sendResponse({ success: true });
        break;
        
      case 'ANALYZE_FORMS':
        const forms = this.detectLoginForms();
        sendResponse({ forms: forms.length });
        break;
        
      default:
        sendResponse({ error: 'Unknown message type' });
    }
  }

  async sendMessageToBackground(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            console.debug('Background message error:', chrome.runtime.lastError);
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        console.debug('Send message error:', error);
        resolve(null);
      }
    });
  }
}// Initialize secure content script\nif (typeof window !== 'undefined') {\n  // Prevent multiple initialization\n  if (!window.passVaultSecureContentScript) {\n    window.passVaultSecureContentScript = new SecureContentScript();\n  }\n}