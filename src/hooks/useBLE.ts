import { useCallback, useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import {
  DEVICE_NAME,
  SERVICE_UUID,
  CHARACTERISTIC_UUID,
  SEND_INTERVAL_MS,
  encodePacket,
  CENTER,
} from '../utils/protocol';

// ---------- types ----------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected';

interface UseBLEReturn {
  status: ConnectionStatus;
  /** Start scanning + connecting. Handles permissions automatically. */
  connect: () => void;
  /** Tear down connection. */
  disconnect: () => void;
  /** Send a throttled 2-byte packet. Only writes if values changed. */
  sendXY: (x: number, y: number) => void;
}

// ---------- singleton BLE manager ----------

let manager: BleManager | null = null;
function getManager(): BleManager {
  if (!manager) {
    manager = new BleManager();
  }
  return manager;
}

// ---------- hook ----------

export function useBLE(): UseBLEReturn {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const deviceRef = useRef<Device | null>(null);
  const charRef = useRef<Characteristic | null>(null);

  // Throttle state — kept in refs so the hot-path avoids re-renders.
  const lastSentRef = useRef<{ x: number; y: number }>({ x: CENTER, y: CENTER });
  const lastSendTimeRef = useRef<number>(0);
  const pendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- Android permission request ----
  const requestPermissions = useCallback(async () => {
    if (Platform.OS !== 'android') return true;

    const apiLevel = Platform.Version;

    if (apiLevel >= 31) {
      // Android 12+
      const results = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ]);
      return Object.values(results).every(
        (r) => r === PermissionsAndroid.RESULTS.GRANTED,
      );
    } else {
      // Android 11 and below
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      );
      return result === PermissionsAndroid.RESULTS.GRANTED;
    }
  }, []);

  // ---- connect ----
  const connect = useCallback(async () => {
    if (status !== 'disconnected') return;

    const ble = getManager();

    const granted = await requestPermissions();
    if (!granted) {
      console.warn('[BLE] permissions not granted');
      return;
    }

    setStatus('connecting');

    // Ensure the Bluetooth adapter is powered on.
    const state = await ble.state();
    if (state !== 'PoweredOn') {
      // Wait for PoweredOn (user may be toggling BT).
      await new Promise<void>((resolve) => {
        const sub = ble.onStateChange((s) => {
          if (s === 'PoweredOn') {
            sub.remove();
            resolve();
          }
        }, true);
      });
    }

    // Scan for device by name
    ble.startDeviceScan(
      [SERVICE_UUID],
      { allowDuplicates: false },
      async (error, scannedDevice) => {
        if (error) {
          console.error('[BLE] scan error', error);
          setStatus('disconnected');
          return;
        }

        if (
          scannedDevice &&
          (scannedDevice.name === DEVICE_NAME ||
            scannedDevice.localName === DEVICE_NAME)
        ) {
          ble.stopDeviceScan();

          try {
            const connected = await scannedDevice.connect({
              requestMTU: 23,
            });
            const discovered =
              await connected.discoverAllServicesAndCharacteristics();
            deviceRef.current = discovered;

            // Grab the characteristic reference for writes
            const chars = await discovered.characteristicsForService(
              SERVICE_UUID,
            );
            const target = chars.find(
              (c) =>
                c.uuid.toLowerCase() === CHARACTERISTIC_UUID.toLowerCase(),
            );
            if (!target) {
              throw new Error(
                `Characteristic ${CHARACTERISTIC_UUID} not found`,
              );
            }
            charRef.current = target;

            // Listen for disconnects
            discovered.onDisconnected(() => {
              deviceRef.current = null;
              charRef.current = null;
              setStatus('disconnected');
            });

            setStatus('connected');
          } catch (e) {
            console.error('[BLE] connection error', e);
            setStatus('disconnected');
          }
        }
      },
    );
  }, [status, requestPermissions]);

  // ---- disconnect ----
  const disconnect = useCallback(async () => {
    if (pendingTimerRef.current) {
      clearTimeout(pendingTimerRef.current);
      pendingTimerRef.current = null;
    }

    const dev = deviceRef.current;
    if (dev) {
      try {
        await dev.cancelConnection();
      } catch {
        // already disconnected — ignore
      }
    }
    deviceRef.current = null;
    charRef.current = null;
    setStatus('disconnected');
  }, []);

  // ---- throttled send ----
  const doSend = useCallback((x: number, y: number) => {
    const char = charRef.current;
    if (!char) return;

    lastSentRef.current = { x, y };
    lastSendTimeRef.current = Date.now();

    const payload = encodePacket(x, y);
    char
      .writeWithoutResponse(payload)
      .catch((e: unknown) => console.warn('[BLE] write error', e));
  }, []);

  const sendXY = useCallback(
    (x: number, y: number) => {
      const { x: lx, y: ly } = lastSentRef.current;
      if (x === lx && y === ly) return; // no change

      const now = Date.now();
      const elapsed = now - lastSendTimeRef.current;

      if (elapsed >= SEND_INTERVAL_MS) {
        // Enough time has passed — send immediately.
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        doSend(x, y);
      } else if (!pendingTimerRef.current) {
        // Schedule a deferred send so final position is never lost.
        const delay = SEND_INTERVAL_MS - elapsed;
        pendingTimerRef.current = setTimeout(() => {
          pendingTimerRef.current = null;
          doSend(x, y);
        }, delay);
      }
    },
    [doSend],
  );

  // ---- cleanup on unmount ----
  useEffect(() => {
    return () => {
      if (pendingTimerRef.current) clearTimeout(pendingTimerRef.current);
      const dev = deviceRef.current;
      if (dev) {
        dev.cancelConnection().catch(() => {});
      }
    };
  }, []);

  return { status, connect, disconnect, sendXY };
}
