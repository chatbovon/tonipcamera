/**
 * Camera Node Main Application Logic
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Elements
  const camVideo = document.getElementById('camVideo');
  const roomIdText = document.getElementById('roomIdText');
  const statusBadge = document.getElementById('statusBadge');
  const recTag = document.getElementById('recTag');
  const recTimer = document.getElementById('recTimer');
  const motionScoreVal = document.getElementById('motionScoreVal');
  const motionThresholdVal = document.getElementById('motionThresholdVal');
  const meterFill = document.getElementById('meterFill');
  const thresholdMarker = document.getElementById('thresholdMarker');

  // Controls
  const btnFlipCam = document.getElementById('btnFlipCam');
  const btnTorch = document.getElementById('btnTorch');
  const btnRecord = document.getElementById('btnRecord');
  const recordBtnText = document.getElementById('recordBtnText');
  const btnOledMode = document.getElementById('btnOledMode');
  const oledOverlay = document.getElementById('oledOverlay');
  const oledClock = document.getElementById('oledClock');
  const btnMotionSound = document.getElementById('btnMotionSound');
  const soundText = document.getElementById('soundText');
  const btnSensModal = document.getElementById('btnSensModal');
  const sensModal = document.getElementById('sensModal');
  const btnCloseSens = document.getElementById('btnCloseSens');
  const sensSlider = document.getElementById('sensSlider');
  const sliderValText = document.getElementById('sliderValText');

  // Modals
  const btnRoomQr = document.getElementById('btnRoomQr');
  const btnShareModal = document.getElementById('btnShareModal');
  const qrModal = document.getElementById('qrModal');
  const btnCloseQr = document.getElementById('btnCloseQr');
  const modalRoomId = document.getElementById('modalRoomId');
  const btnCopyLink = document.getElementById('btnCopyLink');
  const qrcodeContainer = document.getElementById('qrcode');

  const btnClipsModal = document.getElementById('btnClipsModal');
  const clipsModal = document.getElementById('clipsModal');
  const btnCloseClips = document.getElementById('btnCloseClips');
  const clipsList = document.getElementById('clipsList');
  const clipsCount = document.getElementById('clipsCount');
  const btnClearAllClips = document.getElementById('btnClearAllClips');

  const btnSettingsModal = document.getElementById('btnSettingsModal');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const chkCamMotionEnabled = document.getElementById('chkCamMotionEnabled');
  const txtCamMotionStatus = document.getElementById('txtCamMotionStatus');
  const camSensSlider = document.getElementById('camSensSlider');
  const camSensValText = document.getElementById('camSensValText');
  const chkCamSchedule = document.getElementById('chkCamSchedule');
  const camTimeStart = document.getElementById('camTimeStart');
  const camTimeEnd = document.getElementById('camTimeEnd');
  const camDurationMin = document.getElementById('camDurationMin');
  const camDurationSec = document.getElementById('camDurationSec');
  const camMaxStorageMB = document.getElementById('camMaxStorageMB');
  const camStorageText = document.getElementById('camStorageText');
  const camStoragePercent = document.getElementById('camStoragePercent');
  const camStorageProgressFill = document.getElementById('camStorageProgressFill');
  const btnCamClearAllSettings = document.getElementById('btnCamClearAllSettings');
  const btnCamSaveSettings = document.getElementById('btnCamSaveSettings');

  // 1. Determine or generate Room ID
  const urlParams = new URLSearchParams(window.location.search);
  let roomId = urlParams.get('room');
  if (!roomId) {
    roomId = generateRoomId();
  }
  roomId = normalizeRoomId(roomId);
  const newUrl = `${window.location.pathname}?room=${roomId}`;
  window.history.replaceState(null, '', newUrl);

  roomIdText.textContent = roomId;
  modalRoomId.textContent = roomId;

  // 2. Initialize Camera-Side Local Storage (IndexedDB)
  const storage = new CameraStorage();
  try {
    await storage.init();
    console.log('[App] Storage initialized');
  } catch (e) {
    console.error('[App] Storage init failed:', e);
  }

  // 3. Initialize Camera Hardware Controller
  let cameraStream = null;
  const cameraCtrl = new CameraController(camVideo, {
    onStreamReady: (stream) => {
      cameraStream = stream;
      if (recorder) recorder.updateStream(stream);
      if (webrtcCam) webrtcCam.updateStream(stream);
      if (motionDetector) {
        motionDetector.pause(3500); // Generous pause while new sensor stabilizes
      }
    },
    onError: (err) => {
      console.error('[App] Camera error:', err);
      showVideoPlaceholder('แตะที่นี่เพื่อเปิดกล้องอีกครั้ง<br><small>(' + (err.message || 'Permission/Device Error') + ')</small>');
    }
  });

  function showVideoPlaceholder(htmlText) {
    let overlay = document.getElementById('camRetryOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'camRetryOverlay';
      overlay.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.8);color:#58a6ff;text-align:center;cursor:pointer;padding:16px;font-size:0.95rem;z-index:10;';
      overlay.addEventListener('click', async () => {
        overlay.innerHTML = 'กำลังเปิดกล้อง...';
        await startCameraWithRetry();
      });
      camVideo.parentElement.appendChild(overlay);
    }
    overlay.innerHTML = htmlText;
    overlay.style.display = 'flex';
  }

  function hideVideoPlaceholder() {
    const overlay = document.getElementById('camRetryOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  const camNativePreview = document.getElementById('camNativePreview');
  const isCapacitor = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const NativeCam = isCapacitor && window.Capacitor.Plugins ? window.Capacitor.Plugins.NativeCam : null;

  async function startCameraWithRetry() {
    try {
      // Ensure element autoplay requirements in WebView
      camVideo.muted = true;
      camVideo.defaultMuted = true;
      camVideo.setAttribute('playsinline', '');
      camVideo.setAttribute('autoplay', '');
      camVideo.setAttribute('muted', '');

      cameraStream = await cameraCtrl.start('environment', '720p');
      if (camNativePreview) camNativePreview.style.display = 'none';
      camVideo.style.display = 'block';
      hideVideoPlaceholder();
      return true;
    } catch (e) {
      console.warn('[App] Start camera initial attempt failed:', e);
      const errMsg = e && (e.name || e.message) ? ` (${e.name || e.message})` : '';
      showVideoPlaceholder(`แตะเพื่อลองเปิดกล้องใหม่<br><small>โปรดอนุญาตสิทธิ์กล้องในเครื่อง${errMsg}</small>`);
      return false;
    }
  }

  // When video plays (either first start or after flip), give sensor 2.5s to settle auto-exposure
  camVideo.addEventListener('playing', () => {
    console.log('[Camera] Video playing/switched -> stabilizing sensor');
    hideVideoPlaceholder();
    if (motionDetector) {
      motionDetector.pause(2500);
    }
  });

  // Clicking/tapping video element retries starting the camera if stopped or paused
  camVideo.parentElement.addEventListener('click', async (e) => {
    if (e.target.closest('#camRetryOverlay')) return;
    if (!cameraStream || !cameraStream.active || camVideo.paused) {
      console.log('[App] Video clicked while not playing, attempting restart...');
      await startCameraWithRetry();
    }
  });

  // Listen for native permission grant event from Android MainActivity
  window.addEventListener('cameraPermissionGranted', async () => {
    console.log('[App] cameraPermissionGranted event received, starting camera...');
    await startCameraWithRetry();
  });

  // Initial camera start
  await startCameraWithRetry();

  // 4. Initialize Local Video Recorder
  let recTickerInterval = null;
  let recStartTime = 0;

  const recorder = new CameraRecorder(cameraStream, storage, {
    onRecordingStart: ({ trigger }) => {
      recTag.classList.add('active');
      btnRecord.classList.add('active');
      recordBtnText.textContent = 'หยุดอัด';
      recStartTime = Date.now();
      if (recTickerInterval) clearInterval(recTickerInterval);
      recTickerInterval = setInterval(() => {
        const sec = Math.floor((Date.now() - recStartTime) / 1000);
        recTimer.textContent = formatDuration(sec);
      }, 1000);

      if (webrtcCam) {
        webrtcCam.sendMessage('recordingStatus', { isRecording: true, trigger });
      }
    },
    onRecordingStop: ({ duration, size }) => {
      recTag.classList.remove('active');
      btnRecord.classList.remove('active');
      recordBtnText.textContent = 'บันทึก';
      recTimer.textContent = '00:00';
      if (recTickerInterval) {
        clearInterval(recTickerInterval);
        recTickerInterval = null;
      }

      if (webrtcCam) {
        webrtcCam.sendMessage('recordingStatus', { isRecording: false, duration, size });
      }
    },
    onClipSaved: ({ id, duration, size, trigger }) => {
      console.log(`[App] New clip saved: #${id}`);
      if (clipsModal.classList.contains('active')) {
        loadClipsUI();
      }
    }
  });

  // 5. Initialize Motion Detector (Canvas Frame Difference)
  const motionDetector = new MotionDetector({
    videoElement: camVideo,
    sensitivity: 25,
    onScoreUpdate: (score) => {
      motionScoreVal.textContent = score.toFixed(1);
      meterFill.style.width = Math.min(100, score * 3) + '%';
    },
    onMotion: ({ score, timestamp }) => {
      console.log('[App] Motion Event detected!');
      // Wake to high FPS immediately on motion
      wakeToHighFps();
      // 1. Notify remote viewer
      if (webrtcCam) {
        webrtcCam.sendMotionAlert(score);
      }
      // 2. Auto-record clip on camera device
      recorder.start('motion', CONFIG.motion.recordDurationSec);
    }
  });
  motionDetector.start();

  // Eco Mode State
  let autoOledEnabled = true;
  let autoFpsEnabled = true;
  let isLowFps = false;
  let lastMotionTime = Date.now();

  function wakeToHighFps() {
    lastMotionTime = Date.now();
    if (isLowFps && autoFpsEnabled) {
      isLowFps = false;
      window.currentCamFpsMode = { isLowFps: false, fps: 30 };
      cameraCtrl.setTargetFps(30);
      if (webrtcCam) {
        webrtcCam.setEncodingFps(30);
        webrtcCam.sendMessage('fpsMode', window.currentCamFpsMode);
      }
      console.log('[Eco] Motion detected -> FPS ramped up to 30');
    }
  }

  function throttleToLowFps() {
    if (!isLowFps && autoFpsEnabled) {
      isLowFps = true;
      window.currentCamFpsMode = { isLowFps: true, fps: 10 };
      cameraCtrl.setTargetFps(10);
      if (webrtcCam) {
        webrtcCam.setEncodingFps(10);
        webrtcCam.sendMessage('fpsMode', window.currentCamFpsMode);
      }
      console.log('[Eco] No motion for 15s -> Throttled FPS down to 10 for cooling');
    }
  }

  // Restore saved settings from localStorage
  try {
    const saved = JSON.parse(localStorage.getItem('ipcam_settings') || '{}');
    if (saved.motionEnabled !== undefined) motionDetector.setEnabled(saved.motionEnabled);
    if (saved.motionSchedule) motionDetector.setSchedule(saved.motionSchedule);
    if (saved.motionSensitivity) {
      motionDetector.setSensitivity(saved.motionSensitivity);
      motionThresholdVal.textContent = saved.motionSensitivity;
      thresholdMarker.style.left = saved.motionSensitivity + '%';
    }
    if (saved.clipDurationSec) recorder.setMotionRecordDuration(saved.clipDurationSec);
    if (saved.maxStorageMB) storage.setMaxStorageMB(saved.maxStorageMB);
    if (saved.autoOledEnabled !== undefined) autoOledEnabled = saved.autoOledEnabled;
    if (saved.autoFpsEnabled !== undefined) autoFpsEnabled = saved.autoFpsEnabled;
  } catch (e) {}

  window.addEventListener('ipcam:autoOledChange', (e) => {
    autoOledEnabled = !!e.detail;
    console.log('[Eco] autoOledEnabled changed via remote:', autoOledEnabled);
  });
  window.addEventListener('ipcam:autoFpsChange', (e) => {
    autoFpsEnabled = !!e.detail;
    console.log('[Eco] autoFpsEnabled changed via remote:', autoFpsEnabled);
    if (!autoFpsEnabled && isLowFps) wakeToHighFps();
  });

  // User touch/click/input resets the inactivity timer
  ['touchstart', 'mousedown', 'pointerdown', 'input', 'change'].forEach(ev => {
    window.addEventListener(ev, () => {
      lastMotionTime = Date.now();
    }, { passive: true });
  });

  // Re-acquire WakeLock if screen is unlocked or app is brought back to focus
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      await cameraCtrl.acquireWakeLock();
    }
  });

  // 6. Initialize WebRTC Cam Sender
  const webrtcCam = new WebRTCCamera({
    stream: cameraStream,
    storage: storage,
    recorder: recorder,
    cameraCtrl: cameraCtrl,
    motionDetector: motionDetector,
    onConnectionStateChange: (state) => {
      statusBadge.className = 'status-badge';
      if (state === 'connected') {
        statusBadge.classList.add('status-connected');
        statusBadge.textContent = 'กำลังสตรีม P2P';
        if (signaling) signaling.stopHeartbeat();
      } else if (state === 'connecting') {
        statusBadge.classList.add('status-signaling');
        statusBadge.textContent = 'กำลังเชื่อม P2P...';
      } else {
        statusBadge.classList.add('status-disconnected');
        statusBadge.textContent = 'รอผู้ชมเข้าห้อง';
      }
    },
    onRemoteCommand: (msg) => {
      if (msg.action === 'toggleTorch') {
        if (NativeCam) {
          NativeCam.toggleTorch().then(r => btnTorch.classList.toggle('active', r.isTorchOn));
        } else {
          btnTorch.classList.toggle('active', cameraCtrl.isTorchOn);
        }
      } else if (msg.action === 'switchCamera') {
        cameraCtrl.switchCamera().catch(e => console.warn('[App] Remote switchCamera err:', e));
      }
    }
  });

  // 6.1 Screen state handlers for continuous streaming on power press / screen off
  window.addEventListener('ipcam:screenOff', () => {
    console.log('[App] Screen OFF event -> activating OLED black screen mode');
    activateOledMode();
  });
  window.addEventListener('ipcam:screenOn', () => {
    console.log('[App] Screen ON event -> deactivating OLED mode');
    deactivateOledMode();
  });

  // 7. Initialize P2P Signaling via Free MQTT Broker
  const signaling = new P2PSignaling(roomId, 'camera', {
    onConnect: () => {
      console.log('[App] Signaling connected to MQTT broker');
      statusBadge.textContent = 'พร้อมจับคู่';
    },
    onPeerReady: async () => {
      console.log('[App] Viewer is ready! Creating WebRTC offer...');
      statusBadge.textContent = 'พบจอมอนิเตอร์...';
      await webrtcCam.createAndSendOffer();
    },
    onAnswer: async (answer) => {
      console.log('[App] Received answer from viewer');
      await webrtcCam.handleAnswer(answer);
    },
    onCandidate: async (candidate) => {
      await webrtcCam.handleCandidate(candidate);
    },
    onCustomMessage: (type, payload) => {
      if (type === 'command') {
        webrtcCam.handleCommand(payload);
      }
    },
    onDisconnect: () => {
      console.log('[App] Signaling disconnected');
      statusBadge.className = 'status-badge status-disconnected';
      statusBadge.textContent = 'สัญญาณหลุด';
    }
  });

  webrtcCam.setSignaling(signaling);
  signaling.connect();

  // 8. Generate QR Code for Viewer
  const viewerUrl = isCapacitor
    ? `https://chatbovon.github.io/tonipcamera/viewer/?room=${roomId}`
    : `${window.location.origin}${window.location.pathname.replace('/camera/', '/viewer/')}?room=${roomId}`;
  let qrCodeObj = null;

  function renderQrCode() {
    if (!qrCodeObj && window.QRCode) {
      qrcodeContainer.innerHTML = '';
      qrCodeObj = new QRCode(qrcodeContainer, {
        text: viewerUrl,
        width: 180,
        height: 180,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    }
  }

  // 9. UI Event Listeners
  btnFlipCam.addEventListener('click', async () => {
    btnFlipCam.disabled = true;
    motionDetector.pause(4000); // Mute motion false alarm while switching camera
    try {
      await cameraCtrl.switchCamera();
    } catch (e) {
      console.warn('[Camera] Flip failed:', e);
    } finally {
      btnFlipCam.disabled = false;
    }
  });

  btnTorch.addEventListener('click', async () => {
    if (NativeCam && typeof NativeCam.toggleTorch === 'function') {
      try {
        const res = await NativeCam.toggleTorch();
        btnTorch.classList.toggle('active', res.isTorchOn);
        if (webrtcCam) webrtcCam.sendMessage('torchStatus', { isTorchOn: res.isTorchOn });
        return;
      } catch (e) {
        console.warn('[Torch] Native torch failed, fallback to cameraCtrl:', e);
      }
    }
    const state = await cameraCtrl.toggleTorch();
    btnTorch.classList.toggle('active', state);
    if (webrtcCam) webrtcCam.sendMessage('torchStatus', { isTorchOn: state });
  });

  btnRecord.addEventListener('click', () => {
    if (recorder.isRecording) {
      recorder.stop();
    } else {
      recorder.start('manual');
    }
  });

  // OLED True Black Screen Off Mode Functions
  const oledWakeHint = document.getElementById('oledWakeHint');
  let lastTapTime = 0;
  let wakeHintTimer = null;

  function activateOledMode() {
    if (oledOverlay.classList.contains('active')) return;
    oledOverlay.classList.add('active');
    if (oledWakeHint) oledWakeHint.classList.remove('show');
    if (NativeCam && typeof NativeCam.setScreenBrightness === 'function') {
      NativeCam.setScreenBrightness({ brightness: 0.001 }).catch(() => {});
    }
  }

  function deactivateOledMode() {
    oledOverlay.classList.remove('active');
    if (oledWakeHint) oledWakeHint.classList.remove('show');
    if (wakeHintTimer) {
      clearTimeout(wakeHintTimer);
      wakeHintTimer = null;
    }
    lastMotionTime = Date.now();
    if (NativeCam && typeof NativeCam.restoreScreenBrightness === 'function') {
      NativeCam.restoreScreenBrightness().catch(() => {});
    }
  }

  window.activateOledMode = activateOledMode;
  window.deactivateOledMode = deactivateOledMode;

  btnOledMode.addEventListener('click', activateOledMode);

  // Double-tap anywhere to wake screen (prevents accidental unlock in pockets or hands)
  oledOverlay.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    const diff = now - lastTapTime;

    if (diff > 50 && diff < 400) {
      // Valid Double Tap -> Wake Screen
      deactivateOledMode();
      lastTapTime = 0;
    } else {
      // Single tap -> Briefly show dim hint then fade out
      lastTapTime = now;
      if (oledWakeHint) {
        oledWakeHint.classList.add('show');
        if (wakeHintTimer) clearTimeout(wakeHintTimer);
        wakeHintTimer = setTimeout(() => {
          oledWakeHint.classList.remove('show');
        }, 1500);
      }
    }
  });

  // 1-Second Background Eco Monitor (15s Inactivity -> Screen Sleep + 10 FPS)
  setInterval(() => {
    const now = Date.now();
    const elapsedSeconds = (now - lastMotionTime) / 1000;

    // Check if any modal dialog is currently open
    const anyModalOpen = (settingsModal && settingsModal.classList.contains('active')) ||
                         (clipsModal && clipsModal.classList.contains('active')) ||
                         (qrModal && qrModal.classList.contains('active'));

    // Never sleep screen or throttle if user is interacting with any modal/settings
    if (anyModalOpen) {
      lastMotionTime = now;
      return;
    }

    // Only sleep after 15 seconds of no user activity / motion
    if (elapsedSeconds >= 15) {
      // 1. Auto Screen Off (OLED)
      if (autoOledEnabled && !oledOverlay.classList.contains('active')) {
        activateOledMode();
      }

      // 2. Auto Dynamic FPS Drop (10 FPS)
      if (autoFpsEnabled && !isLowFps) {
        throttleToLowFps();
      }
    }
  }, 1000);

  // Motion Alarm Sound toggle
  btnMotionSound.addEventListener('click', () => {
    const next = !motionDetector.soundAlertEnabled;
    motionDetector.setSoundAlert(next);
    btnMotionSound.classList.toggle('active', next);
    soundText.textContent = next ? 'เสียง: เปิด' : 'เสียงเตือน';
  });

  async function updateCamStorageUI() {
    const usage = await storage.getStorageUsage();
    const str = `${usage.formattedTotal} / ${usage.formattedMax}`;
    if (camStorageText) camStorageText.textContent = str;
    if (camStoragePercent) camStoragePercent.textContent = `${usage.percent}%`;
    if (camStorageProgressFill) camStorageProgressFill.style.width = `${usage.percent}%`;

    const camClipsStorageText = document.getElementById('camClipsStorageText');
    const camClipsStoragePercent = document.getElementById('camClipsStoragePercent');
    const camClipsStorageProgressFill = document.getElementById('camClipsStorageProgressFill');
    if (camClipsStorageText) camClipsStorageText.textContent = str;
    if (camClipsStoragePercent) camClipsStoragePercent.textContent = `${usage.percent}%`;
    if (camClipsStorageProgressFill) camClipsStorageProgressFill.style.width = `${usage.percent}%`;
  }

  if (btnSettingsModal) {
    btnSettingsModal.addEventListener('click', async () => {
      settingsModal.classList.add('active');
      chkCamMotionEnabled.checked = motionDetector.isEnabled;
      txtCamMotionStatus.textContent = motionDetector.isEnabled ? 'เปิด' : 'ปิด';
      camSensSlider.value = motionDetector.sensitivity;
      camSensValText.textContent = motionDetector.sensitivity + '%';
      chkCamSchedule.checked = !!(motionDetector.schedule && motionDetector.schedule.enabled);
      camTimeStart.value = (motionDetector.schedule && motionDetector.schedule.startTime) || '22:00';
      camTimeEnd.value = (motionDetector.schedule && motionDetector.schedule.endTime) || '06:00';
      const dur = recorder.motionRecordDurationSec || 15;
      camDurationMin.value = Math.floor(dur / 60);
      camDurationSec.value = dur % 60;
      camMaxStorageMB.value = Math.round(storage.maxStorageBytes / (1024 * 1024));
      const chkCamAutoOled = document.getElementById('chkCamAutoOled');
      const chkCamAutoFps = document.getElementById('chkCamAutoFps');
      if (chkCamAutoOled) chkCamAutoOled.checked = autoOledEnabled;
      if (chkCamAutoFps) chkCamAutoFps.checked = autoFpsEnabled;
      await updateCamStorageUI();
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
  }

  if (chkCamMotionEnabled) {
    chkCamMotionEnabled.addEventListener('change', () => {
      txtCamMotionStatus.textContent = chkCamMotionEnabled.checked ? 'เปิด' : 'ปิด';
    });
  }

  if (camSensSlider) {
    camSensSlider.addEventListener('input', (e) => {
      camSensValText.textContent = e.target.value + '%';
      motionThresholdVal.textContent = e.target.value;
      thresholdMarker.style.left = e.target.value + '%';
    });
  }

  if (btnCamSaveSettings) {
    btnCamSaveSettings.addEventListener('click', async () => {
      const min = Math.max(0, Number(camDurationMin.value) || 0);
      const sec = Math.max(0, Number(camDurationSec.value) || 0);
      const totalSec = Math.max(3, (min * 60) + sec);
      const sens = Number(camSensSlider.value);
      const maxMb = Math.max(50, Number(camMaxStorageMB.value) || 500);

      const chkCamAutoOled = document.getElementById('chkCamAutoOled');
      const chkCamAutoFps = document.getElementById('chkCamAutoFps');
      if (chkCamAutoOled) autoOledEnabled = chkCamAutoOled.checked;
      if (chkCamAutoFps) {
        autoFpsEnabled = chkCamAutoFps.checked;
        if (!autoFpsEnabled && isLowFps) wakeToHighFps();
      }

      motionDetector.setEnabled(chkCamMotionEnabled.checked);
      motionDetector.setSensitivity(sens);
      motionDetector.setSchedule({
        enabled: chkCamSchedule.checked,
        startTime: camTimeStart.value || '22:00',
        endTime: camTimeEnd.value || '06:00'
      });
      recorder.setMotionRecordDuration(totalSec);
      storage.setMaxStorageMB(maxMb);

      try {
        const toSave = {
          motionEnabled: chkCamMotionEnabled.checked,
          motionSchedule: motionDetector.schedule,
          motionSensitivity: sens,
          clipDurationSec: totalSec,
          maxStorageMB: maxMb,
          autoOledEnabled: autoOledEnabled,
          autoFpsEnabled: autoFpsEnabled
        };
        localStorage.setItem('ipcam_settings', JSON.stringify(toSave));
      } catch (e) {}

      btnCamSaveSettings.textContent = '✅ บันทึกแล้ว!';
      setTimeout(() => {
        btnCamSaveSettings.textContent = '💾 บันทึกการตั้งค่า';
        settingsModal.classList.remove('active');
      }, 1000);

      if (webrtcCam) {
        const updated = await webrtcCam.getSettingsData();
        webrtcCam.sendMessage('settingsData', updated);
      }
    });
  }

  if (btnCamClearAllSettings) {
    btnCamClearAllSettings.addEventListener('click', async () => {
      if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบทุกคลิปในเครื่องกล้องนี้?')) {
        await storage.clearAll();
        await updateCamStorageUI();
        if (webrtcCam) {
          const clips = await storage.listClips();
          const usage = await storage.getStorageUsage();
          webrtcCam.sendMessage('clipsList', { clips });
          webrtcCam.sendMessage('storageUsage', usage);
        }
      }
    });
  }

  // QR Modal
  const openQr = () => {
    renderQrCode();
    qrModal.classList.add('active');
  };
  btnRoomQr.addEventListener('click', openQr);
  btnShareModal.addEventListener('click', openQr);
  btnCloseQr.addEventListener('click', () => qrModal.classList.remove('active'));

  btnCopyLink.addEventListener('click', () => {
    navigator.clipboard.writeText(viewerUrl).then(() => {
      btnCopyLink.textContent = '✅ คัดลอกสำเร็จแล้ว!';
      setTimeout(() => btnCopyLink.textContent = '📋 คัดลอกลิงก์สำหรับเปิดดู', 2000);
    });
  });

  // Clips Storage Modal
  btnClipsModal.addEventListener('click', () => {
    clipsModal.classList.add('active');
    loadClipsUI();
  });
  btnCloseClips.addEventListener('click', () => clipsModal.classList.remove('active'));

  async function loadClipsUI() {
    await updateCamStorageUI();
    clipsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 10px;">กำลังโหลดคลิป...</div>';
    const clips = await storage.listClips();
    clipsCount.textContent = clips.length;

    if (clips.length === 0) {
      clipsList.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;">ยังไม่มีคลิปที่บันทึก</div>';
      return;
    }

    clipsList.innerHTML = '';
    clips.forEach(clip => {
      const item = document.createElement('div');
      item.className = 'clip-item';
      item.innerHTML = `
        <div class="clip-info">
          <div class="clip-title">
            <span>${clip.trigger === 'motion' ? '⚡ Motion' : '🔴 Manual'}</span>
            <span>#${clip.id}</span>
          </div>
          <div class="clip-sub">${clip.dateStr} • ${clip.formattedDuration} • ${clip.formattedSize}</div>
        </div>
        <div class="clip-actions">
          <button class="btn-icon btn-play" title="เปิดดู">▶</button>
          <button class="btn-icon btn-dl" title="ดาวน์โหลด">⬇</button>
          <button class="btn-icon btn-del" style="color: var(--accent-red);" title="ลบ">🗑</button>
        </div>
      `;

      item.querySelector('.btn-play').addEventListener('click', async () => {
        const fullClip = await storage.getClip(clip.id);
        if (fullClip && fullClip.blob) {
          const url = URL.createObjectURL(fullClip.blob);
          window.open(url, '_blank');
        }
      });

      item.querySelector('.btn-dl').addEventListener('click', async () => {
        const fullClip = await storage.getClip(clip.id);
        if (fullClip && fullClip.blob) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(fullClip.blob);
          a.download = `camera_clip_${clip.id}_${clip.timestamp}.webm`;
          a.click();
        }
      });

      item.querySelector('.btn-del').addEventListener('click', async () => {
        if (confirm(`ยืนยันการลบคลิป #${clip.id}?`)) {
          await storage.deleteClip(clip.id);
          loadClipsUI();
        }
      });

      clipsList.appendChild(item);
    });
  }

  btnClearAllClips.addEventListener('click', async () => {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการลบทุกคลิปในเครื่องกล้องนี้?')) {
      await storage.clearAll();
      loadClipsUI();
    }
  });

  // Close modals on outside click
  [qrModal, settingsModal, clipsModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }
  });
});
