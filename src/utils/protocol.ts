/**
 * BLE protocol constants and encoding utilities for the BLEFly controller.
 *
 * Data format: 2-byte packet [X, Y] where each value is 0–255.
 * Center position = [128, 128].
 */

/** ESP32-C3 advertised device name */
export const DEVICE_NAME = 'BLEFly';

/** GATT Service UUID exposed by the robot */
export const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';

/** GATT Characteristic UUID for control data */
export const CHARACTERISTIC_UUID = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

/** Minimum interval (ms) between BLE writes — caps at ~50 Hz */
export const SEND_INTERVAL_MS = 20;

/** Neutral / center value for both axes */
export const CENTER = 128;

// ---------- helpers ----------

const BASE64_CHARS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * Encode a pair of unsigned 8-bit integers to a Base64 string.
 * We only ever send 2 bytes so a full library isn't needed.
 */
export function encodePacket(x: number, y: number): string {
  // Clamp to 0..255
  const bx = Math.max(0, Math.min(255, Math.round(x)));
  const by = Math.max(0, Math.min(255, Math.round(y)));

  // Manual base64 for 2 bytes → 4 chars (with 1 byte padding)
  //   byte0  byte1  0x00 (padding)
  //   b0>>2 | (b0&3)<<4|b1>>4 | (b1&0xF)<<2 | =
  const c0 = bx >> 2;
  const c1 = ((bx & 0x03) << 4) | (by >> 4);
  const c2 = (by & 0x0f) << 2;

  return (
    BASE64_CHARS[c0] + BASE64_CHARS[c1] + BASE64_CHARS[c2] + '='
  );
}

/**
 * Map a normalised joystick axis value (−1 … +1) to a uint8 (0 … 255).
 * -1 → 0,  0 → 128,  +1 → 255
 */
export function axisToUint8(value: number): number {
  return Math.max(0, Math.min(255, Math.round((value + 1) * 127.5)));
}
