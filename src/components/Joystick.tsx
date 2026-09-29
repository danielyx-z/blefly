import React, { useRef, useMemo } from 'react';
import { View, PanResponder, StyleSheet } from 'react-native';

interface Props {
  /** Diameter of the outer boundary circle (default 220). */
  size?: number;
  /** Diameter of the inner thumb knob (default 70). */
  knobSize?: number;
  /** Called continuously while the user drags. Values are in −1…+1. */
  onMove: (x: number, y: number) => void;
  /** Called when the user releases the joystick. */
  onRelease: () => void;
}

export default function Joystick({
  size = 220,
  knobSize = 70,
  onMove,
  onRelease,
}: Props) {
  const radius = size / 2;
  const knobRadius = knobSize / 2;
  const maxOffset = radius - knobRadius;

  // Knob position state kept in an Animated-friendly ref for zero re-renders.
  const pos = useRef({ x: 0, y: 0 });
  const knobRef = useRef<View>(null);

  const updateKnob = (nx: number, ny: number) => {
    pos.current = { x: nx, y: ny };
    knobRef.current?.setNativeProps({
      style: {
        transform: [{ translateX: nx }, { translateY: ny }],
      },
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          // initial touch — knob stays centred until drag
        },
        onPanResponderMove: (_evt, gestureState) => {
          let { dx, dy } = gestureState;

          // Clamp to circular boundary
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > maxOffset) {
            dx = (dx / dist) * maxOffset;
            dy = (dy / dist) * maxOffset;
          }

          updateKnob(dx, dy);

          // Normalise to −1…+1
          const normX = dx / maxOffset;
          const normY = -(dy / maxOffset); // invert: screen-up = positive Y
          onMove(normX, normY);
        },
        onPanResponderRelease: () => {
          updateKnob(0, 0);
          onRelease();
        },
        onPanResponderTerminate: () => {
          updateKnob(0, 0);
          onRelease();
        },
      }),
    [maxOffset, onMove, onRelease],
  );

  return (
    <View style={[styles.outer, { width: size, height: size, borderRadius: radius }]}>
      {/* Cross-hairs (decorative) */}
      <View style={[styles.crossH, { width: size - 30, top: radius - 0.5 }]} />
      <View style={[styles.crossV, { height: size - 30, left: radius - 0.5 }]} />

      {/* Touch surface */}
      <View
        style={[styles.touchArea, { width: size, height: size }]}
        {...panResponder.panHandlers}
      >
        {/* Knob */}
        <View
          ref={knobRef}
          style={[
            styles.knob,
            {
              width: knobSize,
              height: knobSize,
              borderRadius: knobRadius,
              marginLeft: -knobRadius,
              marginTop: -knobRadius,
              left: '50%',
              top: '50%',
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    backgroundColor: '#1C1C1E',
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  crossH: {
    position: 'absolute',
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  crossV: {
    position: 'absolute',
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  touchArea: {
    position: 'absolute',
  },
  knob: {
    position: 'absolute',
    backgroundColor: '#007AFF',
    shadowColor: '#007AFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
    elevation: 8,
  },
});
