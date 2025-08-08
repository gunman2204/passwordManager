// API utilities for React Native

import { getAuthToken } from './storage';

const API_BASE_URL = 'http://10.240.68.78:5000/api';

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
   * Register without sending master password
   * Master password stays client-side only for encryption
   */
  async register(email, accountPassword, deviceName) {
    return this.fetch('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ 
        email, 
        password: accountPassword,
        device_name: deviceName 
      }),
    });
  },

  /**
   * Login without sending master password
   */
  async login(email, accountPassword, deviceName) {
    return this.fetch('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ 
        email, 
        password: accountPassword,
        device_name: deviceName 
      }),
    });
  },

  async syncVault(encryptedBlob, lastModified) {
    const token = await getAuthToken();
    
    const response = await fetch(`${API_BASE_URL}/vault/sync`, {
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
      throw new Error('Sync failed');
    }

    const data = await response.json();
    return data; // Returns { success, action, lastModified, encrypted_blob? }
  },

  async pullVault() {
    const token = await getAuthToken();
    
    const response = await fetch(`${API_BASE_URL}/vault/pull`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error('Pull failed');
    }

    const data = await response.json();
    return {
      encryptedBlob: data.encrypted_blob,
      lastModified: data.lastModified
    };
  }
};
