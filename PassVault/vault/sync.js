import { useState, useEffect } from 'react';
import { vaultDB } from '../src/utils/db'; // CORRECTED: Use IndexedDB
import { api } from '../src/utils/api';

// Local State Helpers
export const getLocalState = async () => {
  const vaultData = await vaultDB.getVault();
  if (!vaultData) {
    return { lastModified: null, encryptedBlob: null };
  }
  
  // Expect vault data to have: { encryptedVault: [...], vaultIV: [...], lastModified: ... }
  // We need to construct the encryptedBlob object expected by the server/sync logic
  
  // If we have minimal data
  if (!vaultData.encryptedVault) {
      return { lastModified: null, encryptedBlob: null };
  }

  const encryptedBlob = {
      encryptedVault: Array.from(vaultData.encryptedVault),
      vaultIV: Array.from(vaultData.vaultIV),
      encryptedDEK: Array.isArray(vaultData.encryptedDEK) ? vaultData.encryptedDEK : Array.from(vaultData.encryptedDEK || []),
      dekIV: Array.isArray(vaultData.dekIV) ? vaultData.dekIV : Array.from(vaultData.dekIV || []),
      salt: Array.isArray(vaultData.salt) ? vaultData.salt : Array.from(vaultData.salt || [])
  };

  return {
    lastModified: vaultData.lastModified || null,
    encryptedBlob: encryptedBlob
  };
};

export const setLocalState = async (lastModified, encryptedBlob) => {
  if (encryptedBlob) {
    // We need to merge this into the existing vaultDB layout
    // vaultDB expects the flattened structure, not the nested encryptedBlob
    
    // First get existing to preserve keys if not present in blob (though they should be)
    const existing = await vaultDB.getVault() || {};
    
    const updatedVault = {
        ...existing,
        encryptedVault: encryptedBlob.encryptedVault,
        vaultIV: encryptedBlob.vaultIV,
        encryptedDEK: encryptedBlob.encryptedDEK || existing.encryptedDEK,
        dekIV: encryptedBlob.dekIV || existing.dekIV,
        salt: encryptedBlob.salt || existing.salt,
        lastModified: lastModified,
        // version: (existing.version || 0) + 1 // Maybe increment version?
    };
    
    await vaultDB.setVault(updatedVault);
  }
};

// Two-way Sync - Uses timestamps to determine sync direction
export const syncVault = async (encryptedBlob, lastModified, jwt) => {
  try {
    // encryptedBlob is an object {encryptedVault: [...], vaultIV: [...]}
    // lastModified is an ISO timestamp string
    const response = await fetch(`http://localhost:5000/api/vault/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${jwt}`
      },
      body: JSON.stringify({ 
        encryptedBlob: JSON.stringify(encryptedBlob), // Serialize the object
        lastModified: lastModified || new Date().toISOString()
      })
    });

    if (!response.ok) {
      throw new Error('Sync failed');
    }

    const data = await response.json();
    
    // Handle three possible sync outcomes:
    // 1. 'updated': Server accepted client data
    // 2. 'pull_required': Server has newer data
    // 3. 'up_to_date': Already in sync

    if (data.action === 'updated') {
      // Server accepted our data
      await setLocalState(data.lastModified, encryptedBlob);
      return { 
        success: true, 
        action: 'updated', 
        lastModified: data.lastModified 
      };
    } 
    else if (data.action === 'pull_required') {
      // Server has newer data - update local
      const serverBlob = JSON.parse(data.encrypted_blob);
      await setLocalState(data.lastModified, serverBlob);
      return { 
        success: true, 
        action: 'pull_required', 
        lastModified: data.lastModified,
        encryptedBlob: serverBlob
      };
    }
    else if (data.action === 'up_to_date') {
      // Already in sync
      return { 
        success: true, 
        action: 'up_to_date', 
        lastModified: data.lastModified 
      };
    }

    return { success: true, action: data.action };

  } catch (err) {
    console.error('Sync error:', err);
    return { success: false, error: err.message };
  }
};

// Pull from Remote
export const pullFromRemote = async (jwt) => {
  try {
    const response = await fetch(`http://localhost:5000/api/vault/pull`, {
      headers: {
        'Authorization': `Bearer ${jwt}`
      }
    });

    if (!response.ok) {
      throw new Error('Pull failed');
    }

    const data = await response.json();
    const { encrypted_blob, lastModified } = data; 

    const { lastModified: localLastModified, encryptedBlob: localBlob } = await getLocalState();
    
    // Case 1: Server empty, we have data -> PUSH
    if ((!encrypted_blob || !lastModified) && localLastModified && localBlob) {
      console.log('Server empty, pushing local vault...');
      return await syncVault(localBlob, localLastModified, jwt);
    }

    // Case 2: Server empty, we empty -> Nothing
    if (!encrypted_blob || !lastModified) {
      return { success: true, updated: false, hasVault: false };
    }

    const serverTimestamp = new Date(lastModified);
    const localTimestamp = localLastModified ? new Date(localLastModified) : null;

    // Case 3: Local newer than server -> PUSH
    if (localTimestamp && serverTimestamp < localTimestamp) {
       console.log('Local is newer, pushing to server...');
       return await syncVault(localBlob, localLastModified, jwt);
    }

    // Case 4: Server newer than local -> PULL (Update local)
    if (!localTimestamp || serverTimestamp > localTimestamp) {
      console.log('Updating local vault with server data');
      
      // Handle Buffer format from server: {type: 'Buffer', data: [...]}
      let blobToStore;
      if (encrypted_blob && encrypted_blob.type === 'Buffer' && encrypted_blob.data) {
        // Convert Buffer array back to actual data format
        const uint8Array = new Uint8Array(encrypted_blob.data);
        const decoder = new TextDecoder();
        const jsonString = decoder.decode(uint8Array);
        blobToStore = JSON.parse(jsonString);
      } else if (typeof encrypted_blob === 'string') {
        blobToStore = JSON.parse(encrypted_blob);
      } else {
        blobToStore = encrypted_blob;
      }

      await setLocalState(lastModified, blobToStore);
      return { 
        success: true, 
        updated: true, 
        lastModified, 
        encryptedBlob: blobToStore 
      };
    }
    
    // Case 5: Timestamps equal -> Sync
    return { success: true, updated: false, lastModified: localLastModified };

  } catch (err) {
    console.error('Pull error:', err);
    return { success: false, error: err.message };
  }
};

// React Hook
export const useSync = (jwt) => {
  const [syncStatus, setSyncStatus] = useState('idle');

  useEffect(() => {
    if (!jwt) return;

    const sync = async () => {
      setSyncStatus('syncing');
      await pullFromRemote(jwt);
      setSyncStatus('idle');
    };

    sync();
  }, [jwt]);

  return { 
    syncStatus, 
    syncVault: (blob, timestamp) => syncVault(blob, timestamp, jwt),
    pullFromRemote: () => pullFromRemote(jwt)
  };
};
