import React from 'react';
import { View, StyleSheet, Text } from 'react-native';

interface Props {
  value: number;
}

const TRACK_WIDTH = 260;
const TRACK_HEIGHT = 56;
const KNOB_W = 48;
const MAX_TRAVEL = TRACK_WIDTH - KNOB_W;
const TICK_COUNT = 10;

export default function SteeringSlider({ value }: Props) {
  const signed = value - 128;
  const direction = signed < -10 ? '◂' : signed > 10 ? '▸' : '·';
  const fillWidth = (Math.abs(signed) / 128) * (TRACK_WIDTH / 2);
  const fillLeft = signed >= 0;
  const knobLeft = (value / 255) * MAX_TRAVEL;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>STEERING</Text>
      <View style={styles.trackContainer}>
        {Array.from({ length: TICK_COUNT + 1 }).map((_, i) => {
          const x = (i / TICK_COUNT) * TRACK_WIDTH;
          const isCenter = i === TICK_COUNT / 2;
          const isMajor = i % 5 === 0;
          return (
            <View
              key={i}
              style={[
                styles.tick,
                {
                  left: x,
                  height: isCenter ? 20 : isMajor ? 14 : 8,
                  opacity: isCenter ? 0.5 : isMajor ? 0.3 : 0.12,
                  bottom: isCenter ? -24 : isMajor ? -18 : -12,
                },
              ]}
            />
          );
        })}
        <View style={styles.track}>
          <View style={styles.centerMark} />
          <View
            style={[
              styles.fill,
              {
                width: fillWidth,
                left: fillLeft ? TRACK_WIDTH / 2 : TRACK_WIDTH / 2 - fillWidth,
              },
            ]}
          />
          <View style={[styles.knob, { left: knobLeft }]}>
            <View style={styles.knobLine} />
            <View style={styles.knobLine} />
          </View>
        </View>
      </View>
      <View style={styles.readout}>
        <Text style={styles.readoutDir}>{direction}</Text>
        <Text style={styles.readoutValue}>
          {signed >= 0 ? '+' : ''}{signed}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  label: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 3, marginBottom: 10 },
  trackContainer: {
    position: 'relative',
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT + 30,
    justifyContent: 'flex-start',
    alignItems: 'center',
  },
  tick: { position: 'absolute', width: 1, backgroundColor: '#fff' },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: 28,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerMark: {
    position: 'absolute',
    left: TRACK_WIDTH / 2 - 0.5,
    top: 8,
    bottom: 8,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  fill: { position: 'absolute', top: 0, bottom: 0, backgroundColor: 'rgba(90, 150, 255, 0.1)' },
  knob: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    width: KNOB_W,
    borderRadius: 24,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 3,
  },
  knobLine: { width: 2, height: 18, borderRadius: 1, backgroundColor: '#666' },
  readout: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 6 },
  readoutDir: { color: '#5a96ff', fontSize: 16 },
  readoutValue: {
    color: '#5a96ff',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
});
