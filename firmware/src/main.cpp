/*
 * BLEFly — ESP32-C3 BLE → 2x ES08MDII bionic butterfly
 *
 * Hardware:
 *   Board : Seeed XIAO ESP32-C3
 *   Servos: 2x EMAX ES08MDII (digital, 4.8-6V, 1520us center, 500-2500us)
 *   Power : 2S LiPo → buck #1 (5V) → servos, buck #2 → XIAO.
 *           COMMON GND REQUIRED: XIAO GND + servo-buck GND + servo signal GND.
 *           470uF bulk cap across servo 5V rail near servos.
 *
 * Control:
 *   BLE 2-byte [X, Y] 0-255, center 128 (matches React Native app).
 *   X = steering (-1..+1, + = right). Y = throttle: stick UP (Y>128) flaps,
 *   stick centered/low = auto-glide. Spring joystick rest = safe glide.
 *
 * Mixer (lift-compensated turn, S-DiY kinematics improved):
 *   outL = CENTER + flap*ampL + turnBias + glideHold
 *   outR = CENTER - flap*ampR + turnBias - glideHold
 *   ampL/R = baseAmp * (1 +/- K*steer) so total lift stays ~constant in turns.
 *
 * Efficiency vs S-DiY AVR code:
 *   256-entry int16 sine LUT + u16 phase accumulator (no sinf in loop),
 *   200Hz phase tick / 100Hz servo write, no delay(), no Serial in hot path,
 *   low-pass + slew limiters instead of per-loop PPM decode + map().
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <ESP32Servo.h>
#include <math.h>

// ── BLE protocol (must match app in src/utils/protocol.ts) ─────────────
#define DEVICE_NAME         "BLEFly"
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ── TUNE THESE (everything else is fixed) ──────────────────────────────
static const int   SERVO_LEFT_PIN  = 2;    // XIAO GPIO → left wing signal
static const int   SERVO_RIGHT_PIN = 3;    // XIAO GPIO → right wing signal
static const float FLAP_SIZE   = 65.0f;    // deg, wing sweep at full throttle
static const float FLAP_SPEED  = 3.8f;     // Hz at full throttle (servo max ~4)
static const float TURN        = 0.6f;     // 0..1, turn sharpness
static const float GLIDE_V     = 0.0f;     // deg, V dihedral hold when gliding
                                           // 0 = wings flat/level at 90 (bench
                                           // neutral); 22 = doc default.
                                           // NOTE: >0 adds roll stability.

// ── BENCH MODE (put back to 0 and reflash before flying) ───────────────
//  0 = normal flight firmware (BLE + mixer)
//  1 = hold both wings dead-still at half-range (horn zeroing)
//  2 = slow sweep both servos via ESP32Servo (verify wiring/direction)
//  3 = slow sweep both servos via raw LEDC (bypasses ESP32Servo entirely)
//  4 = hold both at half-endpoint via raw LEDC (horn zeroing, lib bypassed)
#define BENCH_MODE 0
static const int HORN_ZERO_DEG = 90;  // 90 deg = 500..2500us midpoint = 1500us
static const int SWEEP_MIN_DEG = 5, SWEEP_MAX_DEG = 175;
static const uint32_t SWEEP_STEP_MS = 20;  // 1 deg / 20ms = 50 deg/s, gentle

#ifndef LED_BUILTIN
#define LED_BUILTIN 8
#endif

// ── Fixed internals (don't tune) ───────────────────────────────────────
static const int   CENTER_ANGLE = 90;      // keep at 90 — V comes from GLIDE_V
static const int   SERVO_MIN_US = 500, SERVO_MAX_US = 2500;
static const int   SERVO_MIN_DEG = 5, SERVO_MAX_DEG = 175;
static const uint32_t TICK_US = 5000, SERVO_UPDATE_US = 10000;
static const uint32_t FAILSAFE_MS = 500, LOG_MS = 1000;

static const int RAW_CH_L = 0, RAW_CH_R = 1;   // LEDC channels for mode 3
static const int RAW_RES_BITS = 14;
static const uint32_t RAW_PERIOD_US = 20000;   // 50Hz

// Degree → pulse width, same mapping ESP32Servo uses (0..180 → 500..2500us)
static int degToUs(int deg) {
  return SERVO_MIN_US + (int)lroundf(deg / 180.0f * (SERVO_MAX_US - SERVO_MIN_US));
}

// Drive both servos straight from the LEDC peripheral, bypassing ESP32Servo
static void rawWriteDeg(int deg) {
  uint32_t duty = (uint32_t)((uint64_t)(1u << RAW_RES_BITS) * degToUs(deg) / RAW_PERIOD_US);
  ledcWrite(RAW_CH_L, duty);
  ledcWrite(RAW_CH_R, duty);
}

// ── State ──────────────────────────────────────────────────────────────
static BLECharacteristic *pCharacteristic = nullptr;
static volatile bool      deviceConnected = false;
static volatile uint8_t   bleX = 128, bleY = 128;
static volatile uint32_t  lastBleMs = 0;
static bool prevConnected = false;

static Servo servoLeft, servoRight;
static int16_t SINE_LUT[256];

static uint16_t phaseAcc = 0;       // 0..65535 = 0..2π
static float steerLP   = 0.0f;      // smoothed -1..+1
static float currentAmp = 0.0f;     // slewed flap amplitude
static float glideCur   = GLIDE_V; // start in safe glide pose
static float lastOutL = CENTER_ANGLE, lastOutR = CENTER_ANGLE;
static float lastFreqHz = 0.0f, lastThr01 = 0.0f;

static uint32_t lastTickUs = 0, lastServoUs = 0, lastLogMs = 0;

// ── Helpers ────────────────────────────────────────────────────────────
static float deadband(float v, float db) {
  if (fabsf(v) < db) return 0.0f;
  return (v > 0 ? (v - db) : (v + db)) / (1.0f - db);
}

static float slewToward(float cur, float target, float maxDelta) {
  float d = target - cur;
  if (d > maxDelta) return cur + maxDelta;
  if (d < -maxDelta) return cur - maxDelta;
  return target;
}

// ── BLE callbacks (no Serial / no servo work here — hot path safe) ─────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) override {
    (void)pServer;
    deviceConnected = true;
    lastBleMs = millis();
    digitalWrite(LED_BUILTIN, HIGH);
  }
  void onDisconnect(BLEServer *pServer) override {
    (void)pServer;
    deviceConnected = false;
    digitalWrite(LED_BUILTIN, LOW);
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    std::string val = pChar->getValue();
    if (val.length() >= 2) {
      bleX = static_cast<uint8_t>(val[0]);
      bleY = static_cast<uint8_t>(val[1]);
      lastBleMs = millis();
    }
  }
};

// ── Setup ──────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("=============================");
  Serial.println("  BLEFly Butterfly v2.0");
  Serial.println("=============================");

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  // Build sine LUT once: -1000..+1000 (Q15-style int, no float in loop)
  for (int i = 0; i < 256; i++) {
    SINE_LUT[i] = (int16_t)lroundf(sinf(i * 2.0f * (float)M_PI / 256.0f) * 1000.0f);
  }

  // Servos: 50Hz (safe for ES08MDII digital), start at glide hold
#if BENCH_MODE == 3 || BENCH_MODE == 4
  // Raw LEDC sweep — no ESP32Servo, no channel allocation by the library.
  // If this moves the servos but BENCH_MODE 2 did not, the library is at fault.
  {
    double fL = ledcSetup(RAW_CH_L, 50.0, RAW_RES_BITS);
    ledcAttachPin(SERVO_LEFT_PIN, RAW_CH_L);
    double fR = ledcSetup(RAW_CH_R, 50.0, RAW_RES_BITS);
    ledcAttachPin(SERVO_RIGHT_PIN, RAW_CH_R);
    Serial.printf("[RAW] ch%d f=%.3fHz ch%d f=%.3fHz res=%dbits pinL=%d pinR=%d\n",
        RAW_CH_L, fL, RAW_CH_R, fR, RAW_RES_BITS, SERVO_LEFT_PIN, SERVO_RIGHT_PIN);
    rawWriteDeg(SWEEP_MIN_DEG);
  }
#else
  ESP32PWM::allocateTimer(0);
  servoLeft.setPeriodHertz(50);
  servoRight.setPeriodHertz(50);
  int chL = servoLeft.attach(SERVO_LEFT_PIN, SERVO_MIN_US, SERVO_MAX_US);
  int chR = servoRight.attach(SERVO_RIGHT_PIN, SERVO_MIN_US, SERVO_MAX_US);
  Serial.printf("[LIB] attach L ch=%d attached=%d w=%dus | R ch=%d attached=%d w=%dus\n",
      chL, (int)servoLeft.attached(), servoLeft.readMicroseconds(),
      chR, (int)servoRight.attached(), servoRight.readMicroseconds());
#endif
#if BENCH_MODE == 1
  servoLeft.write(HORN_ZERO_DEG);
  servoRight.write(HORN_ZERO_DEG);
  lastOutL = HORN_ZERO_DEG;
  lastOutR = HORN_ZERO_DEG;
#elif BENCH_MODE == 2
  servoLeft.write(SWEEP_MIN_DEG);
  servoRight.write(SWEEP_MIN_DEG);
  lastOutL = SWEEP_MIN_DEG;
  lastOutR = SWEEP_MIN_DEG;
#elif BENCH_MODE == 3
  rawWriteDeg(SWEEP_MIN_DEG);
  lastOutL = SWEEP_MIN_DEG;
  lastOutR = SWEEP_MIN_DEG;
#elif BENCH_MODE == 4
  rawWriteDeg(HORN_ZERO_DEG);
  lastOutL = HORN_ZERO_DEG;
  lastOutR = HORN_ZERO_DEG;
#else
  servoLeft.write(CENTER_ANGLE + (int)glideCur);
  servoRight.write(CENTER_ANGLE - (int)glideCur);
  lastOutL = CENTER_ANGLE + glideCur;
  lastOutR = CENTER_ANGLE - glideCur;
#endif

#if BENCH_MODE == 0
  // BLE GATT server
  BLEDevice::init(DEVICE_NAME);
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ |
      BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_WRITE_NR |
      BLECharacteristic::PROPERTY_NOTIFY);
  pCharacteristic->setCallbacks(new CharCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());
  uint8_t init[2] = {128, 128};
  pCharacteristic->setValue(init, 2);
  pService->start();
  BLEAdvertising *pAdv = BLEDevice::getAdvertising();
  pAdv->addServiceUUID(SERVICE_UUID);
  pAdv->setScanResponse(true);
  pAdv->setMinPreferred(0x06);
  pAdv->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();
#endif

  uint32_t now = micros();
  lastTickUs = now;
  lastServoUs = now;
  lastLogMs = millis();
#if BENCH_MODE == 1
  int zeroUs = SERVO_MIN_US + (int)lroundf(HORN_ZERO_DEG / 180.0f * (SERVO_MAX_US - SERVO_MIN_US));
  Serial.printf("[ZERO] horn zero mode — holding L=%d R=%d (%dus), BLE off\n",
      HORN_ZERO_DEG, HORN_ZERO_DEG, zeroUs);
  digitalWrite(LED_BUILTIN, HIGH);
#elif BENCH_MODE == 2
  Serial.printf("[SWEEP] L=D0/GPIO%d R=D1/GPIO%d — %d..%d deg, %lums/deg, BLE off\n",
      SERVO_LEFT_PIN, SERVO_RIGHT_PIN, SWEEP_MIN_DEG, SWEEP_MAX_DEG,
      (unsigned long)SWEEP_STEP_MS);
  digitalWrite(LED_BUILTIN, HIGH);
#elif BENCH_MODE == 3
  Serial.printf("[RAW] LEDC sweep L=GPIO%d ch%d R=GPIO%d ch%d %d..%d deg — BLE off\n",
      SERVO_LEFT_PIN, RAW_CH_L, SERVO_RIGHT_PIN, RAW_CH_R,
      SWEEP_MIN_DEG, SWEEP_MAX_DEG);
  digitalWrite(LED_BUILTIN, HIGH);
#elif BENCH_MODE == 4
  Serial.printf("[HOLD] raw LEDC L=GPIO%d R=GPIO%d at %d deg (%dus) — BLE off\n",
      SERVO_LEFT_PIN, SERVO_RIGHT_PIN, HORN_ZERO_DEG, degToUs(HORN_ZERO_DEG));
  digitalWrite(LED_BUILTIN, HIGH);
#else
  Serial.printf("[CFG] L=%d R=%d size=%.0f speed=%.1f turn=%.1f glideV=%.0f\n",
      SERVO_LEFT_PIN, SERVO_RIGHT_PIN, FLAP_SIZE, FLAP_SPEED, TURN, GLIDE_V);
  Serial.println("[BLE] Advertising…");
#endif
}

// ── 200Hz kinematics tick ──────────────────────────────────────────────
static float tickSteerTarget, tickThr01;  // shared tick→servo snapshot
static float tickOutL, tickOutR;

static void kinematicsTick(float dt) {
  uint8_t x = bleX, y = bleY;  // single snapshot of volatile state
  uint32_t nowMs = millis();
  bool stale = !deviceConnected || (nowMs - lastBleMs > FAILSAFE_MS);

  // Fixed feel constants (were tunables, now baked in)
  const float DB = 0.08f;            // stick deadband
  const float AMP_MIN = FLAP_SIZE * 0.3f;
  const float HZ_MIN = 1.8f;
  const float DIFF = 0.9f * TURN;    // differential amplitude
  const float BIAS = 20.0f * TURN;   // roll bias, deg

  float steerRaw = ((float)x - 128.0f) / 127.5f;
  float yNorm    = ((float)y - 128.0f) / 127.5f;
  float steerT = stale ? 0.0f : deadband(steerRaw, DB);
  float thr01  = stale ? 0.0f : constrain((yNorm - DB) / (1.0f - DB), 0.0f, 1.0f);

  // Slew-limit steering (BLE jitter + snap-turn guard)
  steerLP = slewToward(steerLP, steerT, 2.5f * dt);
  // Reduce turn authority when barely flapping (no snap on ground/glide)
  float eff = steerLP * (0.35f + 0.65f * thr01);

  // Amplitude / glide targets with ramp (smooth flap↔glide transitions)
  float targetAmp   = (thr01 <= 0.001f) ? 0.0f : AMP_MIN + thr01 * (FLAP_SIZE - AMP_MIN);
  float targetGlide = (thr01 <= 0.001f) ? GLIDE_V : 0.0f;
  currentAmp = slewToward(currentAmp, targetAmp, 120.0f * dt);
  glideCur   = slewToward(glideCur, targetGlide, 120.0f * dt);

  // Phase advance: inc = freq * 65536 * dt
  float freq = HZ_MIN + thr01 * (FLAP_SPEED - HZ_MIN);
  if (thr01 <= 0.001f) freq = 0;  // hold phase in glide (no drift)
  else phaseAcc += (uint16_t)(freq * 65536.0f * dt);
  lastFreqHz = (thr01 <= 0.001f) ? 0.0f : freq;
  lastThr01 = thr01;

  int16_t s = SINE_LUT[phaseAcc >> 8];  // -1000..1000
  float flap = (float)s / 1000.0f;

  // Lift-compensated differential: total amplitude ~constant in turns
  float scaleL = constrain(1.0f + DIFF * eff, 0.3f, 1.25f);
  float scaleR = constrain(1.0f - DIFF * eff, 0.3f, 1.25f);
  float bias = BIAS * eff;

  float desL = CENTER_ANGLE + flap * currentAmp * scaleL + bias + glideCur;
  float desR = CENTER_ANGLE - flap * currentAmp * scaleR + bias - glideCur;

  desL = constrain(desL, (float)SERVO_MIN_DEG, (float)SERVO_MAX_DEG);
  desR = constrain(desR, (float)SERVO_MIN_DEG, (float)SERVO_MAX_DEG);

  // Output slew guard: never command faster than the ES08MDII can follow
  // (cuts current spikes / buck brownout on 2S setup).
  // 8 deg/tick at 200Hz = 1600 deg/s. Full throttle needs
  // 2*pi*3.8Hz*65deg = 1548 deg/s, so 3.0 (600 deg/s) used to clip the flap
  // to ~+/-25 deg. Do not raise further without checking buck #1 headroom.
  tickOutL = slewToward(lastOutL, desL, 8.0f);
  tickOutR = slewToward(lastOutR, desR, 8.0f);
  tickSteerTarget = steerT;
  tickThr01 = thr01;
}

// ── Loop ───────────────────────────────────────────────────────────────
void loop() {
#if BENCH_MODE == 1 || BENCH_MODE == 4
  // hold mode: re-assert the midpoint once a second (free) and heartbeat so
  // the bench operator can tell the board is alive and holding
  static uint32_t lastHb = 0;
  uint32_t m = millis();
  if (m - lastHb >= 1000) {
    lastHb = m;
#if BENCH_MODE == 4
    rawWriteDeg(HORN_ZERO_DEG);
    Serial.printf("[HOLD] L=%d R=%d (%dus) — no BLE, no mixer\n",
        HORN_ZERO_DEG, HORN_ZERO_DEG, degToUs(HORN_ZERO_DEG));
#else
    Serial.printf("[ZERO] holding L=%d R=%d (%dus) — no BLE, no mixer\n",
        HORN_ZERO_DEG, HORN_ZERO_DEG, degToUs(HORN_ZERO_DEG));
#endif
  }
  return;
#elif BENCH_MODE == 2 || BENCH_MODE == 3
  // sweep mode: 1 deg / 20ms there and back, both servos in lockstep
  static uint32_t lastStep = 0;
  static int deg = SWEEP_MIN_DEG;
  static int dir = 1;
  uint32_t m = millis();
  if (m - lastStep >= SWEEP_STEP_MS) {
    lastStep = m;
    deg += dir;
    if (deg >= SWEEP_MAX_DEG) { deg = SWEEP_MAX_DEG; dir = -1; }
    else if (deg <= SWEEP_MIN_DEG) { deg = SWEEP_MIN_DEG; dir = 1; }
#if BENCH_MODE == 3
    rawWriteDeg(deg);
    const char *tag = "RAW";
#else
    servoLeft.write(deg);
    servoRight.write(deg);
    const char *tag = "SWEEP";
#endif
    lastOutL = deg;
    lastOutR = deg;
    if (deg % 10 == 0) Serial.printf("[%s] L:%d R:%d (%dus)\n", tag, deg, deg, degToUs(deg));
  }
  return;
#endif
  uint32_t nowUs = micros();

  // 200Hz kinematics
  if (nowUs - lastTickUs >= TICK_US) {
    float dt = (nowUs - lastTickUs) / 1000000.0f;
    if (dt > 0.05f) dt = 0.05f;  // clamp after BLE-blocked stalls
    lastTickUs = nowUs;
    kinematicsTick(dt);
  }

  // 100Hz servo commit (skip sub-degree dither)
  if (nowUs - lastServoUs >= SERVO_UPDATE_US) {
    lastServoUs = nowUs;
    int wL = (int)lroundf(tickOutL);
    int wR = (int)lroundf(tickOutR);
    if (abs(wL - (int)lroundf(lastOutL)) >= 1) { servoLeft.write(wL); lastOutL = wL; }
    if (abs(wR - (int)lroundf(lastOutR)) >= 1) { servoRight.write(wR); lastOutR = wR; }
  }

  // Re-advertise after disconnect so the phone can reconnect
  if (!deviceConnected && prevConnected) {
    delay(200);
    BLEDevice::startAdvertising();
    prevConnected = false;
  }
  if (deviceConnected && !prevConnected) prevConnected = true;

  // 1Hz status (only Serial in the whole loop)
  uint32_t nowMs = millis();
  if (nowMs - lastLogMs >= LOG_MS) {
    lastLogMs = nowMs;
    if (deviceConnected)
      Serial.printf("[FLY] X:%3u Y:%3u thr:%.2f st:%.2f f:%.1fHz L:%.0f R:%.0f\n",
          bleX, bleY, tickThr01, steerLP, lastFreqHz, lastOutL, lastOutR);
    else
      Serial.printf("[IDLE] no BLE — glide hold L:%.0f R:%.0f\n", lastOutL, lastOutR);
    // Failsafe blink when stale but BLE object still "connected"
    if (deviceConnected && (nowMs - lastBleMs > FAILSAFE_MS))
      digitalWrite(LED_BUILTIN, (nowMs / 250) & 1);
    else if (deviceConnected)
      digitalWrite(LED_BUILTIN, HIGH);
  }
}
