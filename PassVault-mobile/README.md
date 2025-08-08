# PassVault Mobile - React Native Expo App

Zero-knowledge password manager for Android and iOS with biometric unlock support.

## Features

- ✅ **Zero-Knowledge Encryption** - Master password never leaves your device
- ✅ **Argon2id Key Derivation** - GPU-resistant, memory-hard key derivation
- ✅ **AES-256-GCM Encryption** - Industry-standard authenticated encryption
- ✅ **Biometric Unlock** - Face ID / Touch ID support
- ✅ **Recovery Key System** - Downloadable recovery key for vault recovery
- ✅ **Cloud Sync** - Encrypted vault sync across devices
- ✅ **Manual Password Management** - Add, view, copy, delete credentials
- ✅ **Session Persistence** - Stay unlocked while app is active

## Architecture

Same crypto logic as browser extension:
- **Crypto Module** - Ported from `extension/vault/crypto.js` (100% intact)
- **Storage Layer** - React Native equivalents (AsyncStorage + SecureStore)
- **Sync Protocol** - Identical encrypted blob sync with backend
- **UI** - React Native components with similar UX flow

## Screens

1. **LoginScreen** - Dual-password registration (account + master) or login
2. **UnlockScreen** - Unlock with master password, recovery key, or biometrics
3. **VaultScreen** - Password list, add/delete, copy to clipboard

## Installation

```bash
cd e:/PRODIGY/PassVault/mobile

# Install dependencies (already done)
npm install

# Start development server
npx expo start

# Run on Android
npx expo run:android

# Run on iOS (macOS only)
npx expo run:ios
```

## Dependencies

**Core:**
- `expo` - Expo framework
- `react-native` - React Native core
- `@react-navigation/native` - Navigation
- `@react-navigation/stack` - Stack navigator

**Crypto (unchanged from extension):**
- `@noble/hashes` - Argon2id implementation
- `react-native-get-random-values` - Crypto polyfill

**Storage:**
- `@react-native-async-storage/async-storage` - Encrypted vault storage
- `expo-secure-store` - Secure storage for tokens/keys/salt

**Features:**
- `expo-crypto` - Crypto utilities
- `expo-local-authentication` - Biometric authentication
- `expo-file-system` - File operations
- `expo-sharing` - Share recovery key file
- `expo-document-picker` - Import recovery key
- `expo-clipboard` - Copy passwords
- `expo-linear-gradient` - UI gradients

## Storage Strategy

| Data | Storage | Reason |
|------|---------|--------|
| JWT Token | SecureStore | Sensitive auth token |
| User Email | AsyncStorage | Non-sensitive metadata |
| Salt | SecureStore | Critical for key derivation |
| Encrypted Vault | AsyncStorage | Already encrypted, large data |
| Session Keys (DEK/Master) | SecureStore + In-Memory | Extractable keys for session |
| Vault Version | AsyncStorage | Sync versioning |

## Security Model (Same as Extension)

1. **Registration Flow:**
   - User enters account password (backend auth) + master password (vault encryption)
   - Generate random 32-byte salt
   - Derive master key from master password + salt (Argon2id)
   - Generate DEK, encrypt with master key
   - Create empty encrypted vault
   - Generate recovery key (email + master password + salt → base64)
   - User downloads recovery key file
   - Sync to backend

2. **Login Flow:**
   - Backend authenticates with account password
   - Returns JWT token
   - User must unlock vault with master password

3. **Unlock Flow:**
   - Option 1: Master password → derive master key → decrypt DEK
   - Option 2: Recovery key → extract master password → unlock
   - Option 3: Biometric → then master password (biometrics unlock the password prompt, not the vault directly)
   - Store session keys in SecureStore + memory

4. **Sync Protocol:**
   - Encrypt vault with DEK → encrypted blob
   - Send encrypted blob + version to backend
   - Backend cannot decrypt (zero-knowledge)
   - Multi-device sync supported

## Differences from Browser Extension

**Removed:**
- ❌ Content script (auto-fill on web pages)
- ❌ Background service worker
- ❌ chrome.storage API
- ❌ IndexedDB
- ❌ Pending credentials from web forms

**Added:**
- ✅ Biometric authentication
- ✅ React Native navigation
- ✅ Native file sharing for recovery key
- ✅ Mobile-optimized UI

**Unchanged:**
- ✅ Crypto module (`vault/crypto.js`)
- ✅ Sync protocol (`vault/sync.js`)
- ✅ API client (`utils/api.js`)
- ✅ Zero-knowledge architecture
- ✅ Dual-password system
- ✅ Recovery key system
- ✅ Envelope encryption (DEK encrypted with master key)

## Development

### Run on Android Emulator
```bash
npx expo run:android
```

### Run on iOS Simulator (macOS only)
```bash
npx expo run:ios
```

### Run on Physical Device
1. Install Expo Go app from App Store / Play Store
2. Run `npx expo start`
3. Scan QR code with Expo Go app

## Backend

Ensure backend is running:
```bash
cd e:/PRODIGY/PassVault/backend
python app.py
```

Backend should be accessible at `http://localhost:5000`

For physical devices, update `API_BASE_URL` in `src/utils/api.js` to your computer's IP:
```javascript
const API_BASE_URL = 'http://192.168.x.x:5000/api';
```

## Building for Production

### Android (APK)
```bash
npx eas build --platform android --profile preview
```

### iOS (IPA)
```bash
npx eas build --platform ios --profile preview
```

## Future Enhancements (Not Implemented)

- [ ] Password generator
- [ ] Password strength indicator
- [ ] Search/filter credentials
- [ ] Categories/tags
- [ ] Import/export vault
- [ ] Native auto-fill (iOS Password AutoFill / Android Autofill Service)
- [ ] Offline mode with background sync
- [ ] Multi-factor authentication
- [ ] Secure notes
- [ ] Attachments

## License

Same as browser extension

## Notes

- **Crypto logic is 100% identical to browser extension** - Same Argon2id parameters, same AES-256-GCM, same envelope encryption
- **Encrypted blob format is identical** - Can sync vault between web extension and mobile app
- **Zero-knowledge guarantee preserved** - Master password never transmitted, backend cannot decrypt
- **Biometric unlock enhances UX** - But still requires master key derivation under the hood
