import React, { useState } from 'react';
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
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { api } from '../utils/api';
import { setAuthToken, setSalt, setUserEmail, setVault, setVaultVersion } from '../utils/storage';
import { generateSalt, deriveKey, generateDEK, encryptDEK, encryptVault, generateRecoveryKey } from '../vault/crypto';

export default function LoginScreen({ navigation, onLogin }) {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [masterPassword, setMasterPassword] = useState('');
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [recoveryKeyDownloaded, setRecoveryKeyDownloaded] = useState(false);
  const [registrationSalt, setRegistrationSalt] = useState(null); // Store salt for recovery key

  const handleLogin = async () => {
    if (!email || !accountPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    setLoading(true);
    try {
      const response = await api.login(email, accountPassword, 'Mobile App');
      await setAuthToken(response.token);
      await setUserEmail(email);
      
      onLogin(response.token, email);
    } catch (err) {
      Alert.alert('Login Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !accountPassword || !masterPassword || !confirmMasterPassword) {
      Alert.alert('Error', 'Please fill in all fields');
      return;
    }

    if (masterPassword !== confirmMasterPassword) {
      Alert.alert('Error', 'Master passwords do not match');
      return;
    }

    if (masterPassword.length < 12) {
      Alert.alert('Error', 'Master password must be at least 12 characters');
      return;
    }

    if (!recoveryKeyDownloaded) {
      Alert.alert('Warning', 'You must download your recovery key before continuing');
      return;
    }

    setLoading(true);
    try {
      // Register with backend (account password only)
      const response = await api.register(email, accountPassword, 'Mobile App');
      await setAuthToken(response.token);
      await setUserEmail(email);

      // Use the SAME salt that was generated for the recovery key
      const salt = registrationSalt || generateSalt();
      await setSalt(salt);

      const masterKey = await deriveKey(masterPassword, salt);

      // Generate and encrypt DEK
      const dek = await generateDEK();
      const { encryptedDEK, iv: dekIV } = await encryptDEK(dek, masterKey);

      // Create empty encrypted vault
      const { encryptedVault, iv: vaultIV } = await encryptVault([], dek);

      // Store vault data
      const vaultData = {
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV),
        encryptedDEK: Array.from(encryptedDEK),
        dekIV: Array.from(dekIV),
        salt: Array.from(salt),
        version: 1
      };

      await setVault(vaultData);
      await setVaultVersion(1);

      // Sync to backend
      const encryptedBlob = {
        encryptedVault: Array.from(encryptedVault),
        vaultIV: Array.from(vaultIV),
        encryptedDEK: Array.from(encryptedDEK),
        dekIV: Array.from(dekIV),
        salt: Array.from(salt)
      };

      try {
        await api.syncVault(encryptedBlob, 1);
      } catch (syncErr) {
        console.error('Failed to sync vault to backend:', syncErr);
        Alert.alert('Warning', 'Vault created locally but failed to sync to server. It will sync later.');
      }

      // Store session keys
      const { setSessionKeys } = await import('../utils/storage');
      await setSessionKeys(masterKey, dek);

      // Call onLogin with token, email, and keys
      onLogin(response.token, email, { masterKey, dek });
    } catch (err) {
      Alert.alert('Registration Failed', err.message);
    } finally {
      setLoading(false);
    }
  };

  const downloadRecoveryKey = async () => {
    if (!email || !masterPassword) {
      Alert.alert('Error', 'Please enter email and master password first');
      return;
    }

    try {
      // Generate salt ONCE and store it for registration
      const salt = generateSalt();
      setRegistrationSalt(salt); // Store for later use in registration
      
      const recoveryKey = generateRecoveryKey(email, masterPassword, salt);
      
      const filename = `PassVault_Recovery_Key_${email.replace('@', '_')}.txt`;
      const content = `PassVault Recovery Key\n\nEmail: ${email}\n\nRecovery Key:\n${recoveryKey}\n\nIMPORTANT:\n- Keep this key safe and secure\n- This is the ONLY way to recover your vault if you forget your master password\n- Never share this key with anyone\n- Store it in a safe place (not on your device)\n\nGenerated: ${new Date().toLocaleString()}`;
      
      const fileUri = FileSystem.documentDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, content);
      
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri, {
          mimeType: 'text/plain',
          dialogTitle: 'Save Recovery Key'
        });
        setRecoveryKeyDownloaded(true);
        Alert.alert('Success', 'Recovery key saved! You can now complete registration.');
      } else {
        Alert.alert('Error', 'Sharing is not available on this device');
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to generate recovery key: ' + err.message);
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
            {/* Logo */}
            <View style={{ alignItems: 'center', marginBottom: 24 }}>
              <View style={{ width: 64, height: 64, backgroundColor: '#4F46E5', borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontSize: 32, color: 'white' }}>🔐</Text>
              </View>
              <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#1F2937' }}>PassVault</Text>
              <Text style={{ fontSize: 14, color: '#6B7280', marginTop: 4 }}>Zero-Knowledge Password Manager</Text>
            </View>

            {/* Toggle Login/Register */}
            <View style={{ flexDirection: 'row', marginBottom: 24, backgroundColor: '#F3F4F6', borderRadius: 12, padding: 4 }}>
              <TouchableOpacity
                onPress={() => setIsRegistering(false)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: !isRegistering ? '#4F46E5' : 'transparent'
                }}
              >
                <Text style={{ textAlign: 'center', color: !isRegistering ? 'white' : '#6B7280', fontWeight: '600' }}>Login</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setIsRegistering(true)}
                style={{
                  flex: 1,
                  paddingVertical: 10,
                  borderRadius: 8,
                  backgroundColor: isRegistering ? '#4F46E5' : 'transparent'
                }}
              >
                <Text style={{ textAlign: 'center', color: isRegistering ? 'white' : '#6B7280', fontWeight: '600' }}>Register</Text>
              </TouchableOpacity>
            </View>

            {/* Form Fields */}
            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Email</Text>
              <TextInput
                value={email}
                onChangeText={setEmail}
                placeholder="your@email.com"
                keyboardType="email-address"
                autoCapitalize="none"
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

            <View style={{ marginBottom: 16 }}>
              <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Account Password</Text>
              <TextInput
                value={accountPassword}
                onChangeText={setAccountPassword}
                placeholder="For backend authentication"
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

            {isRegistering && (
              <>
                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Master Password (Vault Encryption)</Text>
                  <TextInput
                    value={masterPassword}
                    onChangeText={setMasterPassword}
                    placeholder="Min 12 characters"
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

                <View style={{ marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '500', color: '#374151', marginBottom: 6 }}>Confirm Master Password</Text>
                  <TextInput
                    value={confirmMasterPassword}
                    onChangeText={setConfirmMasterPassword}
                    placeholder="Re-enter master password"
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

                {/* Recovery Key Download */}
                <View style={{ backgroundColor: '#FEF3C7', borderWidth: 1, borderColor: '#F59E0B', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#92400E', marginBottom: 8 }}>⚠️ Recovery Key Required</Text>
                  <Text style={{ fontSize: 11, color: '#78350F', marginBottom: 12 }}>Download your recovery key before registering. This is the ONLY way to recover your vault if you forget your master password.</Text>
                  <TouchableOpacity
                    onPress={downloadRecoveryKey}
                    style={{ backgroundColor: '#F59E0B', borderRadius: 8, paddingVertical: 10 }}
                  >
                    <Text style={{ textAlign: 'center', color: 'white', fontWeight: '600', fontSize: 13 }}>
                      {recoveryKeyDownloaded ? '✓ Recovery Key Downloaded' : 'Download Recovery Key'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* Submit Button */}
            <TouchableOpacity
              onPress={isRegistering ? handleRegister : handleLogin}
              disabled={loading}
              style={{
                backgroundColor: '#4F46E5',
                borderRadius: 10,
                paddingVertical: 14,
                marginTop: 8
              }}
            >
              {loading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ textAlign: 'center', color: 'white', fontWeight: '700', fontSize: 16 }}>
                  {isRegistering ? 'Create Account' : 'Login'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Info */}
            {isRegistering && (
              <Text style={{ fontSize: 11, color: '#9CA3AF', marginTop: 16, textAlign: 'center' }}>
                🔒 Zero-knowledge encryption • Master password never leaves your device
              </Text>
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </KeyboardAvoidingView>
  );
}
