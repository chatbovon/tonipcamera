/**
 * Hardware Camera and Device Controller
 * Ultra-low resource usage, Hardware H.264, WakeLock & Torch
 */

class CameraController {
  constructor(videoElement, callbacks = {}) {
    this.videoElement = videoElement;
    this.callbacks = {
      onStreamReady: callbacks.onStreamReady || (() => {}),
      onError: callbacks.onError || (() => {})
    };

    this.stream = null;
    this.currentFacingMode = 'environment'; // default to back camera
    this.currentResolution = '720p';
    this.isTorchOn = false;
    this.isAudioMuted = false;
    this.wakeLock = null;
  }

  async start(facingMode = 'environment', resolution = '720p') {
    this.currentFacingMode = facingMode;
    this.currentResolution = resolution;

    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
    }

    let resConfig = { width: 1280, height: 720, frameRate: 30 };
    if (typeof CONFIG !== 'undefined' && CONFIG && CONFIG.resolutions) {
      resConfig = CONFIG.resolutions[this.currentResolution] || CONFIG.resolutions['720p'] || resConfig;
    }

    const constraints = {
      video: {
        facingMode: { ideal: this.currentFacingMode },
        width: resConfig.width,
        height: resConfig.height,
        aspectRatio: { ideal: 1.7777777778 },
        frameRate: resConfig.frameRate
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    };

    try {
      this.stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.videoElement.muted = true;
      this.videoElement.defaultMuted = true;
      this.videoElement.srcObject = this.stream;
      try {
        await this.videoElement.play();
      } catch (playErr) {
        console.warn('[Camera] Autoplay was prevented, will play on user tap:', playErr);
      }

      console.log(`[Camera] Started successfully (${this.currentFacingMode}, ${this.currentResolution})`);

      // Request Screen Wake Lock so phone doesn't sleep
      await this.acquireWakeLock();

      this.callbacks.onStreamReady(this.stream);
      return this.stream;
    } catch (err) {
      console.warn('[Camera] High-res getUserMedia failed:', err.message, 'retrying with fallback...');

      // Give browser 400ms to release hardware sensor if previous tab had locked it
      await new Promise(r => setTimeout(r, 400));

      // Fallback 1: Try with only facingMode
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: this.currentFacingMode },
          audio: true
        });
        this.videoElement.muted = true;
        this.videoElement.defaultMuted = true;
        this.videoElement.srcObject = this.stream;
        try { await this.videoElement.play(); } catch (e) {}
        this.callbacks.onStreamReady(this.stream);
        return this.stream;
      } catch (e1) {
        console.warn('[Camera] Fallback 1 failed, trying pure video:true...');
      }

      // Fallback 2: Try basic video without audio constraint (in case mic was locked)
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        this.videoElement.muted = true;
        this.videoElement.defaultMuted = true;
        this.videoElement.srcObject = this.stream;
        try { await this.videoElement.play(); } catch (e) {}
        this.callbacks.onStreamReady(this.stream);
        return this.stream;
      } catch (fallbackErr) {
        this.callbacks.onError(fallbackErr);
        throw fallbackErr;
      }
    }
  }

  async switchCamera() {
    const nextFacing = this.currentFacingMode === 'environment' ? 'user' : 'environment';
    return this.start(nextFacing, this.currentResolution);
  }

  async setTargetFps(fps) {
    // Note: Do NOT call videoTrack.applyConstraints on Android Chrome here
    // because omitting width/height makes Android Camera HAL switch to 1:1 square sensor mode (1088x1088).
    // WebRTC RTCRtpSender.setParameters(maxFramerate) handles frame throttling cleanly without distortion.
    console.log(`[Camera] Target FPS requested: ${fps} (handled by WebRTC encoder)`);
  }

  async toggleTorch(forceState) {
    if (!this.stream) return false;
    const videoTrack = this.stream.getVideoTracks()[0];
    if (!videoTrack) return false;

    const targetState = forceState !== undefined ? forceState : !this.isTorchOn;

    try {
      const capabilities = videoTrack.getCapabilities ? videoTrack.getCapabilities() : {};
      if (capabilities.torch) {
        await videoTrack.applyConstraints({
          advanced: [{ torch: targetState }]
        });
        this.isTorchOn = targetState;
        console.log(`[Camera] Torch set to ${this.isTorchOn}`);
        return this.isTorchOn;
      } else {
        console.warn('[Camera] Torch not supported on this camera/browser');
        return false;
      }
    } catch (e) {
      console.warn('[Camera] Torch toggle error:', e);
      return false;
    }
  }

  toggleAudio(forceMute) {
    if (!this.stream) return;
    const audioTrack = this.stream.getAudioTracks()[0];
    if (!audioTrack) return;

    this.isAudioMuted = forceMute !== undefined ? forceMute : !this.isAudioMuted;
    audioTrack.enabled = !this.isAudioMuted;
    console.log(`[Camera] Audio enabled: ${audioTrack.enabled}`);
    return audioTrack.enabled;
  }

  async acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        if (this.wakeLock !== null) return;
        this.wakeLock = await navigator.wakeLock.request('screen');
        this.wakeLock.addEventListener('release', () => {
          console.log('[Camera] Screen Wake Lock was released');
          this.wakeLock = null;
        });
        console.log('[Camera] Screen Wake Lock active (prevents phone sleeping)');
      } catch (err) {
        console.warn('[Camera] WakeLock request failed:', err.message);
      }
    }
  }

  release() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }
}

window.CameraController = CameraController;
