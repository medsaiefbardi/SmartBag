// ==============================
// SMART BAG IOT — VERSION ESP32
// ==============================

#include <WiFi.h>
#include <WiFiUdp.h>
#include <HTTPClient.h>
#include <cstring>

// --- Réseau Wi-Fi ---


// Découverte automatique de l'API (via UDP broadcast)
const uint16_t DISCOVERY_PORT = 4210;
const char* DISCOVERY_REQUEST = "SMARTBAG_DISCOVER";
const char* DISCOVERY_RESPONSE_PREFIX = "SMARTBAG_API=";
const unsigned long DISCOVERY_TIMEOUT_MS = 3000;
const unsigned long DISCOVERY_RETRY_MS = 5000;

const char* API_BASE_URL_OVERRIDE = ""; // laisser vide pour auto
String apiBaseUrl = "";
unsigned long lastDiscoveryAttempt = 0;
WiFiUDP udp;
bool udpReady = false;

const char* ENDPOINT_POIDS = "/api/logs/poids";
const char* ENDPOINT_GPS = "/api/logs/gps";
const char* ENDPOINT_RSSI = "/api/logs/rssi";

// --- Capteur de poids simulé ---
const int PIN_POIDS = 34; // Potentiomètre = capteur de poids
const int POIDS_REF = 2000; 
const int TOLERANCE = 150;

// --- LED alerte ---
const int PIN_LED = 14;

// --- Buzzer anti-vol ---
const int PIN_BUZZER = 12;

// --- GPS simulé ---
float latitude = 36.8000;
float longitude = 10.1800;

// --- Simulation Bluetooth pour système anti-oubli ---
int rssi = -40;         // Bonne connexion (proche)
int seuil_oubli = -70;  // En dessous → sac trop loin

// --- Cadence d'envoi HTTP ---
const unsigned long TELEMETRY_PERIOD_MS = 5000;
unsigned long lastTelemetrySent = 0;

