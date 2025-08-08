// Storage utilities for React Native using AsyncStorage and SecureStore

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';

// Storage Keys
const KEYS = {
  AUTH_TOKEN: 'auth_token',
  USER_EMAIL: 'user_email',
  VAULT_VERSION: 'vault_version',
  VAULT_DATA: 'vault_data',
  SALT: 'salt',
  SESSION_MASTER_KEY: 'session_master_key',
  SESSION_DEK: 'session_dek',
  SESSION_ACTIVE: 'session_active',
};

// Auth Token (SecureStore for sensitive data)
export const getAuthToken = async () => {
  try {
    return await SecureStore.getItemAsync(KEYS.AUTH_TOKEN);
  } catch (err) {
    console.error('Failed to get auth token:', err);
    return null;
  }
};

export const setAuthToken = async (token) => {
  try {
    await SecureStore.setItemAsync(KEYS.AUTH_TOKEN, token);
  } catch (err) {
    console.error('Failed to set auth token:', err);
  }
};

export const removeAuthToken = async () => {
  try {
    await SecureStore.deleteItemAsync(KEYS.AUTH_TOKEN);
  } catch (err) {
    console.error('Failed to remove auth token:', err);
  }
};

// User Email (AsyncStorage)
export const getUserEmail = async () => {
  try {
    return await AsyncStorage.getItem(KEYS.USER_EMAIL);
  } catch (err) {
    console.error('Failed to get user email:', err);
    return null;
  }
};

export const setUserEmail = async (email) => {
  try {
    await AsyncStorage.setItem(KEYS.USER_EMAIL, email);
  } catch (err) {
    console.error('Failed to set user email:', err);
  }
};

export const removeUserEmail = async () => {
  try {
    await AsyncStorage.removeItem(KEYS.USER_EMAIL);
  } catch (err) {
    console.error('Failed to remove user email:', err);
  }
};

// Vault Data (AsyncStorage - encrypted vault blob)
export const getVault = async () => {
  try {
    const data = await AsyncStorage.getItem(KEYS.VAULT_DATA);
    return data ? JSON.parse(data) : null;
  } catch (err) {
    console.error('Failed to get vault:', err);
    return null;
  }
};

export const setVault = async (vaultData) => {
  try {
    await AsyncStorage.setItem(KEYS.VAULT_DATA, JSON.stringify(vaultData));
  } catch (err) {
    console.error('Failed to set vault:', err);
  }
};

export const removeVault = async () => {
  try {
    await AsyncStorage.removeItem(KEYS.VAULT_DATA);
  } catch (err) {
    console.error('Failed to remove vault:', err);
  }
};

// Vault Last Modified (timestamp)
export const getVaultLastModified = async () => {
  try {
    const timestamp = await AsyncStorage.getItem(KEYS.VAULT_VERSION); // Reusing same key for compatibility
    return timestamp || new Date(0).toISOString(); // Return epoch if not set
  } catch (err) {
    console.error('Failed to get vault lastModified:', err);
    return new Date(0).toISOString();
  }
};

export const setVaultLastModified = async (timestamp) => {
  try {
    await AsyncStorage.setItem(KEYS.VAULT_VERSION, timestamp);
  } catch (err) {
    console.error('Failed to set vault lastModified:', err);
  }
};

// Salt (SecureStore)
export const getSalt = async () => {
  try {
    const saltString = await SecureStore.getItemAsync(KEYS.SALT);
    if (!saltString) return null;
    
    // Convert base64 back to Uint8Array
    const decoded = atob(saltString);
    const salt = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      salt[i] = decoded.charCodeAt(i);
    }
    return salt;
  } catch (err) {
    console.error('Failed to get salt:', err);
    return null;
  }
};

export const setSalt = async (salt) => {
  try {
    // Convert Uint8Array to base64 for storage
    const saltString = btoa(String.fromCharCode(...salt));
    await SecureStore.setItemAsync(KEYS.SALT, saltString);
  } catch (err) {
    console.error('Failed to set salt:', err);
  }
};

