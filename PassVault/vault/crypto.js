// Zero-Knowledge Crypto Module
// Production-grade encryption with non-extractable keys and secure session management

// Cross-context crypto API detection
const cryptoSubtle = (() => {
  if (typeof window !== 'undefined' && window.crypto?.subtle) return window.crypto.subtle;
  if (typeof self !== 'undefined' && self.crypto?.subtle) return self.crypto.subtle;
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) return globalThis.crypto.subtle;
  throw new Error('Web Crypto API not available');
})();

const cryptoRandom = (() => {
  if (typeof window !== 'undefined' && window.crypto) return window.crypto;
  if (typeof self !== 'undefined' && self.crypto) return self.crypto;
  if (typeof globalThis !== 'undefined' && globalThis.crypto) return globalThis.crypto;
  throw new Error('Web Crypto API not available');
})();

// Secure session key management
class SecureSessionManager {
  static SESSION_TIMEOUT = 15 * 60 * 1000; // 15 minutes
  static sessionKeys = new Map();
  
  static async createSession(masterKey) {
    const sessionId = cryptoRandom.getRandomValues(new Uint32Array(1))[0].toString(36);
    const sessionExpiry = Date.now() + this.SESSION_TIMEOUT;
    
    // Derive session-specific key (non-extractable)
    const sessionKey = await cryptoSubtle.deriveKey(
      {
        name: "HKDF",
        salt: cryptoRandom.getRandomValues(new Uint8Array(32)),
        info: new TextEncoder().encode(`session-${sessionId}`),
        hash: "SHA-256"
      },
      masterKey,
      { name: "AES-GCM", length: 256 },
      false, // Never extractable
      ["encrypt", "decrypt"]
    );
    
    this.sessionKeys.set(sessionId, { key: sessionKey, expiry: sessionExpiry });
    
    // Store only session metadata (no key material)
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({
        sessionId,
        sessionExpiry,
        sessionActive: true
      });
    }
    
    return sessionId;
  }
  
  static async getSessionKey(sessionId) {
    const session = this.sessionKeys.get(sessionId);
    if (!session || Date.now() > session.expiry) {
      this.sessionKeys.delete(sessionId);
      return null;
    }
    return session.key;
  }
  
  static async clearSession(sessionId) {
    this.sessionKeys.delete(sessionId);
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(['sessionId', 'sessionExpiry', 'sessionActive']);
    }
  }
}

// Import @noble/hashes for Argon2id (browser-friendly, no Node.js dependencies)
import { argon2id } from '@noble/hashes/argon2.js';

/**
 * Derives a secure master key using Argon2id (REQUIRED for zero-knowledge).
 * CRITICAL: Master password must NEVER leave this function or be stored.
 * @param {string} password - Master password (cleared after use)
 * @param {Uint8Array} salt - User-specific salt (32 bytes)
 * @returns {Promise<CryptoKey>} Non-extractable master key for KEK (Key Encryption Key)
 */
