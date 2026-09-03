/**
 * WebRTC Sender & DataChannel Manager for Camera Node
 * Handles video/audio streaming, remote commands, and remote clip transfer
 */

class WebRTCCamera {
  constructor(options = {}) {
    this.stream = options.stream;
    this.storage = options.storage;
    this.recorder = options.recorder;
    this.cameraCtrl = options.cameraCtrl;
    this.motionDetector = options.motionDetector;

    this.onConnectionStateChange = options.onConnectionStateChange || (() => {});
    this.onRemoteCommand = options.onRemoteCommand || (() => {});

    this.peerConnection = null;
    this.dataChannel = null;
    this.signaling = null;
    this.isConnected = false;
  }

  setSignaling(signaling) {
    this.signaling = signaling;
  }

  updateStream(newStream) {
    this.stream = newStream;
    if (this.peerConnection) {
      const senders = this.peerConnection.getSenders();
      const videoTrack = newStream.getVideoTracks()[0];
      const audioTrack = newStream.getAudioTracks()[0];

      senders.forEach(sender => {
        if (sender.track && sender.track.kind === 'video' && videoTrack) {
          sender.replaceTrack(videoTrack);
        } else if (sender.track && sender.track.kind === 'audio' && audioTrack) {
          sender.replaceTrack(audioTrack);
        }
      });
    }
  }

