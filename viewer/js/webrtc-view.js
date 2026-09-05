/**
 * WebRTC Viewer (Receiver) & Remote Controller
 * Ultra-low latency, DataChannel Commands, and P2P File Receiver
 */

class WebRTCViewer {
  constructor(options = {}) {
    this.remoteVideo = options.remoteVideo;
    this.callbacks = {
      onConnectionStateChange: options.onConnectionStateChange || (() => {}),
      onMotionAlert: options.onMotionAlert || (() => {}),
      onTelemetry: options.onTelemetry || (() => {}),
      onClipsList: options.onClipsList || (() => {}),
      onClipDownloadProgress: options.onClipDownloadProgress || (() => {}),
      onClipDownloadComplete: options.onClipDownloadComplete || (() => {}),
      onRecordingStatus: options.onRecordingStatus || (() => {}),
      onClipReady: options.onClipReady || (() => {}),
      onSettingsData: options.onSettingsData || (() => {}),
      onStorageUsage: options.onStorageUsage || (() => {}),
      onFpsMode: options.onFpsMode || (() => {}),
      onTorchStatus: options.onTorchStatus || (() => {}),
      onNativeFrame: options.onNativeFrame || (() => {}),
      onLocalStreamInfo: options.onLocalStreamInfo || (() => {})
    };

    this.peerConnection = null;
    this.dataChannel = null;
    this.signaling = null;
    this.remoteStream = new MediaStream();

    // File transfer state
    this.incomingFile = null;
  }

  setSignaling(signaling) {
    this.signaling = signaling;
  }

  initPeerConnection() {
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
    }

    console.log('[WebRTC View] Initializing PeerConnection');
    this.peerConnection = new RTCPeerConnection({
      iceServers: CONFIG.iceServers,
      iceCandidatePoolSize: 2
    });

    // Handle incoming audio/video tracks
    this.peerConnection.ontrack = (event) => {
      console.log(`[WebRTC View] Received remote track: ${event.track.kind}`);
      if (event.streams && event.streams[0]) {
        this.remoteVideo.srcObject = event.streams[0];
      } else {
        this.remoteStream.addTrack(event.track);
        if (this.remoteVideo.srcObject !== this.remoteStream) {
          this.remoteVideo.srcObject = this.remoteStream;
        }
      }
      // Trigger playback
      this.remoteVideo.play().catch(e => {
        console.warn('[WebRTC View] Autoplay needs interaction:', e);
      });
    };

    // Handle incoming DataChannel opened by Camera Node
    this.peerConnection.ondatachannel = (event) => {
      console.log('[WebRTC View] Remote DataChannel received');
      this.dataChannel = event.channel;
      this._setupDataChannel(this.dataChannel);
    };

