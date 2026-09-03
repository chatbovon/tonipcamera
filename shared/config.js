/**
 * Shared Configuration & Utilities for P2P IP Camera
 * Zero-Cost & Ultra-Lightweight
 */

const CONFIG = {
  // Public STUN servers (100% Free, Zero-maintenance)
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ],

  // Free Public MQTT Brokers over WebSocket (WSS) for zero-cost signaling
  mqttBrokers: [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt'
  ],

  // Video resolution profiles
  resolutions: {
    '1080p': { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } },
    '720p':  { width: { ideal: 1280 }, height: { ideal: 720 },  frameRate: { ideal: 30, max: 30 } },
    '480p':  { width: { ideal: 640 },  height: { ideal: 480 },  frameRate: { ideal: 24, max: 30 } }
  },

  // Motion detection settings
  motion: {
    defaultSensitivity: 25,     // 1 to 100 (percentage of pixel change)
    sampleIntervalMs: 300,      // Analyze frame every 300ms (ultra-low CPU)
    sampleWidth: 64,            // Downscaled canvas width
    sampleHeight: 48,           // Downscaled canvas height
    alertCooldownMs: 5000,      // Minimum interval between repeated alert signals
    recordDurationSec: 15       // Auto-record clip length upon motion detection
  },

  // Camera-side local storage limits
  storage: {
    dbName: 'IPCameraStorage',
    storeName: 'recordings',
    maxStorageBytes: 500 * 1024 * 1024 // 500 MB circular buffer limit
  }
};

// Helper: Generate clean, memorable room ID (e.g. cam-7842)
function generateRoomId() {
  const num = Math.floor(1000 + Math.random() * 9000);
  return `cam-${num}`;
}

// Helper: Normalize Room ID (e.g. "cam 7138", "7138", "CAM-7138" -> "cam-7138")
function normalizeRoomId(id) {
  if (!id) return '';
  let clean = String(id).trim().toLowerCase().replace(/[\s_]+/g, '-');
  if (/^\d+$/.test(clean)) {
    clean = `cam-${clean}`;
  }
  return clean;
}

// Helper: Format bytes to human readable
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Helper: Format seconds to mm:ss
function formatDuration(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

// Helper: Format date
function formatDate(timestamp) {
  const d = new Date(timestamp);
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString();
}

// Export if in module environment, or expose globally in browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIG, generateRoomId, normalizeRoomId, formatBytes, formatDuration, formatDate };
} else {
  window.CONFIG = CONFIG;
  window.generateRoomId = generateRoomId;
  window.normalizeRoomId = normalizeRoomId;
  window.formatBytes = formatBytes;
  window.formatDuration = formatDuration;
  window.formatDate = formatDate;
}
