import { getAuthToken } from './storage';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const api = {
  async fetch(endpoint, options = {}) {
    const token = await getAuthToken();
    
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || 'API request failed');
    }

    return data;
  },

  /**
   * CRITICAL FIX: Register without sending master password
   * Master password stays client-side only for encryption
   * @param {string} email - User email
   * @param {string} accountPassword - Separate account password for backend auth (NOT master password)
   * @param {string} deviceName - Device identifier
   */
  async register(email, accountPassword, deviceName) {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ 
        email, 
        password: accountPassword, // Backend auth password, separate from vault encryption
        device_name: deviceName 
      }),
    });
  },

  /**
   * CRITICAL FIX: Login without sending master password
   * @param {string} email - User email  
   * @param {string} accountPassword - Account password for backend auth
   * @param {string} deviceName - Device identifier
   */
  async login(email, accountPassword, deviceName) {
    return this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ 
        email, 
        password: accountPassword, // Backend auth only
        device_name: deviceName 
      }),
    });
  },

  async sync(encryptedBlob, lastModified) {
    return this.fetch('/vault/sync', {
      method: 'POST',
      body: JSON.stringify({ 
        encryptedBlob: JSON.stringify(encryptedBlob),
        lastModified: lastModified || new Date().toISOString()
      }),
    });
  },

  async pullVault() {
    return this.fetch('/vault/pull', {
      method: 'GET'
    });
  }
};
