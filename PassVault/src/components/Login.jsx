import { useState } from 'react';
import { api } from '../utils/api';
import { setAuthToken, setUserEmail } from '../utils/storage';

export default function Login({ onLoginSuccess }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState(''); // Backend auth password
  const [masterPassword, setMasterPassword] = useState(''); // Vault encryption password (NEVER sent to server)
  const [deviceName, setDeviceName] = useState('My Browser Extension');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showRecoveryKey, setShowRecoveryKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');
  const [recoveryKeyDownloaded, setRecoveryKeyDownloaded] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // CRITICAL: Validate master password only for registration
      if (isRegistering) {
        if (masterPassword.length < 12) {
          throw new Error('Master password must be at least 12 characters for security');
        }
        if (accountPassword.length < 8) {
          throw new Error('Account password must be at least 8 characters');
        }
      }

      let data;
      if (isRegistering) {
          // Register: Send account password to backend, keep master password client-side
          data = await api.register(email, accountPassword, deviceName);
          
          // CRITICAL: Generate and store salt locally for master password derivation
          const salt = window.crypto.getRandomValues(new Uint8Array(32));
          const { vaultDB } = await import('../utils/db');
          await vaultDB.setSalt(salt);
          
          // CRITICAL: Derive master key from master password (NEVER sent to server)
          const { deriveKey, generateDEK, encryptDEK } = await import('../../vault/crypto');
          const masterKey = await deriveKey(masterPassword, salt);
          
          // Generate initial DEK and encrypt it with master key
          const dek = await generateDEK();
          const { encryptedDEK, iv: dekIV } = await encryptDEK(dek, masterKey);
          
          // Store encrypted DEK and salt in IndexedDB
          await vaultDB.setVault({
            encryptedVault: new Uint8Array(0), // Empty vault initially
            vaultIV: new Uint8Array(12),
            encryptedDEK: Array.from(encryptedDEK),
            dekIV: Array.from(dekIV),
            salt: Array.from(salt),
            version: 1
          });
          
          // Generate recovery key (includes email, password, and salt for cross-device recovery)
          const { generateRecoveryKey } = await import('../../vault/crypto');
          const recoveryKeyText = generateRecoveryKey(email, masterPassword, salt);
          setRecoveryKey(recoveryKeyText);
          
          // Sync initial vault to backend (critical for cross-device sync)
          try {
            const { pushToRemote } = await import('../../vault/sync');
            const encryptedBlob = {
              encryptedVault: [],
              vaultIV: Array.from(new Uint8Array(12)),
              encryptedDEK: Array.from(encryptedDEK),
              dekIV: Array.from(dekIV),
              salt: Array.from(salt)
            };
            await pushToRemote(encryptedBlob, 1, data.token);
          } catch (syncErr) {
            console.error('Failed to sync initial vault:', syncErr);
          }
          
          // Show recovery key download screen
          await setAuthToken(data.token);
          await setUserEmail(email);
          setShowRecoveryKey(true);
          
          // CRITICAL: Wipe master password from memory
          setMasterPassword('');
          setLoading(false);
          return; // Don't proceed until recovery key is downloaded
      } else {
          // Login: Only send account password
          data = await api.login(email, accountPassword, deviceName);
          await setAuthToken(data.token);
          await setUserEmail(email);
          onLoginSuccess(data.token);
      }

    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadRecoveryKey = () => {
    const element = document.createElement('a');
    const file = new Blob([recoveryKey], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);
    element.download = `passvault-recovery-${email.split('@')[0]}.txt`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    setRecoveryKeyDownloaded(true);
  };

  const copyRecoveryKey = () => {
    navigator.clipboard.writeText(recoveryKey);
    alert('Recovery key copied to clipboard!');
  };

  const completeRegistration = () => {
    if (!recoveryKeyDownloaded) {
      alert('Please download your recovery key first!');
      return;
    }
    onLoginSuccess(null); // Will trigger token check and proceed
  };

  // Recovery Key Download Screen
  if (showRecoveryKey) {
    return (
      <div className="w-full h-full bg-white flex flex-col p-4">
        <div className="text-center mb-4">
          <div className="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-slate-800">Save Your Recovery Key</h2>
          <p className="text-xs text-slate-600 mt-1">This is your only way to recover access if you forget your password!</p>
        </div>

        <div className="bg-yellow-50 border-2 border-yellow-400 rounded-lg p-3 mb-4">
          <p className="text-xs font-bold text-yellow-900 mb-2">⚠️ CRITICAL - READ CAREFULLY:</p>
          <ul className="text-xs text-yellow-800 space-y-1 list-disc list-inside">
            <li>Download this recovery key NOW</li>
            <li>Store it in a safe place (password manager, secure note)</li>
            <li>NEVER share it with anyone</li>
            <li>You CANNOT recover your vault without it</li>
          </ul>
        </div>

        <div className="bg-slate-100 rounded-lg p-3 mb-4 break-all font-mono text-xs text-slate-700 max-h-20 overflow-y-auto">
          {recoveryKey}
        </div>

        <div className="space-y-2">
          <button
            onClick={downloadRecoveryKey}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {recoveryKeyDownloaded ? '✓ Downloaded' : 'Download Recovery Key'}
          </button>

          <button
            onClick={copyRecoveryKey}
            className="w-full bg-slate-600 hover:bg-slate-700 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            Copy to Clipboard
          </button>

          <button
            onClick={completeRegistration}
            disabled={!recoveryKeyDownloaded}
            className="w-full bg-green-600 hover:bg-green-700 disabled:bg-slate-300 text-white font-semibold py-2.5 px-4 rounded-lg transition-colors disabled:cursor-not-allowed"
          >
            I've Saved It - Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-125 bg-linear-to-br from-slate-50 to-indigo-50 flex flex-col p-4 overflow-y-auto">
      {/* Header */}
      <div className="mb-4 text-center">
        <div className="w-12 h-12 bg-linear-to-r from-indigo-600 to-purple-600 rounded-xl flex items-center justify-center mx-auto mb-2 shadow-lg">
          <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-slate-800">PassVault</h1>
        <p className="text-xs text-slate-500 mt-1">Zero-knowledge password manager</p>
      </div>

      <div className="w-full bg-white rounded-xl shadow-lg border border-slate-200 p-4 flex-1">"
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setIsRegistering(false)}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${!isRegistering ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Sign In
          </button>
          <button
            onClick={() => setIsRegistering(true)}
            className={`flex-1 py-2 px-3 rounded-lg font-medium text-sm transition-colors ${isRegistering ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            Register
          </button>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 text-sm p-3 rounded-lg mb-4 border border-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Account Password</label>
            <input
              type="password"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
              placeholder="Account password"
              value={accountPassword}
              onChange={(e) => setAccountPassword(e.target.value)}
              required
            />
            <p className="text-xs text-slate-500 mt-1">For backend authentication</p>
          </div>

          {isRegistering && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Master Password (Vault Encryption)</label>
              <input
                type="password"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                placeholder="Strong master password"
                value={masterPassword}
                onChange={(e) => setMasterPassword(e.target.value)}
                required={isRegistering}
              />
              <p className="text-xs text-red-600 mt-1 font-medium">
                ⚠️ You'll get a recovery key to download!
              </p>
            </div>
          )}

          {isRegistering && (
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Device Name</label>
              <div className="relative">
                <svg className="w-5 h-5 text-slate-400 absolute left-3 top-1/2 transform -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
                <input
                  type="text"
                  className="w-full pl-10 pr-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all duration-200 bg-white/70 backdrop-blur-sm"
                  placeholder="My Browser Extension"
                  value={deviceName}
                  onChange={(e) => setDeviceName(e.target.value)}
                  required
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 disabled:from-slate-400 disabled:to-slate-400 text-white font-semibold py-3 px-4 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 shadow-lg disabled:cursor-not-allowed transform hover:scale-[1.02] disabled:transform-none mt-6"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                {isRegistering ? 'Creating Account...' : 'Signing In...'}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isRegistering ? "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" : "M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"} />
                </svg>
                {isRegistering ? 'Create Account' : 'Sign In'}
              </>
            )}
          </button>
        </form>

        <div className="mt-6 text-center">
          <button
            className="text-sm text-indigo-600 hover:text-indigo-700 font-medium transition-colors duration-200 hover:underline"
            onClick={() => setIsRegistering(!isRegistering)}
          >
            {isRegistering ? 'Already have an account? Sign In' : 'New here? Create Account'}
          </button>
        </div>
      </div>
      
      {/* Security Footer */}
      <div className="mt-4 text-center">
        <div className="flex items-center justify-center gap-2 text-xs text-slate-500">
          <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
          <span className="font-medium">Secured with zero-knowledge encryption</span>
        </div>
      </div>
    </div>
  );
}
