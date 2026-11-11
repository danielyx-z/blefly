This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

---

## BLEFly hardware / firmware (bionic butterfly)

Expo app + ESP32 firmware + 2x wing servos. App is the BLE controller, firmware is the flight controller. Keep them in sync.

### Hardware (do not guess — this is the actual build)

- Board: Seeed XIAO ESP32-C3 (`firmware/platformio.ini` env `seeed_xiao_esp32c3`, Arduino framework).
- Servos: 2x EMAX ES08MDII only (no tail). Digital, 4.8–6V, 1520µs center, 500–2500µs range, 0.12s/60° @4.8V → saturates ~4Hz. Never power from XIAO 3V3.
- Power: 2S LiPo → buck #1 (5V) → servos, buck #2 → XIAO. COMMON GND REQUIRED across XIAO + servo buck + signal. 470µF bulk cap across servo rail near servos.
- Default pins: GPIO2 → left wing, GPIO3 → right wing (change at top of `firmware/src/main.cpp`). Built-in LED GPIO8 = BLE state.

### Firmware layout

- `firmware/src/main.cpp` — the only flight code. `firmware/S_DiY_2servo_bionic_butterfly_sinewave_LED.ino` is the AVR/PPM reference (S-DiY channel) — steal kinematics ideas only, never port blocking `delay()`/`sinf()`-per-loop patterns.
- `firmware/platformio.ini` — needs `madhephaestus/ESP32Servo@^3.0.2` (hardware LEDC @50Hz). BLE uses Arduino `BLEDevice` (NimBLE under the hood on core 3.x); keep it, don't add a second BLE lib.
- Build/flash: run from `firmware/`:
  ```bash
  pio run -e seeed_xiao_esp32c3                  # compile check, must pass before done
  pio run -e seeed_xiao_esp32c3 -t upload        # flash
  pio device monitor -b 115200                   # expect [CFG] then [FLY]/[IDLE]
  ```

### BLE protocol (must match `src/utils/protocol.ts`)

- Service `4fafc201-1fb5-459e-8fcc-c5c9c331914b`, char `beb5483e-36e1-4688-b7f5-ea07361b26a8`, device name `BLEFly`.
- 2-byte `[X, Y]` uint8, center 128. X = steer (−1…+1, + = right), Y = throttle. App joystick: screen-up = +Y = 255.
- Throttle convention: upper half only. `Y > ~138` flaps, center/low = auto-glide. Spring-joystick rest (128,128) MUST be safe glide, never mid-flap.
- `onWrite` callback must only store bytes + timestamp. No Serial/servo work there (runs in BLE task, called at ~50Hz).

### Mixer (lift-compensated turn)

```
outL = 90 + flap*ampL + bias + glideV
outR = 90 - flap*ampR + bias - glideV
ampL/R = baseAmp * (1 ± DIFF*steer)   # total lift ~constant in turns
```

- Only 6 tunables at top of `main.cpp`: `SERVO_LEFT_PIN`, `SERVO_RIGHT_PIN`, `FLAP_SIZE` (65°), `FLAP_SPEED` (3.8Hz max), `TURN` (0–1, drives diff+ Bias together), `GLIDE_V` (22° default V dihedral). Everything else is fixed internal.
- `CENTER_ANGLE` stays 90. Do NOT raise it for glide stability — the V comes from `GLIDE_V` applied mirrored. Raising center rolls the craft. More `GLIDE_V` = more roll stability + more drag (22 lively … 35 very stable).
- Loop: 200Hz kinematics (sine LUT + u16 phase accumulator, phase frozen in glide), 100Hz servo commit skipping sub-degree dither, 1Hz Serial log only. No `delay()` in hot path.
- Safety baked in: stick deadband 0.08, steer slew 2.5/s, amplitude ramp 120°/s, output slew 3°/5ms (servo-follow guard against buck brownout), 500ms stale BLE → glide, re-advertise on disconnect. LED solid = connected, blink = stale failsafe.
- Flap range 1.8–3.8Hz / 20–65° maps to ES08MDII limits; don't exceed 4Hz.
