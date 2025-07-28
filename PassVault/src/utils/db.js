/**
 * IndexedDB wrapper for secure vault storage
 * CRITICAL: Stores encrypted vault, encrypted DEK, salt, and version
 * Backend must NEVER have access to decrypt these
 */

const DB_NAME = 'PassVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'vault';

class VaultDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create vault store if it doesn't exist
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  }

  /**
   * Store the complete vault structure
   * @param {Object} vaultData - {encryptedVault, vaultIV, encryptedDEK, dekIV, salt, version}
   */
  async setVault(vaultData) {
    const db = await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.put(vaultData, 'vaultData');
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Retrieve the vault structure
   * @returns {Promise<Object|null>}
   */
  async getVault() {
    const db = await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.get('vaultData');
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Store user salt (generated during registration)
   * CRITICAL: Salt must be unique per user and stored locally
   */
  async setSalt(salt) {
    const db = await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.put(salt, 'salt');
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSalt() {
    const db = await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.get('salt');
      
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Clear all vault data (on logout)
   */
  async clear() {
    const db = await this.init();
    
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      
      const request = store.clear();
      
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

export const vaultDB = new VaultDB();
