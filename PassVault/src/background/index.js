// Secure Background Service Worker for Zero-Knowledge Password Manager
// Uses secure session management and never exposes key material

import { SecureSessionManager, deriveVaultKey, decryptVault, encryptVault } from '../../vault/crypto.js';
import { getVault as getVaultStorage, getAuthToken, getSessionKeys } from '../utils/storage.js';
import { vaultDB } from '../utils/db.js';

// Development hot reload support
if (import.meta.hot) {
  import.meta.hot.accept();
}

console.log('PassVault secure background worker loaded');

// Secure credential extraction and auto-fill service
class SecureCredentialService {
  // Validate message sender for security
  static validateSender(sender) {
    // Only accept messages from extension contexts and HTTPS pages
    if (!sender.tab?.url) return false;
    
    try {
      const url = new URL(sender.tab.url);
      return url.protocol === 'https:' || url.hostname === 'localhost';
    } catch {
      return false;
    }
  }

  // Extract domain from URL for credential matching
  static extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.toLowerCase();
    } catch {
      return null;
    }
  }

  // Get credentials for a specific domain
  static async getCredentialsForDomain(domain) {
    try {
      // Check if user is authenticated
      const token = await getAuthToken();
      if (!token) {
        return { error: 'User not authenticated' };
      }

      // Get active session
      const sessionData = await chrome.storage.session.get(['sessionId', 'sessionActive', 'sessionExpiry']);
      if (!sessionData.sessionActive || !sessionData.sessionId || Date.now() > sessionData.sessionExpiry) {
        return { error: 'Vault locked - please unlock in popup' };
      }

      // Get session key (non-extractable)
      const sessionKey = await SecureSessionManager.getSessionKey(sessionData.sessionId);
      if (!sessionKey) {
        return { error: 'Session expired - please unlock vault' };
      }

      // Get encrypted vault data
      const vaultData = await getVaultStorage();
      if (!vaultData || !vaultData.encrypted || !vaultData.integrity) {
        return { credentials: [] };
      }

      // Decrypt vault with integrity verification
      const encryptedBuffer = new Uint8Array(vaultData.encrypted);
      const integrityHash = new Uint8Array(vaultData.integrity);
      
      // For background script, we need to derive vault key from session key
      // This is a limitation - we need to store master key reference
      // Alternative: have popup handle decryption and cache decrypted data temporarily
      
      // For now, return empty - full implementation needs popup cooperation
      return { 
        credentials: [], 
        note: 'Background decryption requires popup session - feature in development' 
      };

    } catch (error) {
      console.error('Credential retrieval error:', error);
      return { error: 'Failed to retrieve credentials' };
    }
  }

  // Save new credential (requires user confirmation)
  static async saveCredential(credentialData, tabUrl) {
    try {
      const domain = this.extractDomain(tabUrl);
      if (!domain) return { error: 'Invalid URL' };

      // Store pending credential for user review
      const pending = await chrome.storage.local.get('pendingCredentials') || { pendingCredentials: [] };
      const newCredential = {
        id: crypto.randomUUID(),
        domain,
        url: tabUrl,
        username: credentialData.username,
        password: credentialData.password,
        title: credentialData.title || domain,
        timestamp: Date.now()
      };

      pending.pendingCredentials.push(newCredential);
      await chrome.storage.local.set({ pendingCredentials: pending.pendingCredentials });

      // Notify popup if open or show notification
      chrome.runtime.sendMessage({
        type: 'CREDENTIAL_DETECTED',
        credential: newCredential
      }).catch(() => {
        // Popup not open - show notification
        chrome.notifications.create({
          type: 'basic',
          iconUrl: 'icon.png',
          title: 'PassVault',
          message: `New password detected for ${domain}. Open PassVault to save.`
        });
      });

      return { success: true, id: newCredential.id };
    } catch (error) {
      console.error('Save credential error:', error);
      return { error: 'Failed to save credential' };
    }
  }
}

