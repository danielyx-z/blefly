import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Joystick from './Joystick';
import { axisToUint8, CENTER } from '../utils/protocol';

interface Props {
  /** Transmit packed X,Y uint8 values over BLE. */
  onSend: (x: number, y: number) => void;
}

export default function FlightControls({ onSend }: Props) {
  const [displayX, setDisplayX] = useState(CENTER);
  const [displayY, setDisplayY] = useState(CENTER);

  const handleMove = useCallback(
    (normX: number, normY: number) => {
      const ux = axisToUint8(normX);
      const uy = axisToUint8(normY);
      setDisplayX(ux);
      setDisplayY(uy);
      onSend(ux, uy);
    },
    [onSend],
  );

  const handleRelease = useCallback(() => {
    setDisplayX(CENTER);
    setDisplayY(CENTER);
    onSend(CENTER, CENTER);
  }, [onSend]);

  return (
    <View style={styles.container}>
      {/* Telemetry readout */}
      <View style={styles.telemetry}>
        <TelemetryValue label="X  Steering" value={displayX} />
        <TelemetryValue label="Y  Throttle" value={displayY} />
      </View>

      {/* Joystick */}
      <View style={styles.joystickWrap}>
        <Joystick onMove={handleMove} onRelease={handleRelease} />
      </View>
    </View>
  );
}

function TelemetryValue({
  label,
  value,
}: {
  label: string;
  value: number;
}) {
  return (
    <View style={styles.tvBox}>
      <Text style={styles.tvLabel}>{label}</Text>
      <Text style={styles.tvValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  telemetry: {
    flexDirection: 'row',
    marginBottom: 28,
    gap: 40,
  },
  tvBox: {
    alignItems: 'center',
  },
  tvLabel: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  tvValue: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  joystickWrap: {
    marginTop: 8,
  },
});