  initPeerConnection() {
    if (this.peerConnection) {
      try { this.peerConnection.close(); } catch (e) {}
    }

    console.log('[WebRTC Cam] Initializing PeerConnection');
    this.peerConnection = new RTCPeerConnection({
      iceServers: CONFIG.iceServers,
      iceCandidatePoolSize: 2
    });

    // Add local tracks
    if (this.stream) {
      this.stream.getTracks().forEach(track => {
        this.peerConnection.addTrack(track, this.stream);
      });
    }

    // Set up reliable DataChannel for commands & file transfers
    this.dataChannel = this.peerConnection.createDataChannel('control', {
      ordered: true
    });
    this._setupDataChannel(this.dataChannel);

    // ICE Candidate handler
    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate && this.signaling) {
        this.signaling.sendCandidate(event.candidate);
      }
    };

    // Connection state handler
    this.peerConnection.onconnectionstatechange = () => {
      const state = this.peerConnection.connectionState;
      console.log(`[WebRTC Cam] Connection State: ${state}`);
      this.isConnected = state === 'connected';
      this.onConnectionStateChange(state);

      if (state === 'connected') {
        this._startTelemetryLoop();
        // Send current FPS mode upon connection
        if (window.currentCamFpsMode !== undefined) {
          this.sendMessage('fpsMode', window.currentCamFpsMode);
        }
      }
    };

    // Handle renegotiation if needed
    this.peerConnection.onnegotiationneeded = async () => {
      console.log('[WebRTC Cam] Negotiation needed');
      await this.createAndSendOffer();
    };
  }

  async createAndSendOffer() {
    try {
      if (!this.peerConnection || this.peerConnection.connectionState === 'failed' || this.peerConnection.connectionState === 'closed') {
        this.initPeerConnection();
      }

      // If we already have a local offer and not yet answered, we can resend it
      if (this.peerConnection.signalingState === 'have-local-offer' && this.peerConnection.localDescription) {
        console.log('[WebRTC Cam] Resending existing offer to viewer');
        if (this.signaling) {
          this.signaling.sendOffer({
            type: this.peerConnection.localDescription.type,
            sdp: this.peerConnection.localDescription.sdp
          });
        }
        return;
      }

      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await this.peerConnection.setLocalDescription(offer);

      console.log('[WebRTC Cam] Sending offer to viewer');
      if (this.signaling) {
        this.signaling.sendOffer({
          type: this.peerConnection.localDescription.type,
          sdp: this.peerConnection.localDescription.sdp
        });
      }
    } catch (err) {
      console.error('[WebRTC Cam] Error creating offer:', err);
    }
  }

  async handleAnswer(answer) {
    try {
      if (!this.peerConnection) return;
      if (this.peerConnection.signalingState === 'stable') {
        console.log('[WebRTC Cam] PeerConnection already in stable state');
        return;
      }

      console.log('[WebRTC Cam] Setting remote description (answer)');
      await this.peerConnection.setRemoteDescription(new RTCSessionDescription(answer));

      // Flush buffered candidates
      if (this.pendingCandidates && this.pendingCandidates.length > 0) {
        console.log(`[WebRTC Cam] Flushing ${this.pendingCandidates.length} queued candidates`);
        for (const candidate of this.pendingCandidates) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
        }
        this.pendingCandidates = [];
      }
    } catch (err) {
      console.error('[WebRTC Cam] Error setting remote answer:', err);
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
      console.error('[WebRTC Cam] Error adding ICE candidate:', err);
    }
  }

  _setupDataChannel(dc) {
    dc.binaryType = 'arraybuffer';

    const onOpen = () => {
      console.log('[DataChannel] Control channel OPEN');
      this.sendNotification('Camera is online and ready.');
    };

    if (dc.readyState === 'open') {
      onOpen();
    } else {
      dc.onopen = onOpen;
    }

    dc.onclose = () => {
      console.log('[DataChannel] Control channel CLOSED');
    };

    dc.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this._handleViewerCommand(msg);
      } catch (err) {
        console.error('[DataChannel] Error parsing viewer command:', err);
      }
    };
  }

  async _handleViewerCommand(msg) {
    console.log('[DataChannel] Received command from viewer:', msg.action);
    this.onRemoteCommand(msg);

    switch (msg.action) {
      case 'toggleTorch':
        if (this.cameraCtrl) {
          const state = await this.cameraCtrl.toggleTorch(msg.enable);
          this.sendMessage('torchStatus', { isTorchOn: state });
        }
        break;

      case 'switchCamera':
        if (this.cameraCtrl) {
          if (this.motionDetector) this.motionDetector.pause(4000);
          const newStream = await this.cameraCtrl.switchCamera();
          this.updateStream(newStream);
          if (this.recorder) this.recorder.updateStream(newStream);
          this.sendMessage('cameraSwitched', { facingMode: this.cameraCtrl.currentFacingMode });
        }
        break;

      case 'setMotionSensitivity':
        if (this.motionDetector && msg.value !== undefined) {
          this.motionDetector.setSensitivity(msg.value);
          this.sendMessage('sensitivityUpdated', { value: msg.value });
        }
        break;

      case 'startRecord':
        if (this.recorder) {
          this.recorder.start('manual', msg.duration || 0);
        }
        break;

      case 'stopRecord':
        if (this.recorder) {
          this.recorder.stop();
        }
        break;

      case 'getClipsList':
        if (this.storage) {
          const clips = await this.storage.listClips();
          this.sendMessage('clipsList', { clips });
        }
        break;

      case 'deleteClip':
        if (this.storage && msg.clipId) {
          await this.storage.deleteClip(msg.clipId);
          const clips = await this.storage.listClips();
          this.sendMessage('clipsList', { clips });
        }
        break;

      case 'downloadClip':
        if (this.storage && msg.clipId) {
          // Always send via reliable P2P DataChannel if available, or try server upload
          if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this._transferClipToViewer(msg.clipId);
          } else {
            this._uploadClipToServer(msg.clipId);
          }
        }
        break;

      case 'transferClipDirect':
        if (this.storage && msg.clipId) {
          this._transferClipToViewer(msg.clipId);
        }
        break;

      case 'getSettings': {
        const settings = await this.getSettingsData();
        this.sendMessage('settingsData', settings);
        break;
      }

      case 'updateSettings': {
        if (msg.motionEnabled !== undefined && this.motionDetector) {
          this.motionDetector.setEnabled(msg.motionEnabled);
        }
        if (msg.motionSchedule !== undefined && this.motionDetector) {
          this.motionDetector.setSchedule(msg.motionSchedule);
        }
        if (msg.motionSensitivity !== undefined && this.motionDetector) {
          this.motionDetector.setSensitivity(msg.motionSensitivity);
        }
        if (msg.clipDurationSec !== undefined && this.recorder) {
          this.recorder.setMotionRecordDuration(msg.clipDurationSec);
        }
        if (msg.maxStorageMB !== undefined && this.storage) {
          this.storage.setMaxStorageMB(msg.maxStorageMB);
        }
        if (msg.autoOledEnabled !== undefined) {
          this.autoOledEnabled = !!msg.autoOledEnabled;
          window.dispatchEvent(new CustomEvent('ipcam:autoOledChange', { detail: this.autoOledEnabled }));
        }
        if (msg.autoFpsEnabled !== undefined) {
          this.autoFpsEnabled = !!msg.autoFpsEnabled;
          window.dispatchEvent(new CustomEvent('ipcam:autoFpsChange', { detail: this.autoFpsEnabled }));
        }
        try {
          const toSave = {
            motionEnabled: this.motionDetector ? this.motionDetector.isEnabled : true,
            motionSchedule: this.motionDetector ? this.motionDetector.schedule : null,
            motionSensitivity: this.motionDetector ? this.motionDetector.sensitivity : 25,
            clipDurationSec: this.recorder ? this.recorder.motionRecordDurationSec : 15,
            maxStorageMB: this.storage ? Math.round(this.storage.maxStorageBytes / (1024 * 1024)) : 500,
            autoOledEnabled: this.autoOledEnabled !== undefined ? this.autoOledEnabled : true,
            autoFpsEnabled: this.autoFpsEnabled !== undefined ? this.autoFpsEnabled : true
          };
          localStorage.setItem('ipcam_settings', JSON.stringify(toSave));
        } catch (e) {}

        const updatedSettings = await this.getSettingsData();
        this.sendMessage('settingsData', updatedSettings);
        break;
      }

      case 'clearAllClips': {
        if (this.storage) {
          await this.storage.clearAll();
          const clips = await this.storage.listClips();
          const usage = await this.storage.getStorageUsage();
          this.sendMessage('clipsList', { clips });
          this.sendMessage('storageUsage', usage);
        }
        break;
      }

      case 'getStorageUsage': {
        if (this.storage) {
          const usage = await this.storage.getStorageUsage();
          this.sendMessage('storageUsage', usage);
        }
        break;
      }
    }
  }

  setEncodingFps(fps) {
    if (!this.peerConnection) return;
    try {
      const sender = this.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        const params = sender.getParameters();
        if (params.encodings && params.encodings.length > 0) {
          params.encodings[0].maxFramerate = fps;
          sender.setParameters(params);
          console.log(`[WebRTC Cam] Dynamic encoding maxFramerate set to: ${fps}`);
        }
      }
    } catch (e) {
      console.warn('[WebRTC Cam] setEncodingFps error:', e);
    }
  }

  async getSettingsData() {
    const usage = this.storage ? await this.storage.getStorageUsage() : null;
    let autoOled = true;
    let autoFps = true;
    try {
      const saved = JSON.parse(localStorage.getItem('ipcam_settings') || '{}');
      if (saved.autoOledEnabled !== undefined) autoOled = saved.autoOledEnabled;
      if (saved.autoFpsEnabled !== undefined) autoFps = saved.autoFpsEnabled;
    } catch (e) {}

    return {
      motionEnabled: this.motionDetector ? this.motionDetector.isEnabled : true,
      motionSchedule: this.motionDetector ? this.motionDetector.schedule : { enabled: false, startTime: '22:00', endTime: '06:00' },
      motionSensitivity: this.motionDetector ? this.motionDetector.sensitivity : 25,
      clipDurationSec: this.recorder ? this.recorder.motionRecordDurationSec : 15,
      maxStorageMB: this.storage ? Math.round(this.storage.maxStorageBytes / (1024 * 1024)) : 500,
      autoOledEnabled: autoOled,
      autoFpsEnabled: autoFps,
      storageUsage: usage
    };
  }

  async _uploadClipToServer(clipId) {
    try {
      const clip = await this.storage.getClip(clipId);
      if (!clip || !clip.blob) return false;

      const room = this.signaling ? this.signaling.roomId : '';
      const res = await fetch(`/api/clip?room=${encodeURIComponent(room)}&id=${clipId}`, {
        method: 'POST',
        headers: { 'Content-Type': clip.mimeType || 'video/webm' },
        body: clip.blob
      });

      if (res.ok) {
        console.log(`[Camera] Uploaded clip #${clipId} to local server`);
        this.sendMessage('clipReady', {
          clipId: clipId,
          url: `/api/clip?room=${encodeURIComponent(room)}&id=${clipId}`
        });
        return true;
      }
      return false;
    } catch (e) {
      console.warn('[Camera] Local clip upload error:', e);
      return false;
    }
  }

  /**
   * P2P File Transfer over WebRTC DataChannel
   * Splits clip Blob into 16KB chunks and sends them reliably
   */
  async _transferClipToViewer(clipId) {
    try {
      const clip = await this.storage.getClip(clipId);
      if (!clip || !clip.blob) {
        this.sendMessage('clipTransferError', { clipId, error: 'Clip not found' });
        return;
      }

      console.log(`[DataChannel] Transferring clip #${clipId} (${formatBytes(clip.size)}) to viewer`);
      const buffer = await clip.blob.arrayBuffer();
      const chunkSize = 16 * 1024; // 16 KB chunks
      const totalChunks = Math.ceil(buffer.byteLength / chunkSize);

      // Send header
      this.sendMessage('clipTransferStart', {
        clipId: clip.id,
        size: clip.size,
        mimeType: clip.mimeType,
        totalChunks: totalChunks,
        dateStr: clip.dateStr
      });

      // Send binary chunks with backpressure handling
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, buffer.byteLength);
        const chunk = buffer.slice(start, end);

        // Wait if buffer is full
        while (this.dataChannel.bufferedAmount > 256 * 1024) {
          await new Promise(r => setTimeout(r, 20));
        }

        this.dataChannel.send(chunk);
      }

      // Send completion
      this.sendMessage('clipTransferComplete', { clipId });
      console.log(`[DataChannel] Completed transfer for clip #${clipId}`);
    } catch (err) {
      console.error('[DataChannel] File transfer failed:', err);
      this.sendMessage('clipTransferError', { clipId, error: err.message });
    }
  }

  sendMotionAlert(score) {
    this.sendMessage('motionAlert', {
      score: score,
      timestamp: Date.now()
    });
  }

  sendMessage(type, payload = {}) {
    // Send via DataChannel if open
    if (this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify({ type, payload }));
      } catch (e) {
        console.warn('[DataChannel] Send error:', e);
      }
    }
    // Also send via Signaling for instant delivery
    if (this.signaling) {
      this.signaling.send(type, payload);
    }
  }

  handleCommand(msg) {
    return this._handleViewerCommand(msg);
  }

  async setEncodingFps(fps) {
    if (!this.peerConnection) return;
    try {
      const senders = this.peerConnection.getSenders();
      const videoSender = senders.find(s => s.track && s.track.kind === 'video');
      if (videoSender) {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings.forEach(enc => {
          enc.maxFramerate = fps;
        });
        await videoSender.setParameters(params);
        console.log(`[WebRTC Cam] Encoder maxFramerate set to ${fps} FPS`);
      }
    } catch (e) {
      console.warn('[WebRTC Cam] Could not adjust encoding framerate:', e.message);
    }
  }

  sendNotification(text) {
    this.sendMessage('notification', { text, timestamp: Date.now() });
  }

  _startTelemetryLoop() {
    if (this.telemetryInterval) clearInterval(this.telemetryInterval);
    this.telemetryInterval = setInterval(async () => {
      if (!this.isConnected) {
        clearInterval(this.telemetryInterval);
        return;
      }

      let batteryLevel = null;
      let isCharging = null;
      if (navigator.getBattery) {
        try {
          const b = await navigator.getBattery();
          batteryLevel = Math.round(b.level * 100);
          isCharging = b.charging;
        } catch (e) {}
      }

      this.sendMessage('telemetry', {
        battery: batteryLevel,
        isCharging: isCharging,
        timestamp: Date.now()
      });
    }, 10000); // every 10 seconds
  }
}

window.WebRTCCamera = WebRTCCamera;
