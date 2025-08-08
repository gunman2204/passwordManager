// Sync hook for React Native

import { useState, useEffect } from 'react';
import { getVault, setVault, getVaultLastModified, setVaultLastModified } from '../utils/storage';
import { api } from '../utils/api';

export const useSync = (token) => {
  const [syncStatus, setSyncStatus] = useState('idle');

  const pushToRemote = async (encryptedBlob, lastModified) => {
    try {
      setSyncStatus('syncing');
      const result = await api.syncVault(encryptedBlob, lastModified);
      
      if (result.success) {
        if (result.action === 'updated') {
          // Server accepted our data
          await setVaultLastModified(result.lastModified);
          setSyncStatus('synced');
          setTimeout(() => setSyncStatus('idle'), 2000);
          return { success: true, action: 'updated' };
        } else if (result.action === 'pull_required') {
          // Server has newer data - we need to pull
          setSyncStatus('syncing');
          const pullResult = await handleServerData(result.encrypted_blob, result.lastModified);
          if (pullResult.success) {
            setSyncStatus('synced');
            setTimeout(() => setSyncStatus('idle'), 2000);
            return { success: true, action: 'pulled', dataUpdated: true };
          } else {
            setSyncStatus('error');
            return pullResult;
          }
        } else if (result.action === 'up_to_date') {
          // Already in sync
          setSyncStatus('synced');
          setTimeout(() => setSyncStatus('idle'), 2000);
          return { success: true, action: 'up_to_date' };
        }
      } else {
        setSyncStatus('error');
      }
      
      return result;
    } catch (err) {
      console.error('Sync error:', err);
      setSyncStatus('error');
      return { success: false, error: err.message };
    }
  };

  const handleServerData = async (encryptedBlob, serverTimestamp) => {
    try {
      // Handle blob - it might be a Buffer, string, or object
      let blobToStore = encryptedBlob;
      
      // If it's a Buffer object from PostgreSQL
      if (blobToStore && blobToStore.type === 'Buffer' && Array.isArray(blobToStore.data)) {
        console.log('Converting Buffer to string in sync...');
        const jsonString = String.fromCharCode(...blobToStore.data);
        blobToStore = JSON.parse(jsonString);
      } else if (typeof encryptedBlob === 'string') {
        blobToStore = JSON.parse(encryptedBlob);
      }
      
      await setVault(blobToStore);
      await setVaultLastModified(serverTimestamp);
      return { success: true, updated: true, lastModified: serverTimestamp, blob: blobToStore };
    } catch (err) {
      console.error('Error handling server data:', err);
      return { success: false, error: err.message };
    }
  };

  const pullFromRemote = async () => {
    try {
      setSyncStatus('syncing');
      const { encryptedBlob, lastModified: serverTimestamp } = await api.pullVault();
      
      if (!encryptedBlob) {
        // No vault on server yet
        setSyncStatus('idle');
        return { success: true, updated: false };
      }

      const localTimestamp = await getVaultLastModified();
      const serverDate = new Date(serverTimestamp);
      const localDate = new Date(localTimestamp);

      if (serverDate > localDate) {
        console.log(`Updating local vault from ${localTimestamp} to ${serverTimestamp}`);
        const result = await handleServerData(encryptedBlob, serverTimestamp);
        
        if (result.success) {
          setSyncStatus('synced');
          setTimeout(() => setSyncStatus('idle'), 2000);
          return { success: true, updated: true, lastModified: serverTimestamp, blob: result.blob };
        } else {
          setSyncStatus('error');
          return result;
        }
      }
      
      setSyncStatus('idle');
      return { success: true, updated: false, lastModified: localTimestamp };
    } catch (err) {
      console.error('Pull error:', err);
      setSyncStatus('error');
      return { success: false, error: err.message };
    }
  };

  useEffect(() => {
    if (!token) return;

    // Pull from remote on mount
    pullFromRemote();
  }, [token]);

  return {
    syncStatus,
    pushToRemote,
    pullFromRemote
  };
};
