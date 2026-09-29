import React, { useEffect } from 'react';
import { StyleSheet, View, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenOrientation from 'expo-screen-orientation';

import ConnectionPanel from './src/components/ConnectionPanel';
import FlightControls from './src/components/FlightControls';
import { useBLE } from './src/hooks/useBLE';

export default function App() {
  const { status, connect, disconnect, sendXY } = useBLE();
  const isConnected = status === 'connected';

  useEffect(() => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
  }, []);

  return (
    <View style={styles.root}>
      <StatusBar style="light" hidden />

      <ConnectionPanel
        status={status}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      {isConnected ? (
        <FlightControls onSend={sendXY} />
      ) : (
        <View style={styles.idle}>
          <Text style={styles.idleIcon}>⬡</Text>
          <Text style={styles.idleText}>
            {status === 'connecting'
              ? 'Searching for BLEFly…'
              : 'Tap Link to connect'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111',
  },
  idle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  idleIcon: {
    fontSize: 40,
    color: '#222',
  },
  idleText: {
    color: '#444',
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: 1,
  },
});
