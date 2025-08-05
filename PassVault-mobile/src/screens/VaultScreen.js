import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  Platform
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import { useSync } from '../vault/sync';
import { encryptVault, decryptVault } from '../vault/crypto';
import { getVault, setVault, getVaultLastModified, setVaultLastModified, clearSessionKeys } from '../utils/storage';

export default function VaultScreen({ token, keyPair, onLock, onLogout }) {
  const { masterKey, dek } = keyPair;
  const { syncStatus, pushToRemote } = useSync(token);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', url: '', username: '', password: '', note: '' });
  const [expandedItem, setExpandedItem] = useState(null);

  useEffect(() => {
    loadVault();
  }, []);

  const loadVault = async () => {
    try {
      const vaultData = await getVault();
      
      if (vaultData && vaultData.encryptedVault && vaultData.encryptedVault.length > 0) {
        const encryptedVault = new Uint8Array(vaultData.encryptedVault);
        const vaultIV = new Uint8Array(vaultData.vaultIV);
        
        const decrypted = await decryptVault(encryptedVault, vaultIV, dek);
        setItems(Array.isArray(decrypted) ? decrypted : []);
      } else {
        setItems([]);
      }
    } catch (err) {
      console.error("Failed to decrypt vault:", err);
      Alert.alert('Error', 'Failed to decrypt vault');
      setItems([]);
    } finally {
      setLoading(false);
    }
  };

  const saveVault = async (updatedItems) => {
    try {
      const { encryptedVault, iv: vaultIV } = await encryptVault(updatedItems, dek);
      
      const currentVault = await getVault();
      const lastModified = new Date().toISOString();
      
      const updatedVault = {
        ...currentVault,
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV)
      };
      
      await setVault(updatedVault);
      await setVaultLastModified(lastModified);
      
      // Sync to backend (include all vault data)
      const encryptedBlob = {
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV),
        encryptedDEK: currentVault.encryptedDEK,
        dekIV: currentVault.dekIV,
        salt: currentVault.salt
      };
      
      const result = await pushToRemote(encryptedBlob, lastModified);
      
      if (!result.success) {
        Alert.alert('Sync Failed', result.error || 'Unknown error');
      } else {
        // Always reload vault after sync (including after pull)
        loadVault();
        if (result.action === 'pulled' && result.dataUpdated) {
          Alert.alert('Vault Updated', 'Newer data was pulled from server');
        }
      }
      return true;
    } catch (err) {
      console.error(err);
      Alert.alert('Error', 'Encryption/storage failed: ' + err.message);
      return false;
    }
  };

  const handleAddItem = async () => {
    if (!newItem.name || !newItem.username || !newItem.password) {
      Alert.alert('Error', 'Please fill in required fields');
      return;
    }

    const updatedItems = [...items, { 
      ...newItem, 
      id: Date.now().toString() + Math.random().toString(36),
      createdAt: Date.now() 
    }];
    
    setItems(updatedItems);
    setNewItem({ name: '', url: '', username: '', password: '', note: '' });
    setIsAdding(false);

    await saveVault(updatedItems);
  };

  const handleDeleteItem = async (itemId) => {
    Alert.alert(
      'Delete Password',
      'Are you sure you want to delete this credential?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const updatedItems = items.filter(item => item.id !== itemId);
            setItems(updatedItems);
            await saveVault(updatedItems);
          }
        }
      ]
    );
  };

  const handleCopyPassword = async (password) => {
    await Clipboard.setStringAsync(password);
    Alert.alert('Copied', 'Password copied to clipboard');
  };

  const handleManualSync = async () => {
    try {
      const vaultData = await getVault();
      const lastModified = await getVaultLastModified();
      
      if (!vaultData) {
        Alert.alert('Sync', 'No vault data to sync');
        return;
      }

      const encryptedBlob = {
        encryptedVault: vaultData.encryptedVault,
        vaultIV: vaultData.vaultIV,
        encryptedDEK: vaultData.encryptedDEK,
        dekIV: vaultData.dekIV,
        salt: vaultData.salt
      };
      
      const result = await pushToRemote(encryptedBlob, lastModified);
      
      if (result.success) {
        // Always reload vault after sync (including after pull)
        loadVault();
        if (result.action === 'pulled' && result.dataUpdated) {
          Alert.alert('Vault Updated', 'Newer data was pulled from server');
        } else if (result.action === 'updated') {
          Alert.alert('Success', 'Vault synced to server');
        } else if (result.action === 'up_to_date') {
          Alert.alert('Success', 'Vault already in sync');
        }
      } else {
        Alert.alert('Sync Failed', result.error || 'Unknown error');
      }
    } catch (err) {
      console.error('Manual sync error:', err);
      Alert.alert('Error', 'Failed to sync: ' + err.message);
    }
  };

  const handleLock = async () => {
    await clearSessionKeys();
    onLock();
  };

  const handleLogout = async () => {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await clearSessionKeys();
            onLogout();
          }
        }
      ]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={{ marginTop: 12, color: '#6B7280' }}>Decrypting Vault...</Text>
      </View>
    );
  }

  const renderItem = ({ item }) => (
    <TouchableOpacity
      onPress={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
      style={{
        backgroundColor: '#FFFFFF',
        padding: 18,
        borderRadius: 12,
        marginBottom: 12,
        marginHorizontal: 16,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 3,
        elevation: 2,
        borderWidth: 1,
        borderColor: '#E0E0E0'
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, marginRight: 12 }}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: '#212121', marginBottom: 6 }}>
            {item.name || 'Untitled'}
          </Text>
          <Text style={{ fontSize: 14, color: '#757575', marginBottom: 3 }}>{item.username}</Text>
          {item.url && <Text style={{ fontSize: 12, color: '#9E9E9E' }}>{item.url}</Text>}
        </View>
        
        {expandedItem !== item.id && (
          <TouchableOpacity
            onPress={() => handleCopyPassword(item.password)}
            style={{ 
              padding: 10,
              backgroundColor: '#E3F2FD',
              borderRadius: 8
            }}
          >
            <Text style={{ fontSize: 18 }}>📋</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {expandedItem === item.id && (
        <View style={{ marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#EEEEEE' }}>
          <View style={{ backgroundColor: '#FAFAFA', padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#E0E0E0' }}>
            <Text style={{ fontSize: 11, color: '#757575', marginBottom: 6, fontWeight: '600', letterSpacing: 0.5 }}>PASSWORD</Text>
            <Text style={{ fontSize: 15, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace', color: '#212121', letterSpacing: 1 }}>
              {item.password}
            </Text>
          </View>
          
          {item.note && (
            <View style={{ backgroundColor: '#FAFAFA', padding: 14, borderRadius: 8, marginBottom: 12, borderWidth: 1, borderColor: '#E0E0E0' }}>
              <Text style={{ fontSize: 11, color: '#757575', marginBottom: 6, fontWeight: '600', letterSpacing: 0.5 }}>NOTE</Text>
              <Text style={{ fontSize: 14, color: '#424242', lineHeight: 20 }}>{item.note}</Text>
            </View>
          )}
          
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
            <TouchableOpacity
              onPress={() => handleCopyPassword(item.password)}
              style={{ 
                flex: 1, 
                backgroundColor: '#1976D2', 
                borderRadius: 8, 
                paddingVertical: 12,
                elevation: 2,
                shadowColor: '#1976D2',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4
              }}
            >
              <Text style={{ textAlign: 'center', color: '#FFFFFF', fontWeight: '600', fontSize: 14 }}>Copy Password</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => handleDeleteItem(item.id)}
              style={{ 
                flex: 1, 
                backgroundColor: '#FFFFFF', 
                borderRadius: 8, 
                paddingVertical: 12,
                borderWidth: 1.5,
                borderColor: '#D32F2F'
              }}
            >
              <Text style={{ textAlign: 'center', color: '#D32F2F', fontWeight: '600', fontSize: 14 }}>Delete</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </TouchableOpacity>
  );

  return (
    <View style={{ flex: 1, backgroundColor: '#F5F5F5' }}>
      {/* Header */}
      <LinearGradient 
        colors={['#1976D2', '#1565C0']} 
        style={{ 
          paddingTop: Platform.OS === 'ios' ? 50 : 40, 
          paddingBottom: 20, 
          paddingHorizontal: 20,
          elevation: 4,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.2,
          shadowRadius: 4
        }}
      >
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ fontSize: 28, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.5 }}>
              PassVault
            </Text>
            <Text style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
              {items.length} {items.length === 1 ? 'password' : 'passwords'}
            </Text>
          </View>
          
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {/* Sync Status Badge */}
            {syncStatus && (
              <TouchableOpacity
                onPress={handleManualSync}
                disabled={syncStatus === 'syncing'}
                style={{ 
                  backgroundColor: syncStatus === 'synced' ? 'rgba(76, 175, 80, 0.9)' : 'rgba(255, 193, 7, 0.9)',
                  paddingHorizontal: 12, 
                  paddingVertical: 6, 
                  borderRadius: 16,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  opacity: syncStatus === 'syncing' ? 0.7 : 1
                }}
              >
                <Text style={{ fontSize: 16 }}>
                  {syncStatus === 'syncing' ? '⟳' : '✓'}
                </Text>
                <Text style={{ fontSize: 12, color: '#FFFFFF', fontWeight: '600' }}>
                  {syncStatus === 'syncing' ? 'Syncing' : 'Synced'}
                </Text>
              </TouchableOpacity>
            )}
            
            {/* Menu Button */}
            <TouchableOpacity 
              onPress={() => setShowMenu(!showMenu)}
              style={{
                padding: 8,
                borderRadius: 20,
                backgroundColor: 'rgba(255,255,255,0.15)'
              }}
            >
              <Text style={{ fontSize: 20, color: '#FFFFFF' }}>⋮</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* Menu Dropdown */}
      {showMenu && (
        <View style={{ 
          position: 'absolute', 
          top: Platform.OS === 'ios' ? 110 : 100, 
          right: 20, 
          backgroundColor: '#FFFFFF', 
          borderRadius: 8, 
          shadowColor: '#000', 
          shadowOffset: { width: 0, height: 4 }, 
          shadowOpacity: 0.3, 
          shadowRadius: 8, 
          elevation: 8, 
          zIndex: 1000, 
          minWidth: 180,
          overflow: 'hidden'
        }}>
          <TouchableOpacity
            onPress={() => {
              setShowMenu(false);
              handleLock();
            }}
            style={{ 
              paddingVertical: 16, 
              paddingHorizontal: 20, 
              borderBottomWidth: 1, 
              borderBottomColor: '#E0E0E0',
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12
            }}
          >
            <Text style={{ fontSize: 18 }}>🔒</Text>
            <Text style={{ fontSize: 15, color: '#424242', fontWeight: '500' }}>Lock Vault</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setShowMenu(false);
              handleLogout();
            }}
            style={{ 
              paddingVertical: 16, 
              paddingHorizontal: 20,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12
            }}
          >
            <Text style={{ fontSize: 18 }}>🚪</Text>
            <Text style={{ fontSize: 15, color: '#D32F2F', fontWeight: '500' }}>Logout</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Content */}
      <View style={{ flex: 1 }}>
        {items.length === 0 ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
            <View style={{ 
              width: 120, 
              height: 120, 
              borderRadius: 60, 
              backgroundColor: '#E3F2FD', 
              justifyContent: 'center', 
              alignItems: 'center',
              marginBottom: 24
            }}>
              <Text style={{ fontSize: 56 }}>🔐</Text>
            </View>
            <Text style={{ fontSize: 20, fontWeight: '600', color: '#424242', marginBottom: 8, textAlign: 'center' }}>
              Your vault is empty
            </Text>
            <Text style={{ fontSize: 14, color: '#9E9E9E', textAlign: 'center', lineHeight: 20 }}>
              Tap the + button below to add your first password
            </Text>
          </View>
        ) : (
          <FlatList
            data={items}
            renderItem={renderItem}
            keyExtractor={item => item.id}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 16, paddingBottom: 100 }}
          />
        )}
      </View>

      {/* Floating Action Button */}
      <TouchableOpacity
        onPress={() => setIsAdding(true)}
        style={{
          position: 'absolute',
          bottom: 28,
          right: 20,
          width: 64,
          height: 64,
          borderRadius: 32,
          backgroundColor: '#1976D2',
          justifyContent: 'center',
          alignItems: 'center',
          shadowColor: '#1976D2',
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 8
        }}
      >
        <Text style={{ fontSize: 32, color: '#FFFFFF', fontWeight: '300', marginTop: -2 }}>+</Text>
      </TouchableOpacity>

      {/* Add Modal */}
      <Modal
        visible={isAdding}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setIsAdding(false)}
      >
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ 
            backgroundColor: '#FFFFFF', 
            borderTopLeftRadius: 20, 
            borderTopRightRadius: 20, 
            paddingTop: 8,
            paddingBottom: Platform.OS === 'ios' ? 40 : 24,
            maxHeight: '90%'
          }}>
            {/* Drag Handle */}
            <View style={{ alignItems: 'center', paddingVertical: 8 }}>
              <View style={{ width: 40, height: 4, backgroundColor: '#BDBDBD', borderRadius: 2 }} />
            </View>

            <View style={{ paddingHorizontal: 20, paddingTop: 12 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <Text style={{ fontSize: 22, fontWeight: '700', color: '#212121' }}>Add New Password</Text>
                <TouchableOpacity 
                  onPress={() => setIsAdding(false)}
                  style={{ padding: 8 }}
                >
                  <Text style={{ fontSize: 24, color: '#757575' }}>✕</Text>
                </TouchableOpacity>
              </View>

              <ScrollView showsVerticalScrollIndicator={false} style={{ marginBottom: 20 }}>
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161', marginBottom: 8 }}>Name / Title *</Text>
                  <TextInput
                    value={newItem.name}
                    onChangeText={(text) => setNewItem({ ...newItem, name: text })}
                    placeholder="e.g., Gmail, Facebook"
                    placeholderTextColor="#9E9E9E"
                    style={{
                      backgroundColor: '#FAFAFA',
                      borderWidth: 1,
                      borderColor: '#E0E0E0',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 15,
                      color: '#212121'
                    }}
                  />
                </View>

                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161', marginBottom: 8 }}>Website URL</Text>
                  <TextInput
                    value={newItem.url}
                    onChangeText={(text) => setNewItem({ ...newItem, url: text })}
                    placeholder="https://example.com"
                    placeholderTextColor="#9E9E9E"
                    keyboardType="url"
                    autoCapitalize="none"
                    style={{
                      backgroundColor: '#FAFAFA',
                      borderWidth: 1,
                      borderColor: '#E0E0E0',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 15,
                      color: '#212121'
                    }}
                  />
                </View>

                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161', marginBottom: 8 }}>Username / Email *</Text>
                  <TextInput
                    value={newItem.username}
                    onChangeText={(text) => setNewItem({ ...newItem, username: text })}
                    placeholder="username@example.com"
                    placeholderTextColor="#9E9E9E"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    style={{
                      backgroundColor: '#FAFAFA',
                      borderWidth: 1,
                      borderColor: '#E0E0E0',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 15,
                      color: '#212121'
                    }}
                  />
                </View>

                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161', marginBottom: 8 }}>Password *</Text>
                  <TextInput
                    value={newItem.password}
                    onChangeText={(text) => setNewItem({ ...newItem, password: text })}
                    placeholder="Enter password"
                    placeholderTextColor="#9E9E9E"
                    secureTextEntry={true}
                    style={{
                      backgroundColor: '#FAFAFA',
                      borderWidth: 1,
                      borderColor: '#E0E0E0',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 15,
                      color: '#212121'
                    }}
                  />
                </View>

                <View style={{ marginBottom: 24 }}>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: '#616161', marginBottom: 8 }}>Note (Optional)</Text>
                  <TextInput
                    value={newItem.note}
                    onChangeText={(text) => setNewItem({ ...newItem, note: text })}
                    placeholder="Additional notes..."
                    placeholderTextColor="#9E9E9E"
                    multiline={true}
                    numberOfLines={3}
                    style={{
                      backgroundColor: '#FAFAFA',
                      borderWidth: 1,
                      borderColor: '#E0E0E0',
                      borderRadius: 8,
                      paddingHorizontal: 16,
                      paddingVertical: 14,
                      fontSize: 15,
                      color: '#212121',
                      textAlignVertical: 'top',
                      minHeight: 80
                    }}
                  />
                </View>

                <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
                  <TouchableOpacity
                    onPress={() => setIsAdding(false)}
                    style={{ 
                      flex: 1, 
                      backgroundColor: '#FAFAFA', 
                      borderRadius: 8, 
                      paddingVertical: 16,
                      borderWidth: 1,
                      borderColor: '#E0E0E0'
                    }}
                  >
                    <Text style={{ textAlign: 'center', color: '#616161', fontWeight: '600', fontSize: 16 }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={handleAddItem}
                    style={{ 
                      flex: 1, 
                      backgroundColor: '#1976D2', 
                      borderRadius: 8, 
                      paddingVertical: 16,
                      elevation: 2,
                      shadowColor: '#1976D2',
                      shadowOffset: { width: 0, height: 2 },
                      shadowOpacity: 0.3,
                      shadowRadius: 4
                    }}
                  >
                    <Text style={{ textAlign: 'center', color: '#FFFFFF', fontWeight: '700', fontSize: 16 }}>Save Password</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
