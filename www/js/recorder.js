/**
 * Video Recorder for Camera Node
 * MediaRecorder API + Auto-saving to IndexedDB
 */

class CameraRecorder {
  constructor(stream, storage, callbacks = {}) {
    this.stream = stream;
    this.storage = storage;
    this.callbacks = {
      onRecordingStart: callbacks.onRecordingStart || (() => {}),
      onRecordingStop: callbacks.onRecordingStop || (() => {}),
      onClipSaved: callbacks.onClipSaved || (() => {})
    };

    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.currentTrigger = 'manual';
    this.recordingStartTime = 0;
    this.autoStopTimer = null;
    this.motionRecordDurationSec = CONFIG.motion.recordDurationSec;

    this.supportedMimeType = this._findSupportedMimeType();
  }

  setMotionRecordDuration(sec) {
    const val = Math.max(3, Number(sec) || 15);
    this.motionRecordDurationSec = val;
    console.log(`[Recorder] Motion record duration set to: ${this.motionRecordDurationSec}s`);
  }

  _findSupportedMimeType() {
    const types = [
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=h264,opus',
      'video/webm',
      'video/mp4'
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) {
        console.log(`[Recorder] Using supported mimeType: ${type}`);
        return type;
      }
    }
    return '';
  }

  updateStream(newStream) {
    this.stream = newStream;
  }

  /**
   * Start recording a video clip
   * @param {'motion' | 'manual' | 'continuous'} trigger
   * @param {number} maxDurationSec - Optional auto-stop duration in seconds
   */
  start(trigger = 'manual', maxDurationSec = 0) {
    if (!this.stream) {
      console.warn('[Recorder] No stream available');
      return;
    }

    if (this.isRecording) {
      // If already recording due to motion and another motion arrives, extend the timer
      if (this.currentTrigger === 'motion' && trigger === 'motion' && this.autoStopTimer) {
        clearTimeout(this.autoStopTimer);
        const duration = (maxDurationSec || this.motionRecordDurationSec) * 1000;
        this.autoStopTimer = setTimeout(() => this.stop(), duration);
        console.log(`[Recorder] Motion extended recording by ${duration / 1000}s`);
      }
      return;
    }

    try {
      this.recordedChunks = [];
      this.currentTrigger = trigger;
      this.recordingStartTime = Date.now();

      const options = this.supportedMimeType ? { mimeType: this.supportedMimeType } : {};
      this.mediaRecorder = new MediaRecorder(this.stream, options);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.recordedChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const duration = (Date.now() - this.recordingStartTime) / 1000;
        const blob = new Blob(this.recordedChunks, { type: this.supportedMimeType || 'video/webm' });
        this.recordedChunks = [];
        this.isRecording = false;

        this.callbacks.onRecordingStop({ duration, size: blob.size });

        if (blob.size > 0 && this.storage) {
          try {
            const clipId = await this.storage.saveClip(blob, this.currentTrigger, duration);
            this.callbacks.onClipSaved({ id: clipId, duration, size: blob.size, trigger: this.currentTrigger });
          } catch (e) {
            console.error('[Recorder] Error saving clip to storage:', e);
          }
        }
      };

      this.mediaRecorder.start(1000); // 1-second timeslices
      this.isRecording = true;
      this.callbacks.onRecordingStart({ trigger });
      console.log(`[Recorder] Started recording (Trigger: ${trigger})`);

      // Auto-stop if duration specified
      const autoDuration = maxDurationSec || (trigger === 'motion' ? this.motionRecordDurationSec : 0);
      if (autoDuration > 0) {
        if (this.autoStopTimer) clearTimeout(this.autoStopTimer);
        this.autoStopTimer = setTimeout(() => {
          this.stop();
        }, autoDuration * 1000);
      }
    } catch (e) {
      console.error('[Recorder] Failed to start MediaRecorder:', e);
    }
  }

  /**
   * Stop recording
   */
  stop() {
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      try {
        this.mediaRecorder.stop();
        console.log('[Recorder] Stopped recording');
      } catch (e) {
        console.warn('[Recorder] Stop error:', e);
      }
    }
    this.isRecording = false;
  }
}

window.CameraRecorder = CameraRecorder;
