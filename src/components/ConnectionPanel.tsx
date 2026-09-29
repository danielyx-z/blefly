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
  disconnected: { color: '#ff453a', label: 'No Link' },
  connecting:   { color: '#ffd60a', label: 'Scanning' },
  connected:    { color: '#30d158', label: 'Linked' },
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
    <View style={styles.bar}>
      {/* Status indicator */}
      <View style={styles.statusGroup}>
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.statusLabel, { color }]}>{label}</Text>
        {isConnecting && (
          <ActivityIndicator size="small" color="#ffd60a" style={{ marginLeft: 6 }} />
        )}
      </View>

      {/* Title */}
      <Text style={styles.title}>BLEFLY</Text>

      {/* Action */}
      <TouchableOpacity
        style={[styles.btn, isConnected && styles.btnDanger]}
        onPress={isConnected ? onDisconnect : onConnect}
        disabled={isConnecting}
        activeOpacity={0.6}
      >
        <Text style={styles.btnText}>
          {isConnected ? 'Disconnect' : 'Link'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1c1c1c',
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 100,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginRight: 7,
  },
  statusLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  title: {
    color: '#444',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 6,
  },
  btn: {
    backgroundColor: '#1c1c1e',
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 18,
    paddingVertical: 7,
    borderRadius: 8,
    minWidth: 70,
    alignItems: 'center',
  },
  btnDanger: {
    borderColor: '#ff453a',
  },
  btnText: {
    color: '#ccc',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
