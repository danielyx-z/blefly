import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
  GestureResponderEvent,
} from 'react-native';
import ThrottleSlider from './ThrottleSlider';
import SteeringSlider from './SteeringSlider';
import { CENTER } from '../utils/protocol';

interface Props {
  onSend: (x: number, y: number) => void;
}

// Physical travel constants — must match the slider display components
const THROTTLE_MAX_TRAVEL = 200; // TRACK_HEIGHT(240) - KNOB_H(40)
const STEERING_MAX_TRAVEL = 212; // TRACK_WIDTH(260) - KNOB_W(48)
const SPRING_BACK_MS = 600;

interface TouchState {
  side: 'throttle' | 'steering';
  originPageX: number;
  originPageY: number;
  originValue: number;
}

export default function FlightControls({ onSend }: Props) {
  const [throttle, setThrottle] = useState(0);
  const [steering, setSteering] = useState(CENTER);

  // Refs so touch handlers never capture stale closure values
  const throttleRef = useRef(0);
  const steeringRef = useRef(CENTER);
  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;

  // Animated value for the throttle knob (enables slow spring-back)
  const throttleAnim = useRef(new Animated.Value(0)).current;
  const springRef = useRef<Animated.CompositeAnimation | null>(null);

  // All active touches keyed by identifier
  const activeTouches = useRef(new Map<number, TouchState>());

  // The midpoint X in screen coordinates that divides throttle (left) / steering (right).
  // Computed from onLayout so it's accurate regardless of device size.
  const midXRef = useRef(Dimensions.get('window').width / 2);

  const setThrottleValue = useCallback((v: number) => {
    throttleRef.current = v;
    throttleAnim.setValue(v);
    setThrottle(v);
    onSendRef.current(steeringRef.current, v);
  }, [throttleAnim]);

  const setSteeringValue = useCallback((v: number) => {
    steeringRef.current = v;
    setSteering(v);
    onSendRef.current(v, throttleRef.current);
  }, []);

  const startThrottleSpringBack = useCallback(() => {
    if (springRef.current) {
      springRef.current.stop();
      springRef.current = null;
    }
    const anim = Animated.timing(throttleAnim, {
      toValue: 0,
      duration: SPRING_BACK_MS,
      useNativeDriver: false,
    });
    springRef.current = anim;
    const listenerId = throttleAnim.addListener(({ value: v }) => {
      const rounded = Math.round(v);
      throttleRef.current = rounded;
      setThrottle(rounded);
      onSendRef.current(steeringRef.current, rounded);
    });
    anim.start(({ finished }) => {
      throttleAnim.removeListener(listenerId);
      if (finished) {
        springRef.current = null;
        throttleRef.current = 0;
        setThrottle(0);
        onSendRef.current(steeringRef.current, 0);
      }
    });
  }, [throttleAnim]);

  // ─── Single unified touch handler — sees ALL simultaneous fingers ──────────

  const handleTouchStart = useCallback((e: GestureResponderEvent) => {
    for (const touch of e.nativeEvent.changedTouches) {
      const side: 'throttle' | 'steering' =
        touch.pageX < midXRef.current ? 'throttle' : 'steering';

      if (side === 'throttle') {
        // Cancel any spring-back when the user grabs the throttle
        if (springRef.current) {
          springRef.current.stop();
          springRef.current = null;
        }
        activeTouches.current.set(touch.identifier, {
          side,
          originPageX: touch.pageX,
          originPageY: touch.pageY,
          originValue: (throttleAnim as any)._value as number,
        });
      } else {
        activeTouches.current.set(touch.identifier, {
          side,
          originPageX: touch.pageX,
          originPageY: touch.pageY,
          originValue: steeringRef.current,
        });
      }
    }
  }, [throttleAnim]);

  const handleTouchMove = useCallback((e: GestureResponderEvent) => {
    for (const touch of e.nativeEvent.changedTouches) {
      const state = activeTouches.current.get(touch.identifier);
      if (!state) continue;

      if (state.side === 'throttle') {
        // Upward drag = more throttle (dy positive = downward on screen)
        const dy = touch.pageY - state.originPageY;
        const startOffset = (1 - state.originValue / 255) * THROTTLE_MAX_TRAVEL;
        const newOffset = Math.max(0, Math.min(THROTTLE_MAX_TRAVEL, startOffset + dy));
        const v = Math.round((1 - newOffset / THROTTLE_MAX_TRAVEL) * 255);
        setThrottleValue(v);
      } else {
        const dx = touch.pageX - state.originPageX;
        const startOffset = (state.originValue / 255) * STEERING_MAX_TRAVEL;
        const newOffset = Math.max(0, Math.min(STEERING_MAX_TRAVEL, startOffset + dx));
        const v = Math.round((newOffset / STEERING_MAX_TRAVEL) * 255);
        setSteeringValue(v);
      }
    }
  }, [setThrottleValue, setSteeringValue]);

  const handleTouchEnd = useCallback((e: GestureResponderEvent) => {
    for (const touch of e.nativeEvent.changedTouches) {
      const state = activeTouches.current.get(touch.identifier);
      if (!state) continue;
      activeTouches.current.delete(touch.identifier);

      if (state.side === 'throttle') {
        // Only spring back if there's no other throttle-side touch still active
        const stillHasThrottle = Array.from(activeTouches.current.values()).some(
          (s) => s.side === 'throttle',
        );
        if (!stillHasThrottle) {
          startThrottleSpringBack();
        }
      } else {
        const stillHasSteering = Array.from(activeTouches.current.values()).some(
          (s) => s.side === 'steering',
        );
        if (!stillHasSteering) {
          steeringRef.current = CENTER;
          setSteering(CENTER);
          onSendRef.current(CENTER, throttleRef.current);
        }
      }
    }
  }, [startThrottleSpringBack]);

  const handleTouchCancel = useCallback(() => {
    activeTouches.current.clear();
    startThrottleSpringBack();
    steeringRef.current = CENTER;
    setSteering(CENTER);
    onSendRef.current(CENTER, throttleRef.current);
  }, [startThrottleSpringBack]);

  return (
    <View
      style={styles.container}
      onLayout={(e) => {
        // Compute absolute mid X: container left offset + half its width
        const { x, width } = e.nativeEvent.layout;
        midXRef.current = x + width / 2;
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Left zone — Throttle display */}
      <View style={styles.zone} pointerEvents="none">
        <ThrottleSlider animValue={throttleAnim} value={throttle} />
      </View>

      {/* Right zone — Steering display */}
      <View style={styles.zone} pointerEvents="none">
        <SteeringSlider value={steering} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
  },
  zone: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
