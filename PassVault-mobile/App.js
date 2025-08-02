import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import LoginScreen from './src/screens/LoginScreen';
import UnlockScreen from './src/screens/UnlockScreen';
import VaultScreen from './src/screens/VaultScreen';
import { getAuthToken, getUserEmail, getSessionKeys, clearAllData } from './src/utils/storage';

const Stack = createStackNavigator();

export default function App() {
  const [initializing, setInitializing] = useState(true);
  const [token, setToken] = useState(null);
  const [email, setEmail] = useState(null);
  const [keyPair, setKeyPair] = useState(null);

  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      const savedToken = await getAuthToken();
      const savedEmail = await getUserEmail();
      const savedKeys = await getSessionKeys();

      if (savedToken && savedEmail) {
        setToken(savedToken);
        setEmail(savedEmail);

        if (savedKeys) {
          setKeyPair(savedKeys);
        }
      }
    } catch (err) {
      console.error('Failed to restore session:', err);
    } finally {
      setInitializing(false);
    }
  };

  const handleLogin = (authToken, userEmail, keys = null) => {
    setToken(authToken);
    setEmail(userEmail);
    if (keys) {
      setKeyPair(keys);
    }
  };

  const handleUnlock = (keys) => {
    setKeyPair(keys);
  };

  const handleLock = () => {
    setKeyPair(null);
  };

  const handleLogout = async () => {
    await clearAllData();
    setToken(null);
    setEmail(null);
    setKeyPair(null);
  };

  if (initializing) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F3F4F6' }}>
        <ActivityIndicator size="large" color="#4F46E5" />
      </View>
    );
  }

  return (
    <>
      <NavigationContainer>
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          {!token ? (
            <Stack.Screen name="Login">
              {props => <LoginScreen {...props} onLogin={handleLogin} />}
            </Stack.Screen>
          ) : !keyPair ? (
            <Stack.Screen name="Unlock">
              {props => <UnlockScreen {...props} email={email} onUnlock={handleUnlock} onLogout={handleLogout} />}
            </Stack.Screen>
          ) : (
            <Stack.Screen name="Vault">
              {props => (
                <VaultScreen
                  {...props}
                  token={token}
                  keyPair={keyPair}
                  onLock={handleLock}
                  onLogout={handleLogout}
                />
              )}
            </Stack.Screen>
          )}
        </Stack.Navigator>
      </NavigationContainer>
    </>
  );
}