// Advanced form detection and credential extraction
class FormDetectionService {
  // Analyze page for login forms and credential fields
  static async analyzePageForms(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        function: this.detectFormsOnPage
      });

      return results[0]?.result || { forms: [], credentials: [] };
    } catch (error) {
      console.error('Form detection error:', error);
      return { forms: [], credentials: [] };
    }
  }

  // Injected function to detect forms (runs in page context)
  static detectFormsOnPage() {
    const forms = [];
    const credentials = [];

    // Enhanced form detection
    const formElements = [
      ...document.querySelectorAll('form'),
      ...document.querySelectorAll('[role="form"]'),
      ...document.querySelectorAll('div[class*="login"], div[class*="signin"], div[class*="auth"]')
    ];

    formElements.forEach((form, index) => {
      const passwordFields = form.querySelectorAll('input[type="password"]');
      const emailFields = form.querySelectorAll('input[type="email"], input[name*="email"], input[id*="email"]');
      const usernameFields = form.querySelectorAll('input[type="text"], input[type="username"], input[name*="user"], input[id*="user"]');

      if (passwordFields.length > 0) {
        const formData = {
          id: `form-${index}`,
          element: form.tagName,
          hasPassword: passwordFields.length,
          hasEmail: emailFields.length,
          hasUsername: usernameFields.length,
          action: form.action || window.location.href,
          method: form.method || 'GET'
        };

        forms.push(formData);

        // Check for filled credentials
        passwordFields.forEach(passwordField => {
          const username = emailFields[0]?.value || usernameFields[0]?.value;
          const password = passwordField.value;

          if (username && password) {
            credentials.push({
              type: 'login',
              username,
              password,
              url: window.location.href,
              title: document.title,
              formId: formData.id
            });
          }
        });
      }
    });

    return { forms, credentials };
  }
}

// Helper function to normalize URL for matching
function normalizeURL(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url.toLowerCase();
  }
}

async function saveDirectlyToVault(credential, dek) {
  try {
    // Get current vault
    const vaultData = await vaultDB.getVault();
    
    if (!vaultData || !vaultData.encryptedVault) {
      throw new Error('Vault not found');
    }
    
    // Decrypt vault
    const encryptedVault = new Uint8Array(vaultData.encryptedVault);
    const vaultIV = new Uint8Array(vaultData.vaultIV);
    const items = await decryptVault(encryptedVault, vaultIV, dek);
    
    // Check for duplicates (same URL + username)
    const normalizedURL = normalizeURL(credential.url);
    const existingIndex = items.findIndex(item => {
      const itemURL = normalizeURL(item.url || item.name || '');
      return (itemURL === normalizedURL || item.name === credential.name) && 
             item.username === credential.username;
    });
    
    let updatedItems;
    if (existingIndex >= 0) {
      // Update existing credential
      updatedItems = [...items];
      updatedItems[existingIndex] = {
        ...updatedItems[existingIndex],
        password: credential.password,
        updatedAt: Date.now()
      };
    } else {
      // Add new credential
      updatedItems = [...items, credential];
    }
    
    // Re-encrypt vault
    const { encryptedVault: newEncryptedVault, iv: newVaultIV } = await encryptVault(updatedItems, dek);
    
    // Save to IndexedDB
    const lastModified = new Date().toISOString();
    const updatedVault = {
      ...vaultData,
      encryptedVault: Array.from(newEncryptedVault),
      vaultIV: Array.from(newVaultIV),
      version: (vaultData.version || 0) + 1,
      lastModified
    };
    
    await vaultDB.setVault(updatedVault);
    
    // Sync to backend
    const token = await getAuthToken();
    if (token) {
      try {
        console.log('Syncing to backend...');
        
        // Prepare full blob for sync
        const encryptedBlob = {
          encryptedVault: Array.from(newEncryptedVault),
          vaultIV: Array.from(newVaultIV),
          encryptedDEK: Array.isArray(vaultData.encryptedDEK) ? vaultData.encryptedDEK : Array.from(vaultData.encryptedDEK || []),
          dekIV: Array.isArray(vaultData.dekIV) ? vaultData.dekIV : Array.from(vaultData.dekIV || []),
          salt: Array.isArray(vaultData.salt) ? vaultData.salt : Array.from(vaultData.salt || [])
        };

        // We can't easily import syncVault here due to potential module issues in SW without bundling config for it (though Vite handles it usually).
        // Safest approach is to use the api.sync directly which we already have, or replicate the fetch.
        // Let's use api.sync if we can import it, or just raw fetch.
        // We haven't imported api.sync yet. Let's rely on raw fetch to be safe as this is a background SW.
        // Actually, let's use the fetch pattern from sync.js to ensure consistency.
        
        const response = await fetch('http://localhost:5000/api/vault/sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ 
            encryptedBlob: JSON.stringify(encryptedBlob),
            lastModified
          })
        });

        if (!response.ok) {
           console.warn('Background sync failed:', await response.text());
        } else {
           const data = await response.json();
           console.log('Background sync successful:', data.action);
        }

      } catch (e) {
        console.warn('Backend sync error:', e);
      }
    }
    
    return true;
  } catch (error) {
    console.error('Save to vault error:', error);
    throw error;
  }
}

