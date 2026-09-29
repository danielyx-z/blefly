import React from 'react';
import { StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native';

import ConnectionPanel from './src/components/ConnectionPanel';
import FlightControls from './src/components/FlightControls';
import { useBLE } from './src/hooks/useBLE';

export default function App() {
  const { status, connect, disconnect, sendXY } = useBLE();
  const isConnected = status === 'connected';

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />

      <ConnectionPanel
        status={status}
        onConnect={connect}
        onDisconnect={disconnect}
      />

      {isConnected && (
        <View style={styles.controls}>
          <FlightControls onSend={sendXY} />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#111111',
    paddingTop: 48,
  },
  controls: {
    flex: 1,
  },
});
