/*
 * BLEFly — ESP32-C3 BLE GATT Server
 *
 * Sets up a BLE peripheral with:
 *   Device name : BLEFly
 *   Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b
 *   Char    UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8
 *
 * The characteristic accepts 2-byte writes (X, Y — each 0-255).
 * Received values are printed to Serial for debugging.
 */

#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── Must match the React Native app ──────────────────────────────────
#define DEVICE_NAME        "BLEFly"
#define SERVICE_UUID       "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ── State ────────────────────────────────────────────────────────────
static bool deviceConnected    = false;
static bool prevConnected      = false;
static uint8_t lastX           = 128;
static uint8_t lastY           = 128;
static BLECharacteristic *pCharacteristic = nullptr;

// ── LED feedback (built-in LED, active HIGH on most C3 dev-kits) ────
#ifndef LED_BUILTIN
#define LED_BUILTIN 8
#endif

// ── Callbacks ────────────────────────────────────────────────────────

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *pServer) override {
    deviceConnected = true;
    digitalWrite(LED_BUILTIN, HIGH);
    Serial.println("[BLE] Client connected");
  }

  void onDisconnect(BLEServer *pServer) override {
    deviceConnected = false;
    digitalWrite(LED_BUILTIN, LOW);
    Serial.println("[BLE] Client disconnected");
  }
};

class CharCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pChar) override {
    std::string val = pChar->getValue();

    if (val.length() >= 2) {
      lastX = (uint8_t)val[0];
      lastY = (uint8_t)val[1];

      Serial.printf("[BLE] X: %3u   Y: %3u\n", lastX, lastY);

      // ── TODO: map lastX / lastY to motor / servo outputs ──
    }
  }
};

// ── Setup ────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  delay(500);            // let USB-CDC settle
  Serial.println();
  Serial.println("=============================");
  Serial.println("  BLEFly Firmware v1.0");
  Serial.println("=============================");

  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  // 1. Init BLE
  BLEDevice::init(DEVICE_NAME);
  Serial.printf("[BLE] Device name: %s\n", DEVICE_NAME);

  // 2. Create GATT server
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  // 3. Create service + characteristic
  BLEService *pService = pServer->createService(SERVICE_UUID);

  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ   |
    BLECharacteristic::PROPERTY_WRITE  |
    BLECharacteristic::PROPERTY_WRITE_NR |   // write-without-response
    BLECharacteristic::PROPERTY_NOTIFY
  );

  pCharacteristic->setCallbacks(new CharCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());

  // Set initial value to center position
  uint8_t init[2] = { 128, 128 };
  pCharacteristic->setValue(init, 2);

  // 4. Start service + advertising
  pService->start();

  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  // Helps iPhone connection latency
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);
  BLEDevice::startAdvertising();

  Serial.println("[BLE] Advertising… waiting for connection");
}

// ── Loop ─────────────────────────────────────────────────────────────

void loop() {
  // Re-start advertising after a disconnect so the phone can reconnect.
  if (!deviceConnected && prevConnected) {
    delay(500);                         // give the stack a moment
    BLEDevice::startAdvertising();
    Serial.println("[BLE] Re-advertising…");
    prevConnected = false;
  }

  if (deviceConnected && !prevConnected) {
    prevConnected = true;
  }

  delay(10);
}
