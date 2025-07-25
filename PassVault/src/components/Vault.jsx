import { useState, useEffect } from 'react';
import { useSync } from '../../vault/sync';
import { encryptVault, decryptVault } from '../../vault/crypto';

export default function Vault({ token, masterKey: keyPair, onLock, onLogout }) {
  // CRITICAL: keyPair contains { masterKey, dek } from unlock
  const { masterKey, dek } = keyPair;
  const { syncStatus, syncVault, pullFromRemote } = useSync(token);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', url: '', username: '', password: '', note: '' });
  const [pendingCredentials, setPendingCredentials] = useState([]);
  const [editingPendingId, setEditingPendingId] = useState(null);
  const [editedPendingUrl, setEditedPendingUrl] = useState('');

  // Initial Load & Decrypt
  useEffect(() => {
    const loadVault = async () => {
      try {
        // CRITICAL: Load from IndexedDB, not chrome.storage
        const { vaultDB } = await import('../utils/db');
        const vaultData = await vaultDB.getVault();
        
        if (vaultData && vaultData.encryptedVault && vaultData.encryptedVault.length > 0) {
          const encryptedVault = new Uint8Array(vaultData.encryptedVault);
          const vaultIV = new Uint8Array(vaultData.vaultIV);
          
          // CRITICAL: Decrypt with DEK (not master key)
          const decrypted = await decryptVault(encryptedVault, vaultIV, dek);
          setItems(Array.isArray(decrypted) ? decrypted : []);
        } else {
          // Empty vault
          setItems([]);
        }
        
        // Load pending credentials and decrypt passwords
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          try {
            const pending = await chrome.storage.local.get('pendingCredentials');
            const pendingList = pending.pendingCredentials || [];
            
            // Decrypt passwords that were encoded
            const decryptedPending = pendingList.map(cred => ({
              ...cred,
              password: cred._encrypted ? atob(cred.password) : cred.password
            }));
            
            setPendingCredentials(decryptedPending);
          } catch (e) {
            console.warn('Failed to load pending credentials (context invalidated?):', e);
          }
        }
      } catch (err) {
        console.error("Failed to decrypt vault:", err);
        setItems([]);
      } finally {
        setLoading(false);
      }
    };
    loadVault();
  }, [dek, syncStatus]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (showMenu && !e.target.closest('.relative')) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  // Listen for pending credentials from background script
  useEffect(() => {
    const handleMessage = (message) => {
      if (message.type === 'PENDING_CREDENTIAL_ADDED') {
        // Decrypt password if encoded
        const credential = {
          ...message.credential,
          password: message.credential._encrypted 
            ? atob(message.credential.password) 
            : message.credential.password
        };
        setPendingCredentials(prev => [...prev, credential]);
      } else if (message.type === 'CREDENTIAL_SAVED_TO_VAULT') {
        // Credential was saved directly, reload vault
        const reloadVault = async () => {
          try {
            const { vaultDB } = await import('../utils/db');
            const vaultData = await vaultDB.getVault();
            
            if (vaultData && vaultData.encryptedVault) {
              const encryptedVault = new Uint8Array(vaultData.encryptedVault);
              const vaultIV = new Uint8Array(vaultData.vaultIV);
              const decrypted = await decryptVault(encryptedVault, vaultIV, dek);
              setItems(Array.isArray(decrypted) ? decrypted : []);
            }
          } catch (err) {
            console.error('Failed to reload vault:', err);
          }
        };
        reloadVault();
      }
    };

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.onMessage.addListener(handleMessage);
      return () => {
        chrome.runtime.onMessage.removeListener(handleMessage);
      };
    }
  }, [dek]);

  const handleFullLogout = async () => {
    if (onLogout && typeof onLogout === 'function') {
      await onLogout();
    }
  };

  // Save vault helper
  const saveVault = async (updatedItems) => {
    try {
      const { vaultDB } = await import('../utils/db');
      
      // Encrypt vault data with DEK
      const { encryptedVault, iv: vaultIV } = await encryptVault(updatedItems, dek);
      
      // Get current vault data to preserve DEK encryption
      const currentVault = await vaultDB.getVault();
      
      // Create timestamp for this update
      const lastModified = new Date().toISOString();
      
      // Update vault with new encrypted data, keep encrypted DEK unchanged
      const updatedVault = {
        ...currentVault,
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV),
        lastModified
      };
      
      await vaultDB.setVault(updatedVault);
      
      // CRITICAL FIX: Send ALL vault data to backend for cross-device sync
      // Include encryptedDEK, dekIV, and salt so other devices can unlock
      const encryptedBlob = {
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV),
        encryptedDEK: Array.isArray(currentVault.encryptedDEK) ? currentVault.encryptedDEK : Array.from(currentVault.encryptedDEK || []),
        dekIV: Array.isArray(currentVault.dekIV) ? currentVault.dekIV : Array.from(currentVault.dekIV || []),
        salt: Array.isArray(currentVault.salt) ? currentVault.salt : Array.from(currentVault.salt || [])
      };
      
      const result = await syncVault(
        encryptedBlob,
        lastModified
      );
      
      if (!result.success) {
        alert('Sync failed: ' + (result.error || 'Unknown error'));
      } else if (result.action === 'pull_required') {
        // Server had newer data, need to reload
        alert('Server has newer data. Reloading vault...');
        window.location.reload();
      }
      
      return true;
    } catch (err) {
      console.error(err);
      alert('Encryption/storage failed: ' + err.message);
      return false;
    }
  };

  // Check if credential already exists (by URL + username)
  const findExistingCredential = (url, username) => {
    const normalizeURL = (u) => {
      try {
        const urlObj = new URL(u);
        return urlObj.hostname.toLowerCase().replace(/^www\./, '');
      } catch {
        return u.toLowerCase();
      }
    };
    
    const normalizedURL = normalizeURL(url);
    
    return items.find(item => {
      const itemURL = normalizeURL(item.url || item.name || '');
      return (itemURL === normalizedURL || item.name === url) && 
             item.username === username;
    });
  };

  const handleAddItem = async (e) => {
    e.preventDefault();
    
    // Check for duplicates
    const existing = findExistingCredential(newItem.url || newItem.name, newItem.username);
    
    let updatedItems;
    if (existing) {
      // Update existing credential
      updatedItems = items.map(item => 
        item.id === existing.id 
          ? { ...item, ...newItem, updatedAt: Date.now() }
          : item
      );
    } else {
      // Add new credential
      updatedItems = [...items, { 
        ...newItem, 
        id: crypto.randomUUID(), 
        createdAt: Date.now() 
      }];
    }
    
    setItems(updatedItems);
    setNewItem({ name: '', url: '', username: '', password: '', note: '' });
    setIsAdding(false);

    await saveVault(updatedItems);
  };

  const handleSavePendingCredential = async (credential) => {
    // Use edited URL if available
    const finalUrl = editingPendingId === credential.id && editedPendingUrl 
      ? editedPendingUrl 
      : credential.url;
    
    // Check if credential already exists
    const existing = findExistingCredential(finalUrl, credential.username);
    
    let updatedItems;
    if (existing) {
      // Update existing
      updatedItems = items.map(item =>
        item.id === existing.id
          ? { ...item, password: credential.password, updatedAt: Date.now() }
          : item
      );
    } else {
      // Add new
      updatedItems = [...items, {
        id: credential.id,
        name: credential.name,
        url: finalUrl,
        username: credential.username,
        password: credential.password,
        note: credential.note || '',
        createdAt: credential.timestamp
      }];
    }
    
    setItems(updatedItems);
    
    // Remove from pending
    const newPending = pendingCredentials.filter(p => p.id !== credential.id);
    setPendingCredentials(newPending);
    
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
             await chrome.storage.local.set({ pendingCredentials: newPending });
        }
    } catch (e) {
        console.warn('Failed to update pending credentials (context invalidated):', e);
    }
    
    // Reset editing state
    setEditingPendingId(null);
    setEditedPendingUrl('');
    
    await saveVault(updatedItems);
  };

  const handleDismissPendingCredential = async (credentialId) => {
    const newPending = pendingCredentials.filter(p => p.id !== credentialId);
    setPendingCredentials(newPending);
    try {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            await chrome.storage.local.set({ pendingCredentials: newPending });
        }
    } catch (e) {
        console.warn('Failed to dismiss pending credential (context invalidated):', e);
    }
  };

  const handleDeleteItem = async (itemId) => {
    if (!confirm('Are you sure you want to delete this credential?')) return;
    
    const updatedItems = items.filter(item => item.id !== itemId);
    setItems(updatedItems);
    await saveVault(updatedItems);
  };

  // Manual Sync Handler
  const handleManualSync = async () => {
    setLoading(true);
    try {
      const result = await pullFromRemote();
      if (result && result.updated && result.encryptedBlob) {
        // Decrypt and update local items
        const { encryptedVault, vaultIV } = result.encryptedBlob;
        if (encryptedVault && vaultIV) {
          const decrypted = await decryptVault(
            new Uint8Array(encryptedVault),
            new Uint8Array(vaultIV),
            dek
          );
          setItems(Array.isArray(decrypted) ? decrypted : []);
        }
      } else if (result && result.updated === false) {
        alert('Already up to date!');
      }
    } catch (err) {
      alert('Sync failed: ' + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  if (loading) return <div className="p-6 text-center text-slate-500">Decrypting Vault...</div>;

  return (
    <div className="bg-linear-to-br from-slate-50 to-indigo-50 w-full min-h-125 flex flex-col relative">
      {/* Header */}
      <header className="bg-linear-to-r from-indigo-600 to-purple-600 text-white p-3 shadow-lg flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="font-bold text-base">PassVault</h1>
        </div>
        <div className="flex items-center gap-2 relative">
            <span className="text-xs bg-white/20 px-2 py-1 rounded-lg font-medium">
                {syncStatus === 'syncing' ? (
                  <span className="flex items-center gap-1">
                    <svg className="animate-spin h-3 w-3" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Syncing
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Synced
                  </span>
                )}
            </span>
            <button
              onClick={handleManualSync}
              className="ml-2 px-2 py-1 bg-white/20 hover:bg-white/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-colors"
              title="Sync Now"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.635 19.364A9 9 0 104.582 9.582" />
              </svg>
              Sync
            </button>
            <div className="relative">
              <button 
                onClick={() => setShowMenu(!showMenu)}
                className="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg transition-all duration-200 flex items-center gap-1 text-xs font-semibold"
                title="Account Menu"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
                <svg className={`w-3 h-3 transition-transform ${showMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              
              {/* Dropdown Menu */}
              {showMenu && (
                <div className="absolute right-0 mt-2 w-40 bg-white rounded-lg shadow-xl border border-slate-200 py-1 z-50">
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      if (onLock) onLock();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-indigo-50 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                    Lock Vault
                  </button>
                  <hr className="my-1 border-slate-200" />
                  <button
                    onClick={() => {
                      setShowMenu(false);
                      handleFullLogout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2 transition-colors"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                    </svg>
                    Logout
                  </button>
                </div>
              )}
            </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 p-4 overflow-y-auto">
        {/* Pending Credentials Section */}
        {pendingCredentials.length > 0 && (
          <div className="mb-4 space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Passwords to Save ({pendingCredentials.length})
            </h3>
            {pendingCredentials.map((cred) => (
              <div key={cred.id} className="bg-linear-to-r from-yellow-50 to-orange-50 p-3.5 rounded-xl shadow-sm border border-yellow-200">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-slate-800 text-sm truncate">{cred.name}</h3>
                    <p className="text-xs text-slate-600 truncate">{cred.username}</p>
                    {editingPendingId === cred.id ? (
                      <input
                        type="url"
                        value={editedPendingUrl}
                        onChange={(e) => setEditedPendingUrl(e.target.value)}
                        className="mt-1 w-full px-2 py-1 text-xs border border-slate-300 rounded bg-white"
                        placeholder="Edit URL"
                        autoFocus
                      />
                    ) : (
                      <div className="flex items-center gap-1 mt-1">
                        <p className="text-xs text-slate-500 truncate flex-1">{cred.url}</p>
                        <button
                          onClick={() => {
                            setEditingPendingId(cred.id);
                            setEditedPendingUrl(cred.url);
                          }}
                          className="p-1 hover:bg-white/50 rounded transition-colors"
                          title="Edit URL"
                        >
                          <svg className="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => handleSavePendingCredential(cred)}
                    className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    {editingPendingId === cred.id ? 'Save with Edited URL' : 'Save to Vault'}
                  </button>
                  <button
                    onClick={() => handleDismissPendingCredential(cred.id)}
                    className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold rounded-lg transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Vault Items */}
        {items.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-linear-to-r from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
            </div>
            <p className="text-slate-400 font-medium">Your vault is empty</p>
            <p className="text-slate-400 text-xs mt-1">Click the + button to add your first password</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {items.map((item) => (
              <div key={item.id} className="bg-white p-3.5 rounded-xl shadow-sm border border-slate-200 hover:shadow-md hover:border-indigo-200 transition-all duration-200 group">
                <div className="flex justify-between items-start mb-2">
                    <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-slate-800 text-sm truncate">{item.name || item.title || 'Untitled'}</h3>
                        <p className="text-xs text-slate-500 truncate">{item.username}</p>
                        {item.url && <p className="text-xs text-slate-400 truncate mt-0.5">{item.url}</p>}
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(item.password);
                        }}
                        className="p-1.5 hover:bg-indigo-50 rounded-lg transition-colors shrink-0"
                        title="Copy password"
                      >
                        <svg className="w-4 h-4 text-slate-400 hover:text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="p-1.5 hover:bg-red-50 rounded-lg transition-colors shrink-0"
                        title="Delete"
                      >
                        <svg className="w-4 h-4 text-slate-400 hover:text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                </div>
                <div className="text-xs bg-slate-50 p-2 rounded-lg text-slate-600 font-mono break-all group-hover:bg-indigo-50 transition-colors">
                    {item.password}
                </div>
                {item.note && (
                  <div className="text-xs text-slate-500 mt-2 p-2 bg-slate-50 rounded-lg">
                    {item.note}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Floating Action Button */}
      <div className="absolute bottom-4 right-4">
        <button 
            onClick={() => setIsAdding(true)}
            className="bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white w-12 h-12 rounded-full shadow-lg hover:shadow-xl flex items-center justify-center transition-all duration-200 transform hover:scale-105 active:scale-95"
            title="Add new password"
        >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
        </button>
      </div>

      {/* Add Modal */}
      {isAdding && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-2xl animate-slide-up">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-slate-800">Add Password</h2>
              <button
                onClick={() => setIsAdding(false)}
                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <form onSubmit={handleAddItem} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Name / Title</label>
                <input
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  placeholder="e.g., Gmail, Facebook"
                  value={newItem.name}
                  onChange={e => setNewItem({...newItem, name: e.target.value})}
                  required
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Website URL</label>
                <input
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  placeholder="https://example.com"
                  type="url"
                  value={newItem.url}
                  onChange={e => setNewItem({...newItem, url: e.target.value})}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Username / Email</label>
                <input
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  placeholder="username@example.com"
                  value={newItem.username}
                  onChange={e => setNewItem({...newItem, username: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Password</label>
                <input
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                  placeholder="••••••••"
                  type="password"
                  value={newItem.password}
                  onChange={e => setNewItem({...newItem, password: e.target.value})}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Note (Optional)</label>
                <textarea
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm resize-none"
                  placeholder="Additional notes..."
                  rows="2"
                  value={newItem.note}
                  onChange={e => setNewItem({...newItem, note: e.target.value})}
                />
              </div>
              <div className="flex gap-2 mt-5 pt-3 border-t border-slate-100">
                <button 
                    type="button" 
                    onClick={() => setIsAdding(false)}
                    className="flex-1 py-2.5 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors font-medium text-sm"
                >
                    Cancel
                </button>
                <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-linear-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold rounded-lg transition-all duration-200 shadow-md hover:shadow-lg text-sm"
                >
                    Save Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
