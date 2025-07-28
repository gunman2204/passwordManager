/**
 * Chrome Storage Wrapper
 * Handles persistence for the extension using chrome.storage.local
 */

export const storage = {
  async get(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get([key]);
      return result[key];
    } else {
      // Fallback for non-extension environment (dev mode)
      const val = localStorage.getItem(key);
      try {
        return JSON.parse(val);
      } catch {
        return val;
      }
    }
  },

  async set(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      // Fallback
      localStorage.setItem(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }
  },

  async remove(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.remove(key);
    } else {
      localStorage.removeItem(key);
    }
  }
};

export const getAuthToken = async () => storage.get('token');
export const setAuthToken = async (token) => storage.set('token', token);
export const removeAuthToken = async () => storage.remove('token');

export const getUserEmail = async () => storage.get('userEmail');
export const setUserEmail = async (email) => storage.set('userEmail', email);

export const getVault = async () => storage.get('vaultBlob');
export const setVault = async (vaultData) => storage.set('vaultBlob', vaultData);

export const getLastModified = async () => {
  const vault = await getVault();
  return vault?.lastModified || null;
};

export const setLastModified = async (timestamp) => {
  const vault = await getVault() || {};
  vault.lastModified = timestamp;
  await setVault(vault);
};

export const getVaultVersion = async () => {
  const version = await storage.get('vaultVersion');
  return version || 0;
};

// Session persistence for vault keys (cleared when Chrome closes)
// Keys are extractable but protected by Chrome's session storage
export const getSessionKeys = async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        const result = await chrome.storage.session.get(['masterKeyRaw', 'dekRaw']);
        if (result.masterKeyRaw && result.dekRaw) {
          // Re-import raw bytes as CryptoKey objects
          const masterKey = await crypto.subtle.importKey(
            'raw',
            new Uint8Array(result.masterKeyRaw),
            { name: 'AES-GCM', length: 256 },
            true, // Extractable for session persistence
            ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
          );
          
          const dek = await crypto.subtle.importKey(
            'raw',
            new Uint8Array(result.dekRaw),
            { name: 'AES-GCM', length: 256 },
            true, // Extractable for session persistence
            ['encrypt', 'decrypt']
          );
          
          return { masterKey, dek };
        }
      } catch (e) {
         console.warn("Error accessing session storage (context invalidated?):", e);
      }
    }
  } catch (e) {
    console.error('Session key restoration failed:', e);
  }
  return null;
};

export const setSessionKeys = async (masterKey, dek) => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      // Export CryptoKey objects as raw bytes before storing
      const masterKeyRaw = await crypto.subtle.exportKey('raw', masterKey);
      const dekRaw = await crypto.subtle.exportKey('raw', dek);
      
      await chrome.storage.session.set({
        masterKeyRaw: Array.from(new Uint8Array(masterKeyRaw)),
        dekRaw: Array.from(new Uint8Array(dekRaw))
      });
    }
  } catch (e) {
    console.error('Session key storage failed:', e);
  }
};

export const clearSessionKeys = async () => {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      await chrome.storage.session.remove(['masterKeyRaw', 'dekRaw']);
    }
  } catch (e) {
    console.log('Session storage not available');
  }
};

export const getVaultVersion_old = async () => {
    const v = await storage.get('vaultVersion');
    return v ? parseInt(v, 10) : 0;
};
export const setVaultVersion = async (version) => storage.set('vaultVersion', version);
