/**
 * Dual-Mode Robust Signaling Client for P2P WebRTC Handshake
 * Mode 1: Fast Local LAN Relay (/api/signal) - Instant, 100% Reliable, 0 External Dependencies
 * Mode 2: Public Free MQTT Broker (over WSS) - For Internet / WAN Fallback
 */

class P2PSignaling {
  /**
   * @param {string} roomId - Room identifier (e.g. cam-1234)
   * @param {'camera' | 'viewer'} role - Role of this node
   * @param {object} callbacks - Event callbacks
   */
  constructor(roomId, role, callbacks = {}) {
    this.roomId = normalizeRoomId(roomId);
    this.role = role;
    this.callbacks = {
      onConnect: callbacks.onConnect || (() => {}),
      onDisconnect: callbacks.onDisconnect || (() => {}),
      onOffer: callbacks.onOffer || (() => {}),
      onAnswer: callbacks.onAnswer || (() => {}),
      onCandidate: callbacks.onCandidate || (() => {}),
      onPeerReady: callbacks.onPeerReady || (() => {}),
      onCustomMessage: callbacks.onCustomMessage || (() => {}),
      onError: callbacks.onError || (() => {})
    };

    // Topics for MQTT
    this.myTopic = `ipcam/${this.roomId}/${this.role}`;
    this.peerRole = this.role === 'camera' ? 'viewer' : 'camera';
    this.peerTopic = `ipcam/${this.roomId}/${this.peerRole}`;

    this.mqttClient = null;
    this.isConnected = false;
    this.localRelayActive = false;
    this.pollingTimer = null;
    this.heartbeatTimer = null;
    this.processedMsgIds = new Set();
  }

  /**
   * Start Signaling (connects to both Local Relay & MQTT)
   */
  connect() {
    console.log(`[Signaling] Starting dual-mode signaling for room: ${this.roomId}, role: ${this.role}`);

    // 1. Start Local HTTP Relay Polling
    this._startLocalRelay();

    // 2. Connect to Public MQTT Broker as secondary / WAN fallback
    this._connectMQTT();

    // 3. Periodic "Ready / Ping" Announce until P2P establishes
    this._startHeartbeat();
  }

  /* ------------------- 1. Local HTTP Relay (/api/signal) ------------------- */
  _startLocalRelay() {
    const poll = async () => {
      try {
        const res = await fetch(`/api/signal?room=${encodeURIComponent(this.roomId)}&role=${encodeURIComponent(this.role)}`, {
          cache: 'no-store'
        });

        if (res.ok) {
          if (!this.isConnected) {
            this.isConnected = true;
            this.localRelayActive = true;
            this.callbacks.onConnect();
          }

          const messages = await res.json();
          if (Array.isArray(messages)) {
            for (const msg of messages) {
              this._handleMessage(msg);
            }
          }
        }
      } catch (e) {
        // Not running on local server.py (e.g. hosted on GitHub Pages)
        this.localRelayActive = false;
      }
    };

    // Initial poll
    poll();
    // Poll every 350ms
    this.pollingTimer = setInterval(poll, 350);
  }

  /* ------------------- 2. Public MQTT Broker Fallback ------------------- */
  _connectMQTT() {
    if (typeof mqtt === 'undefined') {
      console.warn('[Signaling] MQTT library not available, relying solely on local relay.');
      return;
    }

    const brokerUrl = CONFIG.mqttBrokers[0];
    const clientId = `ipcam_${this.role}_${Math.random().toString(16).substring(2, 8)}`;

    try {
      this.mqttClient = mqtt.connect(brokerUrl, {
        clientId: clientId,
        clean: true,
        connectTimeout: 6000,
        reconnectPeriod: 3000
      });

      this.mqttClient.on('connect', () => {
        console.log(`[Signaling] Connected to MQTT broker. Subscribing to: ${this.peerTopic}`);
        if (!this.isConnected) {
          this.isConnected = true;
          this.callbacks.onConnect();
        }

        this.mqttClient.subscribe(this.peerTopic, { qos: 0 }, (err) => {
          if (!err) {
            console.log(`[Signaling] Subscribed to ${this.peerTopic}`);
            this.send('ready', { timestamp: Date.now() });
          }
        });
      });

      this.mqttClient.on('message', (topic, payload) => {
        if (topic !== this.peerTopic) return;
        try {
          const msg = JSON.parse(payload.toString());
          this._handleMessage(msg);
        } catch (e) {}
      });
    } catch (e) {
      console.warn('[Signaling] MQTT init error:', e.message);
    }
  }

  /* ------------------- 3. Heartbeat / Ready Announcer ------------------- */
  _startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Broadcast "ready" immediately and every 1.5 seconds until peer connection is stable
    this.send('ready', { timestamp: Date.now() });
    this.heartbeatTimer = setInterval(() => {
      this.send('ready', { timestamp: Date.now() });
    }, 1500);
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /* ------------------- Message Handling & Deduplication ------------------- */
  _handleMessage(msg) {
    if (!msg || !msg.type) return;

    // Deduplicate messages across Local Relay and MQTT
    if (msg.id) {
      if (this.processedMsgIds.has(msg.id)) return;
      this.processedMsgIds.add(msg.id);
      if (this.processedMsgIds.size > 200) {
        const first = this.processedMsgIds.values().next().value;
        this.processedMsgIds.delete(first);
      }
    }

    switch (msg.type) {
      case 'ready':
        this.callbacks.onPeerReady(msg.payload);
        break;
      case 'offer':
        this.callbacks.onOffer(msg.payload);
        break;
      case 'answer':
        this.callbacks.onAnswer(msg.payload);
        break;
      case 'candidate':
        this.callbacks.onCandidate(msg.payload);
        break;
      default:
        this.callbacks.onCustomMessage(msg.type, msg.payload);
        break;
    }
  }

  /**
   * Broadcast message through both Local Relay and MQTT
   */
  send(type, payload) {
    const msgId = `${this.role}_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const data = {
      id: msgId,
      room: this.roomId,
      role: this.role,
      type: type,
      payload: payload
    };

    // 1. Post to Local Relay
    fetch('/api/signal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    }).catch(() => {});

    // 2. Publish to MQTT
    if (this.mqttClient && this.mqttClient.connected) {
      try {
        this.mqttClient.publish(this.myTopic, JSON.stringify(data), { qos: 0 });
      } catch (e) {}
    }
  }

  sendOffer(sdp) {
    this.send('offer', sdp);
  }

  sendAnswer(sdp) {
    this.send('answer', sdp);
  }

  sendCandidate(candidate) {
    this.send('candidate', candidate);
  }

  disconnect() {
    this.stopHeartbeat();
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.mqttClient) {
      try { this.mqttClient.end(true); } catch (e) {}
      this.mqttClient = null;
    }
    this.isConnected = false;
  }
}

window.P2PSignaling = P2PSignaling;