export const removeSalt = async () => {
  try {
    await SecureStore.deleteItemAsync(KEYS.SALT);
  } catch (err) {
    console.error('Failed to remove salt:', err);
  }
};

// Session Keys (in-memory for security, with SecureStore backup)
let sessionMasterKey = null;
let sessionDEK = null;

export const setSessionKeys = async (masterKey, dek) => {
  sessionMasterKey = masterKey;
  sessionDEK = dek;
  
  try {
    // Export CryptoKey objects to raw bytes first
    const masterKeyBytes = new Uint8Array(await crypto.subtle.exportKey('raw', masterKey));
    const dekBytes = new Uint8Array(await crypto.subtle.exportKey('raw', dek));
    
    // Store as base64 in SecureStore
    const masterKeyString = btoa(String.fromCharCode(...masterKeyBytes));
    const dekString = btoa(String.fromCharCode(...dekBytes));
    
    await SecureStore.setItemAsync(KEYS.SESSION_MASTER_KEY, masterKeyString);
    await SecureStore.setItemAsync(KEYS.SESSION_DEK, dekString);
    await SecureStore.setItemAsync(KEYS.SESSION_ACTIVE, 'true');
  } catch (err) {
    console.error('Failed to store session keys:', err);
  }
};

export const getSessionKeys = async () => {
  // Return in-memory keys if available
  if (sessionMasterKey && sessionDEK) {
    return { masterKey: sessionMasterKey, dek: sessionDEK };
  }
  
  try {
    // Restore from SecureStore
    const isActive = await SecureStore.getItemAsync(KEYS.SESSION_ACTIVE);
    if (isActive !== 'true') return null;
    
    const masterKeyString = await SecureStore.getItemAsync(KEYS.SESSION_MASTER_KEY);
    const dekString = await SecureStore.getItemAsync(KEYS.SESSION_DEK);
    
    if (!masterKeyString || !dekString) return null;
    
    // Decode from base64 to Uint8Array
    const masterKeyBytes = new Uint8Array(atob(masterKeyString).split('').map(c => c.charCodeAt(0)));
    const dekBytes = new Uint8Array(atob(dekString).split('').map(c => c.charCodeAt(0)));
    
    // Re-import as CryptoKey objects
    sessionMasterKey = await crypto.subtle.importKey(
      'raw',
      masterKeyBytes,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
    
    sessionDEK = await crypto.subtle.importKey(
      'raw',
      dekBytes,
      { name: 'AES-GCM', length: 256 },
      true,
      ['encrypt', 'decrypt']
    );
    
    return { masterKey: sessionMasterKey, dek: sessionDEK };
  } catch (err) {
    console.error('Failed to restore session keys:', err);
    return null;
  }
};

export const clearSessionKeys = async () => {
  sessionMasterKey = null;
  sessionDEK = null;
  
  try {
    await SecureStore.deleteItemAsync(KEYS.SESSION_MASTER_KEY);
    await SecureStore.deleteItemAsync(KEYS.SESSION_DEK);
    await SecureStore.deleteItemAsync(KEYS.SESSION_ACTIVE);
  } catch (err) {
    console.error('Failed to clear session keys:', err);
  }
};

export const isSessionActive = async () => {
  if (sessionMasterKey && sessionDEK) return true;
  
  try {
    const isActive = await SecureStore.getItemAsync(KEYS.SESSION_ACTIVE);
    return isActive === 'true';
  } catch (err) {
    return false;
  }
};

// Clear all data (logout)
export const clearAllData = async () => {
  await removeAuthToken();
  await removeUserEmail();
  await removeVault();
  await removeSalt();
  await clearSessionKeys();
  
  try {
    await AsyncStorage.removeItem(KEYS.VAULT_VERSION);
  } catch (err) {
    console.error('Failed to clear vault version:', err);
  }
};