    // ICE Candidate handler
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.signaling) {
        this.signaling.sendCandidate(event.candidate);
      }
    };

    // Connection state handler
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`[WebRTC View] Connection state: ${state}`);
      this.callbacks.onConnectionStateChange(state);
    };
  }

  async handleOffer(offer) {
    try {
      if (!this.peerConnection || this.peerConnection.connectionState === 'failed' || this.peerConnection.connectionState === 'closed') {
        this.initPeerConnection();
      }

      console.log('[WebRTC View] Setting remote offer');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush queued candidates
      if (this.pendingCandidates && this.pendingCandidates.length > 0) {
        console.log(`[WebRTC View] Flushing ${this.pendingCandidates.length} queued candidates`);
        for (const candidate of this.pendingCandidates) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        this.pendingCandidates = [];
      }

      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);

      console.log('[WebRTC View] Sending answer back to camera');
      if (this.signaling) {
        this.signaling.sendAnswer({
          type: this.peerConnection.localDescription.type,
          sdp: this.peerConnection.localDescription.sdp
        });
      }
    } catch (err) {
      console.error('[WebRTC View] Error handling offer:', err);
    }
  }

  async handleCandidate(candidate) {
    try {
      if (!candidate) return;
      if (!this.peerConnection || !this.peerConnection.remoteDescription || !this.peerConnection.remoteDescription.type) {
        if (!this.pendingCandidates) this.pendingCandidates = [];
        this.pendingCandidates.push(candidate);
        return;
      }
      await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('[WebRTC View] Error adding ICE candidate:', err);
    }
  }

  _setupDataChannel(dc) {
    dc.binaryType = 'arraybuffer';

    const onOpen = () => {
      console.log('[DataChannel] Viewer connected to camera control channel');
      this.sendCommand('getClipsList');
    };

    if (dc.readyState === 'open') {
      onOpen();
    } else {
      dc.onopen = onOpen;
    }

    dc.onmessage = async (event) => {
      // Binary chunk (file transfer)
      if (event.data instanceof ArrayBuffer) {
        this._handleBinaryChunk(event.data);
        return;
      } else if (event.data instanceof Blob) {
        const buf = await event.data.arrayBuffer();
        this._handleBinaryChunk(buf);
        return;
      }

      // JSON Control/Event message
      try {
        const msg = JSON.parse(event.data);
        this._handleCameraMessage(msg);
      } catch (err) {
        console.error('[DataChannel] Parse error:', err);
      }
    };
  }

  _handleCameraMessage(msg) {
    const { type, payload } = msg;
    switch (type) {
      case 'clipReady':
        this.callbacks.onClipReady(payload);
        break;

      case 'settingsData':
        this.callbacks.onSettingsData(payload);
        break;

      case 'storageUsage':
        this.callbacks.onStorageUsage(payload);
        break;

      case 'fpsMode':
        this.callbacks.onFpsMode(payload);
        break;

      case 'motionAlert':
        this.callbacks.onMotionAlert(payload);
        break;

      case 'telemetry':
        this.callbacks.onTelemetry(payload);
        break;

      case 'recordingStatus':
        this.callbacks.onRecordingStatus(payload);
        break;

      case 'torchStatus':
        this.callbacks.onTorchStatus(payload);
        break;

      case 'nativeFrame':
        if (payload && payload.frame) {
          this.callbacks.onNativeFrame(payload.frame);
        }
        break;

      case 'localStreamInfo':
        if (payload) {
          this.callbacks.onLocalStreamInfo(payload);
        }
        break;

      case 'clipsList':
        this.callbacks.onClipsList(payload.clips || []);
        break;

      case 'clipTransferStart':
        this.incomingFile = {
          clipId: payload.clipId,
          size: payload.size,
          mimeType: payload.mimeType || 'video/webm',
          totalChunks: payload.totalChunks,
          receivedChunks: 0,
          receivedBytes: 0,
          chunks: []
        };
        console.log(`[DataChannel] Started receiving clip #${payload.clipId} (${payload.size} bytes)`);
        break;

      case 'clipTransferComplete':
        if (this.incomingFile && this.incomingFile.clipId === payload.clipId) {
          const blob = new Blob(this.incomingFile.chunks, { type: this.incomingFile.mimeType });
          console.log(`[DataChannel] Successfully downloaded clip #${payload.clipId} (${blob.size} bytes)`);
          this.callbacks.onClipDownloadComplete({
            clipId: payload.clipId,
            blob: blob
          });
          this.incomingFile = null;
        }
        break;
    }
  }

  _handleBinaryChunk(arrayBuffer) {
    if (!this.incomingFile) return;

    this.incomingFile.chunks.push(arrayBuffer);
    this.incomingFile.receivedChunks++;
    this.incomingFile.receivedBytes += arrayBuffer.byteLength;

    const progress = Math.round((this.incomingFile.receivedChunks / this.incomingFile.totalChunks) * 100);
    this.callbacks.onClipDownloadProgress({
      clipId: this.incomingFile.clipId,
      progress: progress,
      receivedBytes: this.incomingFile.receivedBytes,
      totalBytes: this.incomingFile.size
    });
  }

  sendCommand(action, params = {}) {
    // 1. Send via DataChannel if open
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        const payload = JSON.stringify({ action, ...params });
        this.dataChannel.send(payload);
      } catch (e) {
        console.warn('[DataChannel] Command send error:', e);
      }
    }
    // 2. Also send via Signaling for instant delivery
    if (this.signaling) {
      this.signaling.send('command', { action, ...params });
    }
  }

  handleMessage(type, payload) {
    this._handleCameraMessage({ type, payload });
  }

  // Remote Control Helpers
  toggleTorch(enable) {
    this.sendCommand('toggleTorch', { enable });
  }

  switchCamera() {
    this.sendCommand('switchCamera');
  }

  startRecord(duration = 0) {
    this.sendCommand('startRecord', { duration });
  }

  stopRecord() {
    this.sendCommand('stopRecord');
  }

  setSensitivity(value) {
    this.sendCommand('setMotionSensitivity', { value: Number(value) });
  }

  fetchClipsList() {
    this.sendCommand('getClipsList');
  }

  downloadClip(clipId) {
    this.sendCommand('downloadClip', { clipId: Number(clipId) });
  }

  deleteClip(clipId) {
    this.sendCommand('deleteClip', { clipId: Number(clipId) });
  }

  clearAllClips() {
    this.sendCommand('clearAllClips');
  }

  requestSettings() {
    this.sendCommand('getSettings');
  }

  updateSettings(settings) {
    this.sendCommand('updateSettings', settings);
  }

  requestStorageUsage() {
    this.sendCommand('getStorageUsage');
  }

  async getStats() {
    if (!this.peerConnection) return null;
    try {
      const stats = await this.peerConnection.getStats();
      let res = { fps: 0, bitrate: 0, resolution: '', packetLoss: 0 };

      stats.forEach(report => {
        if (report.type === 'inbound-rtp' && report.kind === 'video') {
          res.fps = report.framesPerSecond || 0;
          res.packetLoss = report.packetsLost || 0;
          if (report.frameWidth && report.frameHeight) {
            res.resolution = `${report.frameWidth}x${report.frameHeight}`;
          }
        }
      });
      return res;
    } catch (e) {
      return null;
    }
  }
}

window.WebRTCViewer = WebRTCViewer;
