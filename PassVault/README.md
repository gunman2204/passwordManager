# PassVault 🔐

A **zero-knowledge password manager** Chrome extension with enterprise-grade security. Your passwords are encrypted on your device and the server never sees your master password or vault contents.

![PassVault](https://img.shields.io/badge/Security-Zero--Knowledge-brightgreen)
![Encryption](https://img.shields.io/badge/Encryption-AES--256--GCM-blue)
![Key Derivation](https://img.shields.io/badge/KDF-Argon2id-orange)

---

## 🌟 Features

- ✅ **Zero-Knowledge Architecture** - Server cannot decrypt your passwords
- ✅ **Argon2id Key Derivation** - GPU-resistant, memory-hard password hashing
- ✅ **AES-256-GCM Encryption** - Military-grade encryption for all data
- ✅ **Envelope Encryption** - Separate keys for vault and data encryption
- ✅ **Recovery Key System** - MetaMask-style recovery phrase (downloadable)
- ✅ **Session Persistence** - Vault stays unlocked across popup reopens
- ✅ **IndexedDB Storage** - Secure local storage for encrypted vault
- ✅ **Cloud Sync** - Encrypted vault syncs to backend (backend cannot decrypt)
- ✅ **Modern UI** - Professional gradient design optimized for 400px width

---

## 🔒 Security Model

### Three-Layer Encryption

```
User Password (never stored)
    ↓ [Argon2id + Salt]
Master Key (non-extractable)
    ↓ [Encrypts DEK]
Data Encryption Key (DEK)
    ↓ [Encrypts Vault]
Encrypted Vault → IndexedDB + Backend
```

### Key Concepts

| Concept | Description | Stored Where? |
|---------|-------------|---------------|
| **Account Password** | Backend authentication | Server (hashed) |
| **Master Password** | Vault encryption (NEVER sent to server) | Nowhere (user's memory) |
| **Recovery Key** | Base64(masterPassword\|email) | Downloaded .txt file |
| **Salt** | Random 32 bytes for key derivation | IndexedDB (public) |
| **Master Key** | Derived from password via Argon2id | Memory only (non-extractable) |
| **DEK** | Data Encryption Key | IndexedDB (encrypted with master key) |
| **Encrypted Vault** | Your passwords | IndexedDB + Backend (encrypted) |

---

## 🚀 Quick Start

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd extension
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the extension**
   ```bash
   npm run build
   ```

4. **Load in Chrome**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Development Mode

```bash
npm run dev
```
The extension will hot-reload on file changes.

---

## 📖 User Guide

### 1. Registration

1. Open the extension
2. Click **"Register"** tab
3. Enter:
   - **Email** - Your account identifier
   - **Account Password** - For backend authentication
   - **Master Password** - For vault encryption (NEVER sent to server)
   - **Device Name** - Identifier for this device

4. Click **"Create Account"**
5. **Download Recovery Key** - Save the `.txt` file securely
6. ⚠️ **Important**: If you lose both master password AND recovery key, your vault is **permanently inaccessible**

### 2. Unlocking Your Vault

**Option A: Master Password**
1. Enter your master password
2. Click "Unlock Vault"

**Option B: Recovery Key**
1. Click "Recovery Key" tab
2. Paste recovery key OR upload the `.txt` file
3. Click "Unlock Vault"

### 3. Managing Passwords

- **Add Password**: Click the `+` button (bottom right)
- **Copy Password**: Click the copy icon on any password
- **Lock Vault**: Click account menu → "Lock Vault"
- **Logout**: Click account menu → "Logout"

---

## 🏗️ Technical Architecture

### Technology Stack

- **Frontend**: React 19 + Vite 5
- **Styling**: TailwindCSS
- **Extension API**: Chrome Extension Manifest V3 (CRXJS)
- **Encryption**: Web Crypto API
- **Key Derivation**: @noble/hashes (Argon2id)
- **Storage**: IndexedDB (local), chrome.storage.session (keys)

### File Structure

```
extension/
├── src/
│   ├── components/
│   │   ├── Login.jsx         # Registration + recovery key generation
│   │   ├── Unlock.jsx        # Vault unlock (password/recovery key)
│   │   └── Vault.jsx         # Password management UI
│   ├── utils/
│   │   ├── db.js             # IndexedDB wrapper
│   │   ├── storage.js        # Session key persistence
│   │   └── api.js            # Backend API calls
│   ├── background/
│   │   └── index.js          # Service worker
│   └── App.jsx               # Main application logic
├── vault/
│   ├── crypto.js             # Encryption/decryption functions
│   └── sync.js               # Backend sync logic
├── vite.config.js            # Build configuration
└── manifest.json             # Chrome extension manifest
```

### Core Cryptographic Functions

#### 1. Key Derivation (`vault/crypto.js`)

```javascript
export async function deriveKey(password, salt) {
  // Argon2id parameters (OWASP recommended)
  const derivedKey = argon2id(passwordBytes, salt, {
    t: 3,        // 3 iterations
    m: 65536,    // 64 MB memory
    p: 4,        // 4 parallel threads
    dkLen: 32    // 32-byte output
  });
  
  // Import as non-extractable CryptoKey
  return crypto.subtle.importKey(
    'raw', derivedKey,
    { name: 'AES-GCM', length: 256 },
    false,  // CRITICAL: non-extractable
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
  );
}
```

#### 2. Envelope Encryption

```javascript
// Generate random DEK
const dek = await generateDEK();

// Encrypt DEK with master key
const { encryptedDEK, iv } = await encryptDEK(dek, masterKey);

// Encrypt vault with DEK
const { encryptedVault, vaultIV } = await encryptVault(items, dek);

// Store: encryptedDEK (local), encryptedVault (local + backend)
```

#### 3. Session Persistence

```javascript
// Keys persist across popup reopens, cleared when Chrome closes
await chrome.storage.session.set({
  masterKey: Array.from(masterKeyBytes),
  dek: Array.from(dekBytes)
});
```

---

## 🔐 Security Features

### Zero-Knowledge Guarantee

1. ✅ Master password **never transmitted** to server
2. ✅ Server receives **only encrypted vault** (cannot decrypt)
3. ✅ Master key is **non-extractable** (cannot be exported)
4. ✅ DEK is **encrypted before storage** (protected by master key)
5. ✅ Recovery key stored **offline** (user downloads file)

### Attack Resistance

| Attack Type | Protection |
|-------------|------------|
| **Brute Force** | Argon2id (64MB memory, 3 iterations) |
| **GPU Attacks** | Memory-hard Argon2id algorithm |
| **Rainbow Tables** | Unique salt per user (32 bytes) |
| **Timing Attacks** | Constant-time comparison for verification |
| **Server Breach** | Encrypted vault (server cannot decrypt) |
| **Man-in-the-Middle** | Master password never transmitted |

### Encryption Specifications

- **Algorithm**: AES-256-GCM (Authenticated Encryption)
- **IV Size**: 96 bits (12 bytes) - randomly generated
- **Key Size**: 256 bits (32 bytes)
- **Salt Size**: 256 bits (32 bytes) - randomly generated
- **KDF**: Argon2id (type 2, m=64MB, t=3, p=4)

---

## 📦 Storage Architecture

### IndexedDB Schema

```javascript
{
  // Public (not encrypted)
  salt: Uint8Array(32),           // For key derivation
  version: Number,                // Vault version counter
  
  // Encrypted with Master Key
  encryptedDEK: Uint8Array,       // Encrypted Data Encryption Key
  dekIV: Uint8Array(12),          // IV for DEK encryption
  
  // Encrypted with DEK
  encryptedVault: Uint8Array,     // Encrypted password vault
  vaultIV: Uint8Array(12)         // IV for vault encryption
}
```

### Session Storage (chrome.storage.session)

```javascript
{
  masterKey: Array,  // Restored on popup reopen
  dek: Array         // Cleared when Chrome closes
}
```

---

## 🔄 Sync Flow

1. **Encrypt locally**: Vault encrypted with DEK on device
2. **Upload encrypted blob**: Backend receives `{ encryptedVault, vaultIV, version }`
3. **Backend stores**: Encrypted data + version number
4. **Sync on other devices**: Download encrypted vault → decrypt with local master key

**Backend NEVER sees**:
- Master password
- Decrypted vault contents
- DEK (stays on device only)

---

## 🛠️ Development

### Build Commands

```bash
npm run dev      # Development mode with HMR
npm run build    # Production build
npm run preview  # Preview production build
```

### Environment Variables

Create `.env` file:
```env
VITE_API_URL=http://localhost:3000/api
```

### Testing

The extension can be tested in:
- Chrome (recommended)
- Edge (Chromium-based)
- Brave (Chromium-based)

---

## 🚨 Security Warnings

### ⚠️ CRITICAL

1. **Backup Recovery Key**: Store it offline (USB drive, paper, password manager)
2. **Master Password Lost**: If both master password AND recovery key are lost, vault is **permanently inaccessible**
3. **Recovery Key Exposure**: Anyone with recovery key can decrypt vault
4. **Phishing Protection**: Never enter master password on untrusted sites

### Best Practices

- ✅ Use a strong, unique master password (16+ characters)
- ✅ Store recovery key in multiple secure locations
- ✅ Never share master password or recovery key
- ✅ Lock vault when stepping away (click account menu → Lock)
- ✅ Logout on shared computers (click account menu → Logout)

---

## 📋 Roadmap

- [ ] Biometric unlock (WebAuthn)
- [ ] Password generator
- [ ] Password strength meter
- [ ] Auto-fill for websites
- [ ] Import from other password managers
- [ ] 2FA/TOTP support
- [ ] Secure notes
- [ ] Folder organization
- [ ] Password sharing (encrypted)

---

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

## 🙏 Acknowledgments

- [@noble/hashes](https://github.com/paulmillr/noble-hashes) - Browser-friendly cryptography
- [CRXJS](https://crxjs.dev/) - Chrome extension development with Vite
- [TailwindCSS](https://tailwindcss.com/) - Utility-first CSS framework

---

## 📞 Support

For issues, questions, or security concerns:
- Open an issue on GitHub
- Email: security@passvault.example.com

**Security Vulnerabilities**: Please report privately via email.

---

**Built with ❤️ for secure password management**
