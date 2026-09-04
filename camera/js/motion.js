/**
 * Ultra-Lightweight Motion Detection Engine
 * Canvas Frame Difference Algorithm
 * Minimal CPU overhead (< 1-2%), Battery & Thermal friendly
 */

class MotionDetector {
  constructor(options = {}) {
    this.videoElement = options.videoElement;
    this.width = options.width || CONFIG.motion.sampleWidth;
    this.height = options.height || CONFIG.motion.sampleHeight;
    this.sensitivity = options.sensitivity || CONFIG.motion.defaultSensitivity; // 1 - 100
    this.intervalMs = options.intervalMs || CONFIG.motion.sampleIntervalMs;
    this.cooldownMs = options.cooldownMs || CONFIG.motion.alertCooldownMs;

    this.onMotion = options.onMotion || (() => {});
    this.onScoreUpdate = options.onScoreUpdate || (() => {});

    // Offscreen Canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });

    this.prevFrame = null;
    this.timer = null;
    this.isRunning = false;
    this.lastAlertTime = 0;
    this.soundAlertEnabled = false;
    this.pausedUntil = 0;
    this.warmUpFrames = 0;

    this.isEnabled = options.isEnabled !== undefined ? options.isEnabled : true;
    this.schedule = options.schedule || { enabled: false, startTime: '22:00', endTime: '06:00' };

    // Web Audio API for zero-asset beep sound
    this.audioCtx = null;
  }

  pause(durationMs = 2000) {
    this.pausedUntil = Date.now() + durationMs;
    this.prevFrame = null;
    this.warmUpFrames = 5; // Discard next 5 frames after unpause to let auto-exposure settle
    this.onScoreUpdate(0);
    console.log(`[Motion] Paused for ${durationMs}ms with 5 warmup frames`);
  }

  reset() {
    this.prevFrame = null;
    this.warmUpFrames = 5;
    this.onScoreUpdate(0);
  }

  setEnabled(val) {
    this.isEnabled = !!val;
    if (!this.isEnabled) {
      this.prevFrame = null;
      this.onScoreUpdate(0);
    }
    console.log(`[Motion] Enabled set to: ${this.isEnabled}`);
  }

  setSchedule(schedule) {
    if (schedule) {
      this.schedule = { ...this.schedule, ...schedule };
      console.log(`[Motion] Schedule updated:`, this.schedule);
    }
  }

  isWithinSchedule() {
    if (!this.schedule || !this.schedule.enabled) return true;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const [startH, startM] = (this.schedule.startTime || '00:00').split(':').map(Number);
    const [endH, endM] = (this.schedule.endTime || '23:59').split(':').map(Number);
    const startTotal = startH * 60 + startM;
    const endTotal = endH * 60 + endM;

    if (startTotal <= endTotal) {
      return currentMinutes >= startTotal && currentMinutes <= endTotal;
    } else {
      // Overnight (e.g. 22:00 to 06:00)
      return currentMinutes >= startTotal || currentMinutes <= endTotal;
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.prevFrame = null;
    console.log('[Motion] Detector started (Worker unthrottled loop)');

    // Use Web Worker timer so Android WebView / Chromium never throttles frame analysis when screen is off
    try {
      const blob = new Blob([
        `let timer = null;
         self.onmessage = function(e) {
           if (e.data === 'start') {
             if (timer) clearInterval(timer);
             timer = setInterval(() => self.postMessage('tick'), ${this.intervalMs});
           } else if (e.data === 'stop') {
             if (timer) { clearInterval(timer); timer = null; }
           }
         };`
      ], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      this.worker = new Worker(workerUrl);
      this.worker.onmessage = () => {
        this._analyzeFrame();
      };
      this.worker.postMessage('start');
    } catch (e) {
      console.warn('[Motion] Worker fallback to setInterval:', e);
      this.timer = setInterval(() => {
        this._analyzeFrame();
      }, this.intervalMs);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.worker) {
      try {
        this.worker.postMessage('stop');
        this.worker.terminate();
      } catch (ignored) {}
      this.worker = null;
    }
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.prevFrame = null;
    console.log('[Motion] Detector stopped');
  }

  setSensitivity(val) {
    this.sensitivity = Math.max(1, Math.min(100, Number(val)));
    console.log(`[Motion] Sensitivity set to ${this.sensitivity}%`);
  }

  setSoundAlert(enabled) {
    this.soundAlertEnabled = !!enabled;
  }

  _analyzeFrame() {
    if (!this.isRunning || !this.videoElement || this.videoElement.readyState < 2) return;

    // Check if temporarily paused (e.g. during camera switch)
    if (Date.now() < this.pausedUntil) {
      this.prevFrame = null;
      this.onScoreUpdate(0);
      return;
    }

    // Check if motion detection is disabled or outside schedule
    if (!this.isEnabled || !this.isWithinSchedule()) {
      this.prevFrame = null;
      this.onScoreUpdate(0);
      return;
    }

    // Draw downscaled frame to canvas
    this.ctx.drawImage(this.videoElement, 0, 0, this.width, this.height);
    const imgData = this.ctx.getImageData(0, 0, this.width, this.height);
    const data = imgData.data;
    const totalPixels = this.width * this.height;

    // Convert to grayscale
    const currentFrame = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      const idx = i * 4;
      // Luminance: 0.299 R + 0.587 G + 0.114 B
      currentFrame[i] = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
    }

    if (!this.prevFrame || this.warmUpFrames > 0) {
      this.prevFrame = currentFrame;
      if (this.warmUpFrames > 0) {
        this.warmUpFrames--;
        this.onScoreUpdate(0);
      }
      return;
    }

    // Calculate difference
    let changedPixels = 0;
    const pixelThreshold = 25; // Minimum grayscale delta to count as changed

    for (let i = 0; i < totalPixels; i++) {
      const diff = Math.abs(currentFrame[i] - this.prevFrame[i]);
      if (diff > pixelThreshold) {
        changedPixels++;
      }
    }

    this.prevFrame = currentFrame;

    // Motion score: percentage of pixels changed (0.0% to 100.0%)
    const score = (changedPixels / totalPixels) * 100;
    this.onScoreUpdate(score);

    // Trigger threshold: lower sensitivity means higher threshold required
    // e.g. Sensitivity 25% requires ~4% changed pixels; Sensitivity 80% requires ~1%
    const triggerThreshold = Math.max(0.5, (105 - this.sensitivity) / 18);

    if (score >= triggerThreshold) {
      const now = Date.now();
      if (now - this.lastAlertTime >= this.cooldownMs) {
        this.lastAlertTime = now;
        console.log(`[Motion] Motion Detected! Score: ${score.toFixed(1)}% (Threshold: ${triggerThreshold.toFixed(1)}%)`);

        if (this.soundAlertEnabled) {
          this._playBeep();
        }

        this.onMotion({
          score: score,
          timestamp: now
        });
      }
    }
  }

  _playBeep() {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.audioCtx = new AudioContext();
      }
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // A5
      gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(this.audioCtx.destination);
      osc.start();
      osc.stop(this.audioCtx.currentTime + 0.3);
    } catch (e) {
      console.warn('[Motion] Audio beep error:', e);
    }
  }
}

window.MotionDetector = MotionDetector;