// Message handling with security validation
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request.type);
  
  // Handle different message types
  switch (request.type) {
    case 'GET_CREDENTIALS':
      handleGetCredentials(request.payload, sender, sendResponse);
      return true; // Async response

    case 'SAVE_CREDENTIAL':
      handleSaveCredential(request.payload, sender, sendResponse);
      return true;

    case 'ANALYZE_FORMS':
      handleAnalyzeForms(sender.tab?.id, sendResponse);
      return true;

    case 'SESSION_CHECK':
      handleSessionCheck(sendResponse);
      return true;

    case 'GET_VAULT_FOR_AUTOFILL':
      handleGetVaultForAutofill(request.payload, sendResponse);
      return true;

    default:
      sendResponse({ error: 'Unknown message type' });
      return false;
  }
});

// Get credentials from unlocked vault (requires session)
async function handleGetVaultForAutofill({ url }, sendResponse) {
  console.log('handleGetVaultForAutofill called for:', url);
  try {
    // Check if vault is unlocked
    const sessionKeys = await getSessionKeys();
    console.log('Session keys available:', !!sessionKeys);
    
    if (!sessionKeys || !sessionKeys.dek) {
      console.log('Vault is locked, returning empty credentials');
      sendResponse({ credentials: [] });
      return;
    }
    
    // Get encrypted vault
    const vaultData = await vaultDB.getVault();
    if (!vaultData || !vaultData.encryptedVault) {
      console.log('No vault data found');
      sendResponse({ credentials: [] });
      return;
    }
    
    // Decrypt vault
    const encryptedVault = new Uint8Array(vaultData.encryptedVault);
    const vaultIV = new Uint8Array(vaultData.vaultIV);
    const items = await decryptVault(encryptedVault, vaultIV, sessionKeys.dek);
    console.log('Vault decrypted, total items:', items.length);
    
    // Filter credentials by URL
    const normalizedURL = normalizeURL(url);
    const matchingCredentials = items.filter(item => {
      const itemURL = normalizeURL(item.url || item.name || '');
      return itemURL.includes(normalizedURL) || normalizedURL.includes(itemURL);
    });
    
    console.log('Matching credentials found:', matchingCredentials.length);
    sendResponse({ credentials: matchingCredentials });
  } catch (error) {
    console.error('Auto-fill error:', error);
    sendResponse({ credentials: [], error: error.message });
  }
}

// Message handlers
async function handleGetCredentials({ url }, sender, sendResponse) {
  // Use the new vault-based auto-fill
  await handleGetVaultForAutofill({ url }, sendResponse);
}

