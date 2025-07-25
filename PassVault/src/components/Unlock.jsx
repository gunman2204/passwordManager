import { useState } from 'react';

export default function Unlock({ email, onUnlock, onLogout }) {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);
  const [recoveryKeyInput, setRecoveryKeyInput] = useState('');

  const handleUnlock = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      let masterPassword = password;
      let saltToUse = null;
      
      // If using recovery key, decode it
      if (useRecoveryKey) {
        try {
          const { parseRecoveryKey } = await import('../../vault/crypto');
          const parsed = parseRecoveryKey(recoveryKeyInput.trim());
          
          if (parsed.email !== email) {
            throw new Error('Recovery key doesn\'t match this account');
          }
          
          masterPassword = parsed.password;
          saltToUse = parsed.salt;
        } catch (decodeError) {
          throw new Error('Invalid recovery key format');
        }
      }
      
      // CRITICAL: Get salt from IndexedDB (stored during registration)
      const { vaultDB } = await import('../utils/db');
      let saltArray = saltToUse || await vaultDB.getSalt();
      let vaultData = await vaultDB.getVault();
      
      // If no local data, try to pull from server
      if (!saltArray || !vaultData) {
        try {
          const { getAuthToken } = await import('../utils/storage');
          const { pullFromRemote } = await import('../../vault/sync');
          const token = await getAuthToken();
          
          if (token) {
            const pullResult = await pullFromRemote(token);
            if (pullResult.success && pullResult.blob) {
              // Parse the blob if it's a string
              const blobData = typeof pullResult.blob === 'string' 
                ? JSON.parse(pullResult.blob)
                : pullResult.blob;
              
              // Store vault data locally
              vaultData = {
                encryptedVault: blobData.encryptedVault,
                vaultIV: blobData.vaultIV,
                encryptedDEK: blobData.encryptedDEK,
                dekIV: blobData.dekIV,
                salt: blobData.salt,
                version: pullResult.version
              };
              
              await vaultDB.setVault(vaultData);
              
              if (blobData.salt) {
                saltArray = blobData.salt;
                await vaultDB.setSalt(saltArray);
              }
            }
          }
        } catch (pullErr) {
          console.error('Failed to pull vault from server:', pullErr);
        }
      }
      
      if (!saltArray) {
        throw new Error('No vault found. Please register first or sync from another device.');
      }
      
      const salt = new Uint8Array(saltArray);
      
      // CRITICAL: Derive master key from password (NEVER stored)
      const { deriveKey, decryptDEK } = await import('../../vault/crypto');
      const masterKey = await deriveKey(masterPassword, salt);
      
      // CRITICAL: Decrypt the DEK with master key (envelope encryption)
      if (!vaultData || !vaultData.encryptedDEK) {
        throw new Error('Vault not initialized');
      }
      
      const encryptedDEK = new Uint8Array(vaultData.encryptedDEK);
      const dekIV = new Uint8Array(vaultData.dekIV);
      
      // This will throw if password is incorrect
      const dek = await decryptDEK(encryptedDEK, dekIV, masterKey);
      
      // CRITICAL: Clear password from memory immediately
      setPassword('');
      setRecoveryKeyInput('');
      
      // Pass both masterKey (for re-encrypting DEK if needed) and DEK to vault
      onUnlock({ masterKey, dek });
      
    } catch (err) {
      console.error('Unlock error:', err);
      setError(err.message || 'Invalid password or vault corrupted');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setRecoveryKeyInput(event.target.result);
        setUseRecoveryKey(true);
      };
      reader.readAsText(file);
    }
  };

  const handleReload = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.reload) {
      chrome.runtime.reload();
    } else {
      window.location.reload();
    }
  };

  return (
    <div className="w-full min-h-[500px] bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center p-4">
      <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 py-4 text-center">
          <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mx-auto mb-2">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-white">Unlock Vault</h2>
          <p className="text-indigo-100 text-xs truncate mt-1">{email}</p>
        </div>

        {/* Form */}
        <div className="p-4">
          {/* Toggle Buttons */}
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => setUseRecoveryKey(false)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${!useRecoveryKey ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Password
            </button>
            <button
              onClick={() => setUseRecoveryKey(true)}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-colors ${useRecoveryKey ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              Recovery Key
            </button>
          </div>

          <form onSubmit={handleUnlock} className="space-y-3">
            {!useRecoveryKey ? (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Master Password
                </label>
                <input
                  type="password"
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  placeholder="Enter master password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  required
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Recovery Key
                </label>
                <textarea
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-xs font-mono h-20 resize-none"
                  placeholder="Paste your recovery key here..."
                  value={recoveryKeyInput}
                  onChange={(e) => setRecoveryKeyInput(e.target.value)}
                  required
                />
                <div className="mt-2">
                  <label className="w-full cursor-pointer">
                    <input
                      type="file"
                      accept=".txt"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <div className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2 px-3 rounded-lg transition-colors text-xs flex items-center justify-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      Or Upload Recovery Key File
                    </div>
                  </label>
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-xs">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (!password.trim() && !recoveryKeyInput.trim())}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Unlocking...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                  Unlock Vault
                </>
              )}
            </button>
          </form>

          <div className="mt-3 pt-3 border-t border-slate-100 flex justify-between items-center">
            <button 
              onClick={handleReload}
              className="text-xs text-slate-400 hover:text-slate-600 transition-colors flex items-center gap-1"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Reload
            </button>
            {onLogout && (
              <button 
                onClick={onLogout}
                className="text-xs text-red-500 hover:text-red-700 transition-colors flex items-center gap-1 font-medium"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