bool ensureWifiConnected() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }

  Serial.print("[WiFi] Connexion à ");
  Serial.println(WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("[WiFi] Connecté, IP = ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("[WiFi] Échec de connexion");
  return false;
}

bool ensureUdpSocket() {
  if (udpReady) {
    return true;
  }
  if (udp.begin(0)) {
    udpReady = true;
    return true;
  }
  Serial.println("[DISCOVERY] Impossible d'ouvrir le socket UDP");
  return false;
}

bool discoverApiBaseUrl() {
  if (!ensureWifiConnected() || !ensureUdpSocket()) {
    return false;
  }

  IPAddress target = WiFi.broadcastIP();
  if (target == IPAddress(0, 0, 0, 0)) {
    target = IPAddress(255, 255, 255, 255);
  }

  Serial.print("[DISCOVERY] Broadcast vers ");
  Serial.println(target);

  udp.beginPacket(target, DISCOVERY_PORT);
  udp.write((const uint8_t*)DISCOVERY_REQUEST, strlen(DISCOVERY_REQUEST));
  udp.endPacket();

  unsigned long start = millis();
  while (millis() - start < DISCOVERY_TIMEOUT_MS) {
    int size = udp.parsePacket();
    if (size > 0) {
      char buffer[128];
      int len = udp.read(buffer, sizeof(buffer) - 1);
      buffer[len] = '\0';
      String response = String(buffer);
      if (response.startsWith(DISCOVERY_RESPONSE_PREFIX)) {
        apiBaseUrl = response.substring(strlen(DISCOVERY_RESPONSE_PREFIX));
        Serial.print("[DISCOVERY] API trouvée : ");
        Serial.println(apiBaseUrl);
        return true;
      }
    }
    delay(50);
  }

  Serial.println("[DISCOVERY] Aucun serveur détecté");
  return false;
}

bool ensureApiBaseUrl() {
  if (apiBaseUrl.length() > 0) {
    return true;
  }

  if (strlen(API_BASE_URL_OVERRIDE) > 0) {
    apiBaseUrl = String(API_BASE_URL_OVERRIDE);
    Serial.print("[API] Utilisation override : ");
    Serial.println(apiBaseUrl);
    return true;
  }

  unsigned long now = millis();
  if (now - lastDiscoveryAttempt < DISCOVERY_RETRY_MS) {
    return false;
  }

  lastDiscoveryAttempt = now;
  return discoverApiBaseUrl();
}

bool postJson(const char* endpoint, const String& payload) {
  if (!ensureWifiConnected()) {
    return false;
  }

  if (!ensureApiBaseUrl()) {
    Serial.println("[HTTP] API non résolue, on réessaiera plus tard");
    return false;
  }

  HTTPClient http;
  String url = apiBaseUrl + endpoint;
  http.begin(url);
  http.addHeader("Content-Type", "application/json");

  Serial.print("[HTTP] POST ");
  Serial.println(url);
  Serial.print("[HTTP] Payload: ");
  Serial.println(payload);

  int code = http.POST(payload);
  if (code <= 0) {
    Serial.printf("[HTTP] Erreur envoi (%d)\n", code);
    http.end();
    return false;
  }

  Serial.printf("[HTTP] Réponse %d\n", code);
  http.end();
  return code < 400;
}

void publishTelemetry(int poidsActuel, int ecart) {
  unsigned long now = millis();
  if (now - lastTelemetrySent < TELEMETRY_PERIOD_MS) {
    return; // Limite la fréquence des POST
  }

  lastTelemetrySent = now;

  String poidsPayload =
    String("{\"poidsActuel\":") + poidsActuel +
    ",\"poidsRef\":" + POIDS_REF +
    ",\"ecart\":" + ecart +
    ",\"alerte\":" + (ecart > TOLERANCE ? "true" : "false") + "}";
  postJson(ENDPOINT_POIDS, poidsPayload);

  String gpsPayload =
    String("{\"latitude\":") + String(latitude, 6) +
    ",\"longitude\":" + String(longitude, 6) +
    ",\"source\":\"esp32\"}";
  postJson(ENDPOINT_GPS, gpsPayload);

  String rssiPayload =
    String("{\"rssi\":") + rssi +
    ",\"seuil\":" + seuil_oubli +
    ",\"alerte\":" + (rssi < seuil_oubli ? "true" : "false") + "}";
  postJson(ENDPOINT_RSSI, rssiPayload);
}

void setup() {
  Serial.begin(115200);

  pinMode(PIN_LED, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  ensureWifiConnected();
  // Empêche la pile HTTP d'utiliser de vieilles connexions
  WiFi.setAutoReconnect(true);
  ensureApiBaseUrl();

  Serial.println("=== SMART BAG ESP32 DEMARRE ===");
}

void loop() {

  // ======================
  // PARTIE 1 : DETECTION POIDS
  // ======================

  int poidsActuel = analogRead(PIN_POIDS);

  int ecart = abs(poidsActuel - POIDS_REF);

  if (ecart > TOLERANCE) {
    digitalWrite(PIN_LED, HIGH);
    Serial.println("[ALERTE OBJET] : objet oublie / poids incoherent");
  } else {
    digitalWrite(PIN_LED, LOW);
    Serial.println("[OK] Contenu detecte");
  }

  // ======================
  // PARTIE 2 : GPS SIMULE
  // ======================

  Serial.print("[GPS] LAT = ");
  Serial.print(latitude, 6);
  Serial.print(" | LNG = ");
  Serial.println(longitude, 6);

  // Simulation d’un mouvement
  latitude += 0.0001;
  longitude += 0.0001;

  // ======================
  // PARTIE 3 : ANTI-VOL
  // ======================

  // Si le sac "bouge" = GPS change → alarme
  if (latitude > 36.8015) {  
    digitalWrite(PIN_BUZZER, HIGH);
    Serial.println("[ALERTE VOL] : mouvement suspect detecte !");
  } else {
    digitalWrite(PIN_BUZZER, LOW);
  }

  // ======================
// PARTIE 4 : ANTI-OUBLI BLUETOOTH
// ======================

// On simule un éloignement progressif du smartphone
rssi -= 1;

Serial.print("[BLUETOOTH] RSSI = ");
Serial.println(rssi);

if (rssi < seuil_oubli) {
  Serial.println("[ALERTE : SAC OUBLIE] Bluetooth hors de portée !");
  digitalWrite(PIN_BUZZER, HIGH);
  digitalWrite(PIN_LED, HIGH);
} else {
  // Si pas oublié → LED et buzzer contrôlés normalement
}

  publishTelemetry(poidsActuel, ecart);

  Serial.println("------------------------------------------");
  delay(1500);
}
