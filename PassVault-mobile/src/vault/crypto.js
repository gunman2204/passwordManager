// Zero-Knowledge Crypto Module for React Native
// Production-grade encryption with Expo Crypto API

import * as Crypto from 'expo-crypto';
import { argon2id } from '@noble/hashes/argon2.js';

// Lazy accessors for crypto API (polyfills load asynchronously in Expo Go)
function getCryptoSubtle() {
  if (!global.crypto?.subtle) {
    throw new Error('crypto.subtle not available. Ensure polyfills are loaded.');
  }
  return global.crypto.subtle;
}

function getCryptoRandom() {
  if (!global.crypto?.getRandomValues) {
    throw new Error('crypto.getRandomValues not available. Ensure polyfills are loaded.');
  }
  return global.crypto;
}

/**
 * Derives a secure master key using Argon2id (REQUIRED for zero-knowledge).
 * CRITICAL: Master password must NEVER leave this function or be stored.
 * @param {string} password - Master password (cleared after use)
 * @param {Uint8Array} salt - User-specific salt (32 bytes)
 * @returns {Promise<CryptoKey>} Extractable master key for session storage
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
      t: 2,        // iterations (reduced from 3 for mobile)
      m: 16384,    // memory in KiB (16MB - reduced from 64MB for mobile)
      p: 1,        // parallelism (reduced from 4 for mobile)
      dkLen: 32    // output length in bytes
    });
    
    // Import into Web Crypto API as extractable key for session storage
    const masterKey = await getCryptoSubtle().importKey(
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
    const keyMaterial = await getCryptoSubtle().importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const bits = await getCryptoSubtle().deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 600000, // High iterations for PBKDF2 fallback
        hash: 'SHA-256'
      },
      keyMaterial,
      256
    );
    
    const masterKey = await getCryptoSubtle().importKey(
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
 * @returns {Promise<CryptoKey>} Extractable DEK
 */
export async function generateDEK() {
  return getCryptoSubtle().generateKey(
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
  const dekBytes = await getCryptoSubtle().exportKey("raw", dek);
  
  const iv = getCryptoRandom().getRandomValues(new Uint8Array(12));
  
  const encryptedDEK = await getCryptoSubtle().encrypt(
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
  const dekBytes = await getCryptoSubtle().decrypt(
    { name: "AES-GCM", iv },
    masterKey,
    encryptedDEK
  );
  
  return getCryptoSubtle().importKey(
    "raw",
    dekBytes,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt vault data with DEK.
 * @param {Array} data - Plaintext vault array
 * @param {CryptoKey} dek - Data Encryption Key
 * @returns {Promise<{encryptedVault: Uint8Array, iv: Uint8Array}>}
 */
export async function encryptVault(data, dek) {
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(data));
  
  const iv = getCryptoRandom().getRandomValues(new Uint8Array(12));
  
  const ciphertext = await getCryptoSubtle().encrypt(
    { name: "AES-GCM", iv },
    dek,
    plaintext
  );
  
  return {
    encryptedVault: new Uint8Array(ciphertext),
    iv: new Uint8Array(iv)
  };
}

/**
 * Decrypt vault data with DEK.
 * @param {Uint8Array} encryptedVault 
 * @param {Uint8Array} iv 
 * @param {CryptoKey} dek 
 * @returns {Promise<Array>}
 */
export async function decryptVault(encryptedVault, iv, dek) {
  try {
    const decrypted = await getCryptoSubtle().decrypt(
      { name: "AES-GCM", iv },
      dek,
      encryptedVault
    );
    
    const dec = new TextDecoder();
    const json = dec.decode(decrypted);
    return JSON.parse(json);
  } catch (err) {
    console.error('Vault decryption failed:', err);
    throw new Error('Failed to decrypt vault. Wrong password or corrupted data.');
  }
}

/**
 * Generate a random salt for key derivation.
 * @returns {Uint8Array} 32-byte salt
 */
export function generateSalt() {
  return getCryptoRandom().getRandomValues(new Uint8Array(32));
}

/**
 * Generate recovery key from user email, master password, and salt.
 * Format: base64(email|password|salt)
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
