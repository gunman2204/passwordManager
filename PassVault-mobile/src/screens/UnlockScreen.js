import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as LocalAuthentication from 'expo-local-authentication';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';
import { getSalt, setSessionKeys, getVault, clearAllData, setSalt, setVault } from '../utils/storage';
import { api } from '../utils/api';
import { deriveKey, decryptDEK, parseRecoveryKey } from '../vault/crypto';

export default function UnlockScreen({ email, onUnlock, onLogout }) {
  const [masterPassword, setMasterPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [useRecoveryKey, setUseRecoveryKey] = useState(false);
  const [recoveryKey, setRecoveryKey] = useState('');

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setBiometricAvailable(compatible && enrolled);
  };

  const handleBiometricUnlock = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock PassVault',
        fallbackLabel: 'Use Password',
        cancelLabel: 'Cancel'
      });

      if (result.success) {
        // After biometric auth, still need to unlock with actual keys
        Alert.alert('Biometric Success', 'Please enter your master password to unlock vault');
      }
    } catch (err) {
      Alert.alert('Error', 'Biometric authentication failed');
    }
  };

  const handleUnlock = async () => {
    if (!masterPassword) {
      Alert.alert('Error', 'Please enter your master password');
      return;
    }

    setLoading(true);
    try {
      let salt = await getSalt();
      let vaultData = await getVault();
      
      // If no local data, try to pull from server
      if (!salt || !vaultData) {
        console.log('No local vault data found, pulling from server...');
        try {
          const serverVault = await api.pullVault();
          console.log('Server vault response:', serverVault);
          
          if (serverVault && serverVault.encryptedBlob) {
            // Handle encrypted_blob - it might be a Buffer, string, or object
            let blob = serverVault.encryptedBlob;
            
            // If it's a Buffer object from PostgreSQL
            if (blob && blob.type === 'Buffer' && Array.isArray(blob.data)) {
              console.log('Converting Buffer to string...');
              // Convert byte array to string
              const jsonString = String.fromCharCode(...blob.data);
              blob = JSON.parse(jsonString);
            } else if (typeof blob === 'string') {
              // If it's already a string, parse it
              try {
                blob = JSON.parse(blob);
              } catch (parseErr) {
                console.error('Failed to parse blob:', parseErr);
                throw new Error('Invalid vault data format from server');
              }
            }
            
            console.log('Blob data received:', {
              hasEncryptedVault: !!blob.encryptedVault,
              hasVaultIV: !!blob.vaultIV,
              hasEncryptedDEK: !!blob.encryptedDEK,
              hasDekIV: !!blob.dekIV,
              hasSalt: !!blob.salt
            });
            
            // Validate that all required fields are present
            if (!blob.encryptedDEK || !blob.dekIV || !blob.salt) {
              console.error('Incomplete vault data from server');
              Alert.alert(
                'Incomplete Vault Data',
                'The vault on the server is missing encryption keys (encryptedDEK, dekIV, or salt). This vault was created with an older version.\n\nPlease:\n1. Delete your account data\n2. Re-register to create a new vault\n\nOr sync from a device with a complete vault.'
              );
              setLoading(false);
              return;
            }
            
            // Store locally
            vaultData = {
              encryptedVault: blob.encryptedVault,
              vaultIV: blob.vaultIV,
              encryptedDEK: blob.encryptedDEK,
              dekIV: blob.dekIV,
              salt: blob.salt,
              version: serverVault.version
            };
            
            await setVault(vaultData);
            
            if (blob.salt) {
              salt = new Uint8Array(blob.salt);
              await setSalt(salt);
              console.log('Salt stored successfully');
            }
          } else {
            console.log('No vault data on server');
            Alert.alert('Error', 'No vault found on server. Please register on another device first.');
            setLoading(false);
            return;
          }
        } catch (pullErr) {
          console.error('Failed to pull vault from server:', pullErr);
          Alert.alert('Sync Error', 'Failed to sync vault from server: ' + pullErr.message + '\n\nPlease ensure you have registered on another device.');
          setLoading(false);
          return;
        }
      }
      
      if (!salt) {
        Alert.alert('Error', 'No vault found. Please register first or sync from another device.');
        setLoading(false);
        return;
      }

      // Derive master key from password
      const masterKey = await deriveKey(masterPassword, salt);

      if (!vaultData) {
        Alert.alert('Error', 'No vault data found');
        setLoading(false);
        return;
      }

      // Decrypt DEK
      const encryptedDEK = new Uint8Array(vaultData.encryptedDEK);
      const dekIV = new Uint8Array(vaultData.dekIV);
      const dek = await decryptDEK(encryptedDEK, dekIV, masterKey);

      // Store session keys
      await setSessionKeys(masterKey, dek);

      // Navigate to vault
      onUnlock({ masterKey, dek });
    } catch (err) {
      console.error('Unlock error:', err);
      Alert.alert('Unlock Failed', 'Invalid password or corrupted vault data');
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryKeyUnlock = async () => {
    if (!recoveryKey) {
      Alert.alert('Error', 'Please enter your recovery key');
      return;
    }

    setLoading(true);
    try {
      const { email: recoveryEmail, password, salt } = parseRecoveryKey(recoveryKey);

      if (recoveryEmail !== email) {
        Alert.alert('Error', 'Recovery key does not match this account');
        setLoading(false);
        return;
      }

      // Derive master key from recovered password
      const masterKey = await deriveKey(password, salt);

      // Get vault data
      const vaultData = await getVault();
      if (!vaultData) {
        Alert.alert('Error', 'No vault data found');
        setLoading(false);
        return;
      }

      // Decrypt DEK
      const encryptedDEK = new Uint8Array(vaultData.encryptedDEK);
      const dekIV = new Uint8Array(vaultData.dekIV);
      const dek = await decryptDEK(encryptedDEK, dekIV, masterKey);

      // Store session keys
      await setSessionKeys(masterKey, dek);

      onUnlock({ masterKey, dek });
    } catch (err) {
      Alert.alert('Recovery Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const pickRecoveryKeyFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: 'text/plain',
        copyToCacheDirectory: false
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const content = await FileSystem.readAsStringAsync(result.assets[0].uri);
        // Extract recovery key from file
        const keyMatch = content.match(/Recovery Key:\s*([A-Za-z0-9+/=]+)/);
        if (keyMatch) {
          setRecoveryKey(keyMatch[1]);
          Alert.alert('Success', 'Recovery key loaded from file');
        } else {
          Alert.alert('Error', 'Invalid recovery key file format');
        }
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to load recovery key file');
    }
  };

  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1 }}
    >
      <LinearGradient
        colors={['#4F46E5', '#7C3AED']}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20 }}>
          <View style={{ backgroundColor: 'white', borderRadius: 24, padding: 24, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8 }}>
            {/* Logout Button */}
            <TouchableOpacity
              onPress={async () => {
                Alert.alert(
                  'Logout',
                  'Are you sure you want to logout? You will need to login again to access your vault.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Logout',
                      style: 'destructive',
                      onPress: async () => {
                        await clearAllData();
                        if (onLogout) {
                          onLogout();
                        }
                      }
                    }
                  ]
                );
              }}
              style={{ alignSelf: 'flex-end', marginBottom: 16 }}
            >
              <Text style={{ fontSize: 14, color: '#EF4444', fontWeight: '600' }}>Logout</Text>
            </TouchableOpacity>

            {/* Logo */}
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 64, height: 64, backgroundColor: '#4F46E5', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 32, color: 'white' }}>🔓</Text>
              </View>
              <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#1F2937' }}>Unlock Vault</Text>
              <Text style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>{email}</Text>
            </View>

            {/* Toggle Master Password / Recovery Key */}
            <View style={{ flexDirection: 'row', marginBottom: 24, backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4 }}>
              <TouchableOpacity
                onPress={() => setUseRecoveryKey(false)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: !useRecoveryKey ? '#4F46E5' : 'transparent'
                }}
              >
                <Text style={{ textAlign: 'center', color: !useRecoveryKey ? 'white' : '#6B7280', fontWeight: '600', fontSize: 13 }}>Password</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setUseRecoveryKey(true)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: useRecoveryKey ? '#4F46E5' : 'transparent'
                }}
              >
                <Text style={{ textAlign: 'center', color: useRecoveryKey ? 'white' : '#6B7280', fontWeight: '600', fontSize: 13 }}>Recovery Key</Text>
              </TouchableOpacity>
            </View>

            {!useRecoveryKey ? (
              <>
                {/* Master Password Unlock */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Master Password</Text>
                  <TextInput
                    value={masterPassword}
                    onChangeText={setMasterPassword}
                    placeholder="Enter your master password"
                    secureTextEntry={true}
                    style={{
                      backgroundColor: '#F9FAFB',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      fontSize: 14
                    }}
                  />
                </View>

                <TouchableOpacity
                  onPress={handleUnlock}
                  disabled={loading}
                  style={{
                    backgroundColor: '#4F46E5',
                    borderRadius: 10,
                    paddingVertical: 14,
                    marginBottom: 12
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ textAlign: 'center', color: 'white', fontWeight: '700', fontSize: 16 }}>
                      Unlock Vault
                    </Text>
                  )}
                </TouchableOpacity>

                {/* Biometric Unlock */}
                {biometricAvailable && (
                  <TouchableOpacity
                    onPress={handleBiometricUnlock}
                    style={{
                      backgroundColor: '#10B981',
                      borderRadius: 10,
                      paddingVertical: 14
                    }}
                  >
                    <Text style={{ textAlign: 'center', color: 'white', fontWeight: '700', fontSize: 16 }}>
                      🔐 Use Face ID / Touch ID
                    </Text>
                  </TouchableOpacity>
                )}
              </>
            ) : (
              <>
                {/* Recovery Key Unlock */}
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Recovery Key</Text>
                  <TextInput
                    value={recoveryKey}
                    onChangeText={setRecoveryKey}
                    placeholder="Paste your recovery key"
                    multiline={true}
                    numberOfLines={4}
                    style={{
                      backgroundColor: '#F9FAFB',
                      borderWidth: 1,
                      borderColor: '#E5E7EB',
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 12,
                      fontSize: 12,
                      fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                      textAlignVertical: 'top'
                    }}
                  />
                </View>

                <TouchableOpacity
                  onPress={pickRecoveryKeyFile}
                  style={{
                    backgroundColor: '#F3F4F6',
                    borderWidth: 1,
                    borderColor: '#E5E7EB',
                    borderRadius: 10,
                    paddingVertical: 12,
                    marginBottom: 16
                  }}
                >
                  <Text style={{ textAlign: 'center', color: '#4F46E5', fontWeight: '600', fontSize: 14 }}>
                    📄 Load from File
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={handleRecoveryKeyUnlock}
                  disabled={loading}
                  style={{
                    backgroundColor: '#F59E0B',
                    borderRadius: 10,
                    paddingVertical: 14
                  }}
                >
                  {loading ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ textAlign: 'center', color: 'white', fontWeight: '700', fontSize: 16 }}>
                      Unlock with Recovery Key
                    </Text>
                  )}
                </TouchableOpacity>
              </>
            )}

            <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 16, textAlign: 'center' }}>
              🔒 Your vault is encrypted with zero-knowledge encryption
            </Text>
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}
