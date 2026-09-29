import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import type { ConnectionStatus } from '../hooks/useBLE';

interface Props {
  status: ConnectionStatus;
  onConnect: () => void;
  onDisconnect: () => void;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { color: string; label: string }
> = {
  disconnected: { color: '#FF3B30', label: 'Disconnected' },
  connecting: { color: '#FFCC00', label: 'Connecting…' },
  connected: { color: '#34C759', label: 'Connected to BLEFly' },
};

export default function ConnectionPanel({
  status,
  onConnect,
  onDisconnect,
}: Props) {
  const { color, label } = STATUS_CONFIG[status];
  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  return (
    <View style={styles.container}>
      {/* Title */}
      <Text style={styles.title}>BLEFly Controller</Text>

      {/* Status row */}
      <View style={styles.statusRow}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.statusText, { color }]}>{label}</Text>
        {isConnecting && (
          <ActivityIndicator
            size="small"
            color="#FFCC00"
            style={{ marginLeft: 8 }}
          />
        )}
      </View>

      {/* Action button */}
      <TouchableOpacity
        style={[
          styles.button,
          isConnected && styles.buttonDisconnect,
        ]}
        onPress={isConnected ? onDisconnect : onConnect}
        disabled={isConnecting}
        activeOpacity={0.7}
      >
        <Text style={styles.buttonText}>
          {isConnected ? 'Disconnect' : 'Connect'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 8,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  button: {
    marginTop: 18,
    backgroundColor: '#007AFF',
    paddingHorizontal: 36,
    paddingVertical: 12,
    borderRadius: 10,
  },
  buttonDisconnect: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
});