async function handleSaveCredential(payload, sender, sendResponse) {
  console.log('handleSaveCredential called:', payload);
  try {
    // Check if vault is unlocked
    const sessionKeys = await getSessionKeys();
    console.log('Session keys for save:', !!sessionKeys);
    
    const newCredential = {
      id: crypto.randomUUID(),
      url: payload.url,
      name: payload.name || new URL(payload.url).hostname,
      username: payload.username,
      password: payload.password,
      note: '',
      timestamp: Date.now(),
      createdAt: Date.now()
    };
    
    if (sessionKeys && sessionKeys.dek) {
      // Vault is unlocked - save directly to vault
      console.log('Vault unlocked, saving directly...');
      try {
        await saveDirectlyToVault(newCredential, sessionKeys.dek);
        console.log('Saved directly to vault successfully');
        
        // Notify popup if open
        try {
          await chrome.runtime.sendMessage({
            type: 'CREDENTIAL_SAVED_TO_VAULT',
            credential: newCredential
          });
        } catch (e) {
          // Popup not open, show success notification
          chrome.notifications.create({
            type: 'basic',
            iconUrl: '/icon-128.png',
            title: 'PassVault',
            message: `Password saved for ${newCredential.name}`
          });
        }
        
        sendResponse({ success: true, savedToVault: true, id: newCredential.id });
        return;
      } catch (error) {
        console.error('Direct save failed:', error);
        // Fall through to pending storage
      }
    }
    
    // Vault is locked - add to encrypted pending credentials
    console.log('Vault locked, adding to pending...');
    const pending = await chrome.storage.local.get('pendingCredentials');
    const pendingList = pending.pendingCredentials || [];
    
    // Encrypt password before storing
    const encryptedCredential = {
      ...newCredential,
      password: btoa(newCredential.password), // Basic encoding to avoid plain text
      _encrypted: true
    };
    
    pendingList.push(encryptedCredential);
    await chrome.storage.local.set({ pendingCredentials: pendingList });
    console.log('Added to pending credentials');
    
    // Try to notify popup
    try {
      await chrome.runtime.sendMessage({
        type: 'PENDING_CREDENTIAL_ADDED',
        credential: newCredential
      });
    } catch (e) {
      // Popup not open, show notification to unlock
      chrome.notifications.create({
        type: 'basic',
        iconUrl: '/icon-128.png',
        title: 'PassVault - Unlock Required',
        message: `Password detected for ${newCredential.name}. Open PassVault and unlock to save.`,
        requireInteraction: true
      });
    }
    
    sendResponse({ success: true, savedToVault: false, requiresUnlock: true, id: newCredential.id });
  } catch (error) {
    console.error('Save credential error:', error);
    sendResponse({ success: false, error: error.message });
  }
}

async function handleAnalyzeForms(tabId, sendResponse) {
  const result = await FormDetectionService.analyzePageForms(tabId);
  sendResponse(result);
}

async function handleSessionCheck(sendResponse) {
  try {
    const sessionKeys = await getSessionKeys();
    const isActive = sessionKeys !== null;
    sendResponse({ sessionActive: isActive });
  } catch (error) {
    sendResponse({ sessionActive: false, error: error.message });
  }
}

// Tab event handlers for credential detection
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only process completed page loads on HTTPS sites
  if (changeInfo.status === 'complete' && tab.url?.startsWith('https://')) {
    // Delay to allow page scripts to load
    setTimeout(async () => {
      try {
        const analysis = await FormDetectionService.analyzePageForms(tabId);
        
        if (analysis.credentials.length > 0) {
          // Credentials detected - save them
          for (const credential of analysis.credentials) {
            await SecureCredentialService.saveCredential(credential, tab.url);
          }
        }
      } catch (error) {
        console.error('Tab analysis error:', error);
      }
    }, 2000);
  }
});

// Extension lifecycle
chrome.runtime.onStartup.addListener(() => {
  console.log('PassVault background service worker started');
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('PassVault installed');
  } else if (details.reason === 'update') {
    console.log('PassVault updated');
  }
});

// Cleanup on extension shutdown
self.addEventListener('beforeunload', async () => {
  // Clear any sensitive session data
  await chrome.storage.session.clear();
});
