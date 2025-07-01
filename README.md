# PassVault Monorepo

A zero-knowledge password manager system featuring a Chrome extension, a React Native mobile application, and a secure Express.js backend. User passwords are encrypted locally on the device, and the server never sees the master password or the decrypted vault contents.

## Table of Contents
- [Features](#features)
- [Monorepo Structure](#monorepo-structure)
- [Technology Stack](#technology-stack)
- [Architecture](#architecture)
- [Encryption Logic](#encryption-logic)
- [Installation and Usage](#installation-and-usage)
  - [Docker Quick Start (Backend & Local Setup)](#docker-quick-start-backend--local-setup)
  - [Chrome Extension Setup](#chrome-extension-setup)
  - [Mobile Application Setup](#mobile-application-setup)
- [Security Warnings](#security-warnings)

---

## Features

- **Zero-Knowledge Architecture:** The server cannot decrypt user passwords.
- **Argon2id Key Derivation:** GPU-resistant, memory-hard password hashing.
- **AES-256-GCM Encryption:** Military-grade authenticated encryption for all data.
- **Envelope Encryption:** Separate keys for vault decryption and data encryption.
- **Cross-Platform:** Includes both a Chrome extension and a React Native mobile application.
- **Cloud Sync:** Encrypted vaults sync securely to the backend.
- **Docker Support:** Fully containerized backend and database development environment.

---

## Monorepo Structure

This project is organized as a monorepo containing three main components:

| Component | Description |
|-----------|-------------|
| `PassVault/` | The browser extension frontend. |
| `PassVault-backend/` | The API server handling synchronization and authentication. |
| `PassVault-mobile/` | The React Native mobile application. |

---

## Technology Stack

- **Frontend (Extension):** React 19, Vite, CRXJS (Manifest V3), TailwindCSS
- **Mobile Application:** React Native, Expo
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Cryptography:** Web Crypto API, `@noble/hashes` (Argon2id)

---

## Architecture

PassVault operates on a zero-knowledge architecture. All encryption and decryption processes happen entirely on the client side (within the Chrome extension or the mobile app). 

When a user modifies their vault, the data is encrypted locally and then synchronized to the backend. The backend acts solely as a persistent storage layer for encrypted binary blobs and handles user authentication via a separate account password. The backend has no capability to decrypt the stored vaults.

---

## Encryption Logic

PassVault utilizes a three-layer encryption model, known as Envelope Encryption, to ensure maximum security.

### 1. Key Derivation
The user's master password is combined with a randomly generated 32-byte salt. Using the Argon2id key derivation function, this produces a cryptographic Master Key. This Master Key is loaded into memory as a non-extractable key.

### 2. Envelope Encryption
Instead of encrypting the vault directly with the Master Key, a separate Data Encryption Key (DEK) is randomly generated. The DEK is responsible for encrypting the actual vault contents using AES-256-GCM. 
The DEK itself is then encrypted by the Master Key. 

### 3. Storage and Sync
The encrypted vault and the encrypted DEK are stored locally (using IndexedDB in the browser or SecureStorage on mobile). During a sync operation, only the encrypted vault is transmitted to the server.

**Data Flow Summary:**
1. User Password + Salt -> Argon2id -> Master Key
2. Randomly generated -> Data Encryption Key (DEK)
3. Master Key encrypts DEK.
4. DEK encrypts Vault.
5. Encrypted Vault syncs to the server.

---

## Installation and Usage

### Docker Quick Start (Backend & Local Setup)

The easiest way to run the backend API and the required PostgreSQL database is via Docker.

1. **Clone the repository:**
   ```bash
   git clone <repository-url>
   cd password_manager_extension
   ```

2. **Configure Environment Variables:**
   ```bash
   cp .env.example .env
   ```

3. **Start the backend and database services:**
   ```bash
   docker-compose up --build
   ```
   The API will now be running on `http://localhost:5000`.

### Chrome Extension Setup

To generate the extension and add it to Chrome, follow these steps:

1. **Navigate to the extension directory:**
   ```bash
   cd PassVault
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension for production:**
   ```bash
   npm run build
   ```
   This will generate a `dist` folder containing the compiled extension.

4. **Load the extension into Chrome:**
   - Open Google Chrome and navigate to `chrome://extensions/`.
   - Enable **Developer mode** using the toggle in the top right corner.
   - Click the **Load unpacked** button.
   - Select the newly generated `dist` folder located inside the `PassVault` directory.
   - The extension is now installed and ready to use.

*(Optional: For local development with hot-reloading, run `npm run dev` instead of `npm run build`.)*

### Mobile Application Setup

The mobile application is built using React Native and Expo. Ensure you have the backend running locally before starting the mobile app.

1. **Navigate to the mobile directory:**
   ```bash
   cd PassVault-mobile
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the Expo development server:**
   ```bash
   npx expo start
   ```

4. **Run the application:**
   - **On a physical device:** Download the "Expo Go" app on your iOS or Android device and scan the QR code displayed in your terminal.
   - **On a simulator:** Press `i` to open in the iOS Simulator or `a` to open in the Android Emulator.

---

## Security Warnings

- **Backup Recovery Key:** Always store the recovery key securely offline (e.g., printed on paper or stored on an encrypted USB drive).
- **Master Password Loss:** If both the master password and the recovery key are lost, the vault becomes permanently inaccessible. The server cannot restore access.
- **Phishing Protection:** Verify the environment before entering your master password. Never enter it on untrusted websites or applications.

---

## License

This project is licensed under the MIT License.
