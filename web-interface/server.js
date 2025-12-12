import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MongoClient } from "mongodb";
import os from "node:os";
import dgram from "node:dgram";

dotenv.config();

const PORT = Number(process.env.PORT || 3001);
const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "smartBag";
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 4210);
const DISCOVERY_TOKEN = process.env.DISCOVERY_TOKEN || "SMARTBAG_DISCOVER";
const DISCOVERY_RESPONSE_PREFIX = process.env.DISCOVERY_RESPONSE_PREFIX || "SMARTBAG_API=";

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const net of iface || []) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return "127.0.0.1";
}

function startDiscoveryServer() {
  const socket = dgram.createSocket("udp4");

  socket.on("error", (err) => {
    console.error("❌ UDP discovery error", err.message);
  });

  socket.on("message", (msg, rinfo) => {
    const payload = msg.toString().trim();
    if (payload !== DISCOVERY_TOKEN) {
      return;
    }

    const ip = getLocalIPv4();
    const response = `${DISCOVERY_RESPONSE_PREFIX}http://${ip}:${PORT}`;
    socket.send(response, rinfo.port, rinfo.address, (err) => {
      if (err) {
        console.error("❌ UDP send error", err.message);
      }
    });
  });

  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true);
    console.log(`📡 Discovery server listening on udp://${getLocalIPv4()}:${DISCOVERY_PORT}`);
  });

  return socket;
}

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(".")); // serve HTML/CSS/JS files

let client;
let db;

async function connectMongo() {
  if (db) return db;
  client = new MongoClient(MONGO_URI, { ignoreUndefined: true });
  await client.connect();
  db = client.db(DB_NAME);
  return db;
}

function buildHandler(collectionName) {
  return async (req, res) => {
    console.log(`📥 ${collectionName}:`, req.body);
    try {
      const database = await connectMongo();
      const collection = database.collection(collectionName);
      const doc = {
        ...req.body,
        createdAt: new Date()
      };
      await collection.insertOne(doc);
      console.log(`✅ Logged to ${collectionName}`);
      res.status(201).json({ ok: true });
    } catch (err) {
      console.error("❌ Mongo insert error", err.message);
      res.status(500).json({ ok: false, error: "db_error" });
    }
  };
}

app.post("/api/logs/rssi", buildHandler("BluetoothRSSI"));
app.post("/api/logs/gps", buildHandler("GPSLogs"));
app.post("/api/logs/poids", buildHandler("Poids"));

app.get("/health", (req, res) => res.json({ ok: true }));

const discoverySocket = startDiscoveryServer();

app.listen(PORT, () => {
  console.log(`🚀 SmartBag logger running on http://localhost:${PORT}`);
  console.log(`📊 Open http://localhost:${PORT} in your browser`);
  console.log(`💾 MongoDB: ${MONGO_URI}/${DB_NAME}`);
});

process.on("SIGINT", async () => {
  if (client) await client.close();
  if (discoverySocket) discoverySocket.close();
  process.exit(0);
});
