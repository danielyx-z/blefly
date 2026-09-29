import React, { useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  Animated,
} from 'react-native';

interface Props {
  /** Animated.Value 0–255 driven by FlightControls */
  animValue: Animated.Value;
  /** Numeric value for the % readout */
  value: number;
}

const TRACK_HEIGHT = 240;
const TRACK_WIDTH = 56;
const KNOB_H = 40;
const MAX_TRAVEL = TRACK_HEIGHT - KNOB_H;
const TICK_COUNT = 10;

export default function ThrottleSlider({ animValue, value }: Props) {
  const pct = Math.round((value / 255) * 100);

  const animKnobTop = animValue.interpolate({
    inputRange: [0, 255],
    outputRange: [MAX_TRAVEL, 0],
    extrapolate: 'clamp',
  });
  const animFillHeight = animValue.interpolate({
    inputRange: [0, 255],
    outputRange: [0, TRACK_HEIGHT],
    extrapolate: 'clamp',
  });

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>THR</Text>
      <View style={styles.trackContainer}>
        {Array.from({ length: TICK_COUNT + 1 }).map((_, i) => {
          const y = (i / TICK_COUNT) * TRACK_HEIGHT;
          const isMajor = i % 5 === 0;
          return (
            <View
              key={i}
              style={[
                styles.tick,
                {
                  top: y,
                  width: isMajor ? 18 : 10,
                  opacity: isMajor ? 0.35 : 0.15,
                  left: isMajor ? -20 : -14,
                },
              ]}
            />
          );
        })}
        <View style={styles.track}>
          <Animated.View style={[styles.fill, { height: animFillHeight, bottom: 0 }]} />
          <Animated.View style={[styles.knob, { top: animKnobTop }]}>
            <View style={styles.knobLine} />
            <View style={styles.knobLine} />
          </Animated.View>
        </View>
      </View>
      <View style={styles.readout}>
        <Text style={styles.readoutValue}>{pct}</Text>
        <Text style={styles.readoutUnit}>%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', justifyContent: 'center' },
  label: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 3, marginBottom: 10 },
  trackContainer: {
    position: 'relative',
    height: TRACK_HEIGHT,
    width: TRACK_WIDTH + 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: { position: 'absolute', height: 1, backgroundColor: '#fff' },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: 28,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderRadius: 28,
    backgroundColor: 'rgba(80, 200, 120, 0.12)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(80, 200, 120, 0.3)',
  },
  knob: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: KNOB_H,
    borderRadius: 20,
    backgroundColor: '#2a2a2a',
    borderWidth: 1,
    borderColor: '#444',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 3,
  },
  knobLine: { width: 18, height: 2, borderRadius: 1, backgroundColor: '#666' },
  readout: { flexDirection: 'row', alignItems: 'baseline', marginTop: 12 },
  readoutValue: {
    color: '#50c878',
    fontSize: 22,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  readoutUnit: { color: '#3a7a4f', fontSize: 13, fontWeight: '600', marginLeft: 2 },
});
