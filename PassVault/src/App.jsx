import { useState, useEffect, useMemo } from 'react';
import Login from './components/Login';
import Unlock from './components/Unlock';
import Vault from './components/Vault';
import { getAuthToken, getUserEmail, removeAuthToken, getSessionKeys, setSessionKeys, clearSessionKeys } from './utils/storage';

// Screen identifiers
const SCREENS = {
  LOADING: 'loading',
  LOGIN: 'login',
  UNLOCK: 'unlock',
  VAULT: 'vault'
};

function App() {
  const [token, setToken] = useState(null);
  const [keys, setKeys] = useState(null); // { masterKey, dek }
  const [userEmail, setUserEmail] = useState('');
  const [loading, setLoading] = useState(true);

  // Determine current screen based on app state
  const currentScreen = useMemo(() => {
    if (loading) return SCREENS.LOADING;
    if (!token) return SCREENS.LOGIN;
    if (!keys) return SCREENS.UNLOCK;
    return SCREENS.VAULT;
  }, [loading, token, keys]);

  // Initial Auth Check + Session Restoration
  useEffect(() => {
    const initAuth = async () => {
      try {
        const storedToken = await getAuthToken();
        const storedEmail = await getUserEmail();
        
        if (storedToken && storedEmail) {
          setToken(storedToken);
          setUserEmail(storedEmail);
          
          // CRITICAL: Restore session keys if available (persists across popup reopens)
          const sessionKeys = await getSessionKeys();
          if (sessionKeys) {
            console.log('Restored vault session');
            setKeys(sessionKeys);
          }
        } else if (storedToken) {
          // Inconsistent state - clear corrupted data
          await removeAuthToken();
        }
      } catch (e) {
        console.error("Auth check failed", e);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  // Navigation handlers
  const handleLoginSuccess = async (newToken) => {
    setToken(newToken);
    const email = await getUserEmail();
    if (email) setUserEmail(email);
  };

  const handleUnlock = async (newKeys) => {
    setKeys(newKeys);
    // CRITICAL: Persist keys in session storage (survives popup close, cleared when Chrome closes)
    await setSessionKeys(newKeys.masterKey, newKeys.dek);
  };

  const handleLockVault = async () => {
    // Lock vault: clear keys but keep user logged in
    setKeys(null);
    await clearSessionKeys();
  };

  const handleFullLogout = async () => {
    // Full logout: clear everything
    setToken(null);
    setKeys(null);
    setUserEmail('');
    await removeAuthToken();
    await clearSessionKeys();
  };

  // Screen component mapping
  const screens = {
    [SCREENS.LOADING]: (
      <div className="loading-container">
        <div className="loading-spinner"></div>
      </div>
    ),
    [SCREENS.LOGIN]: (
      <Login onLoginSuccess={handleLoginSuccess} />
    ),
    [SCREENS.UNLOCK]: (
      <Unlock 
        email={userEmail} 
        onUnlock={handleUnlock}
        onLogout={handleFullLogout}
      />
    ),
    [SCREENS.VAULT]: (
      <Vault 
        token={token} 
        masterKey={keys} 
        onLock={handleLockVault}
        onLogout={handleFullLogout}
      />
    )
  };

  return (
    <div className="extension-popup">
      <div className="extension-content">
        {screens[currentScreen]}
      </div>
    </div>
  );
}

export default App;