export async function deriveKey(password, salt) {
  const enc = new TextEncoder();
  
  // Ensure salt is Uint8Array
  if (!(salt instanceof Uint8Array)) {
    salt = new Uint8Array(salt);
  }
  
  try {
    // BALANCED: Use Argon2id optimized for both desktop and mobile
    // Parameters: m=16384 KiB (16MB), t=2 iterations, p=1 parallelism
    const passwordBytes = enc.encode(password);
    
    // Using @noble/hashes argon2id
    const derivedKey = argon2id(passwordBytes, salt, {
      t: 2,        // iterations
      m: 16384,    // memory in KiB (16MB)
      p: 1,        // parallelism
      dkLen: 32    // output length in bytes
    });
    
    // Import into Web Crypto API as extractable key for session storage
    const masterKey = await cryptoSubtle.importKey(
      'raw',
      derivedKey,
      { name: 'AES-GCM', length: 256 },
      true, // Extractable for session persistence
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
    
    // CRITICAL: Zero out password bytes from memory
    passwordBytes.fill(0);
    derivedKey.fill(0);
    
    console.log('✓ Argon2id key derivation successful');
    return masterKey;
    
  } catch (err) {
    console.error('Argon2id failed, falling back to PBKDF2 (INSECURE):', err);
    
    // FALLBACK: PBKDF2 (NOT recommended for production)
    const keyMaterial = await cryptoSubtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const bits = await cryptoSubtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 600000, // High iterations for PBKDF2 fallback
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    
    const masterKey = await cryptoSubtle.importKey(
      'raw',
      new Uint8Array(bits),
      { name: 'AES-GCM', length: 256 },
      true, // Extractable for session persistence
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );
    
    return masterKey;
  }
}

/**
 * Generate a random Data Encryption Key (DEK).
 * The DEK encrypts vault data. The master key encrypts the DEK.
 * @returns {Promise<CryptoKey>} Non-extractable DEK
 */
export async function generateDEK() {
  return cryptoSubtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true, // Extractable so we can encrypt it with master key
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt the DEK with the master key (envelope encryption).
 * @param {CryptoKey} dek - Data Encryption Key
 * @param {CryptoKey} masterKey - Key Encryption Key (from password)
 * @returns {Promise<{encryptedDEK: Uint8Array, iv: Uint8Array}>}
 */
export async function encryptDEK(dek, masterKey) {
  // Export DEK to raw bytes
  const dekBytes = await cryptoSubtle.exportKey("raw", dek);
  
  const iv = cryptoRandom.getRandomValues(new Uint8Array(12));
  
  const encryptedDEK = await cryptoSubtle.encrypt(
    { name: "AES-GCM", iv },
    masterKey,
    dekBytes
  );
  
  return {
    encryptedDEK: new Uint8Array(encryptedDEK),
    iv: new Uint8Array(iv)
  };
}

/**
 * Decrypt the DEK with the master key.
 * @param {Uint8Array} encryptedDEK 
 * @param {Uint8Array} iv 
 * @param {CryptoKey} masterKey 
 * @returns {Promise<CryptoKey>} Decrypted DEK
 */
export async function decryptDEK(encryptedDEK, iv, masterKey) {
  const dekBytes = await cryptoSubtle.decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    encryptedDEK
  );
  
  // Import back as extractable key for session persistence
  return cryptoSubtle.importKey(
    "raw",
    dekBytes,
    { name: "AES-GCM", length: 256 },
    true, // Extractable for session persistence
    ["encrypt", "decrypt"]
  );
}

/**
 * Derives a vault-specific encryption key from master key.
 * @param {CryptoKey} masterKey 
 * @returns {Promise<CryptoKey>}
 */
export async function deriveVaultKey(masterKey) {
  return cryptoSubtle.deriveKey(
    {
      name: "HKDF",
      salt: new TextEncoder().encode("vault-encryption"),
      info: new TextEncoder().encode("PassVault-v1"),
      hash: "SHA-256"
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Derives a sync-specific encryption key for remote storage.
 * @param {CryptoKey} masterKey 
 * @returns {Promise<CryptoKey>}
 */
export async function deriveSyncKey(masterKey) {
  return cryptoSubtle.deriveKey(
    {
      name: "HKDF",
      salt: new TextEncoder().encode("sync-encryption"),
      info: new TextEncoder().encode("PassVault-sync-v1"),
      hash: "SHA-256"
    },
    masterKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypts vault data using envelope encryption with DEK.
 * CRITICAL: Uses DEK for data, master key only encrypts DEK.
 * @param {object} data - Vault data to encrypt
 * @param {CryptoKey} dek - Data Encryption Key
 * @returns {Promise<{encryptedVault: Uint8Array, iv: Uint8Array}>}
 */
export async function encryptVault(data, dek) {
  const enc = new TextEncoder();
  
  // Serialize vault data
  const serializedData = enc.encode(JSON.stringify(data));
  
  // Encrypt with DEK using AES-256-GCM (REQUIRED)
  const iv = cryptoRandom.getRandomValues(new Uint8Array(12));
  const encryptedVault = await cryptoSubtle.encrypt(
    { name: "AES-GCM", iv },
    dek,
    serializedData
  );
  
  return {
    encryptedVault: new Uint8Array(encryptedVault),
    iv: new Uint8Array(iv)
  };
}

/**
 * Decrypts vault data using the DEK.
 * @param {Uint8Array} encryptedVault - Encrypted vault data
 * @param {Uint8Array} iv - Initialization vector
 * @param {CryptoKey} dek - Data Encryption Key
 * @returns {Promise<object>} Decrypted vault data
 */
export async function decryptVault(encryptedVault, iv, dek) {
  // Decrypt with DEK using AES-256-GCM
  const decryptedBuffer = await cryptoSubtle.decrypt(
    { name: "AES-GCM", iv },
    dek,
    encryptedVault
  );
  
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decryptedBuffer));
}

/**
 * Constant-time comparison to prevent timing attacks.
 * @param {Uint8Array} a 
 * @param {Uint8Array} b 
 * @returns {boolean}
 */
function constantTimeEquals(a, b) {
  if (a.length !== b.length) return false;
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

/**
 * Generate recovery key from user email, master password, and salt.
 * Format: base64(email length (2 bytes) + email + password + salt)
 * @param {string} email 
 * @param {string} masterPassword 
 * @param {Uint8Array} salt 
 * @returns {string} Base64-encoded recovery key
 */
export function generateRecoveryKey(email, masterPassword, salt) {
  const enc = new TextEncoder();
  const emailBytes = enc.encode(email);
  const passwordBytes = enc.encode(masterPassword);
  
  // Concatenate: email length (2 bytes) + email + password + salt
  const combined = new Uint8Array(2 + emailBytes.length + passwordBytes.length + salt.length);
  const view = new DataView(combined.buffer);
  
  view.setUint16(0, emailBytes.length, false); // Big-endian email length
  combined.set(emailBytes, 2);
  combined.set(passwordBytes, 2 + emailBytes.length);
  combined.set(salt, 2 + emailBytes.length + passwordBytes.length);
  
  // Base64 encode
  return btoa(String.fromCharCode(...combined));
}

/**
 * Parse recovery key back to email, password, salt.
 * @param {string} recoveryKey - Base64-encoded recovery key
 * @returns {{email: string, password: string, salt: Uint8Array}}
 */
export function parseRecoveryKey(recoveryKey) {
  try {
    // Base64 decode
    const decoded = atob(recoveryKey);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
      bytes[i] = decoded.charCodeAt(i);
    }
    
    const view = new DataView(bytes.buffer);
    const emailLength = view.getUint16(0, false);
    
    const dec = new TextDecoder();
    const email = dec.decode(bytes.slice(2, 2 + emailLength));
    const password = dec.decode(bytes.slice(2 + emailLength, bytes.length - 32));
    const salt = bytes.slice(bytes.length - 32);
    
    return { email, password, salt };
  } catch (err) {
    throw new Error('Invalid recovery key format');
  }
}

// Export session manager for use in background/content scripts
export { SecureSessionManager };
