/**
 * Viewer Main Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const inputRoomId = document.getElementById('inputRoomId');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const statusBadge = document.getElementById('statusBadge');
  const remoteVideo = document.getElementById('remoteVideo');
  const remoteCanvas = document.getElementById('remoteCanvas');
  const videoPlaceholder = document.getElementById('videoPlaceholder');
  const hintRoomId = document.getElementById('hintRoomId');
  const osdRecTag = document.getElementById('osdRecTag');
  const statBattery = document.getElementById('statBattery');
  const statRes = document.getElementById('statRes');
  const statFps = document.getElementById('statFps');
  const motionAlertBanner = document.getElementById('motionAlertBanner');

  // Controls
  const btnRemoteTorch = document.getElementById('btnRemoteTorch');
  const btnRemoteFlip = document.getElementById('btnRemoteFlip');
  const btnRemoteRecord = document.getElementById('btnRemoteRecord');
  const remoteRecText = document.getElementById('remoteRecText');
  const btnRemoteSens = document.getElementById('btnRemoteSens');
  const btnSnapshot = document.getElementById('btnSnapshot');
  const btnLocalRecord = document.getElementById('btnLocalRecord');
  const localRecText = document.getElementById('localRecText');
  const btnBrowseClips = document.getElementById('btnBrowseClips');
  const clipsBadge = document.getElementById('clipsBadge');
  const btnFullscreen = document.getElementById('btnFullscreen');

  // Modals
  const clipsModal = document.getElementById('clipsModal');
  const btnCloseClips = document.getElementById('btnCloseClips');
  const remoteClipsList = document.getElementById('remoteClipsList');
  const btnRefreshClips = document.getElementById('btnRefreshClips');
  const downloadProgressBar = document.getElementById('downloadProgressBar');
  const dlProgressFill = document.getElementById('dlProgressFill');
  const dlPercentText = document.getElementById('dlPercentText');

  const sensModal = document.getElementById('sensModal');
  const btnCloseSens = document.getElementById('btnCloseSens');
  const viewSensSlider = document.getElementById('viewSensSlider');
  const viewSensVal = document.getElementById('viewSensVal');
  const btnApplySens = document.getElementById('btnApplySens');

  const playbackModal = document.getElementById('playbackModal');
  const btnClosePlayback = document.getElementById('btnClosePlayback');
  const playbackVideo = document.getElementById('playbackVideo');

  // 1. Determine Room ID
  const urlParams = new URLSearchParams(window.location.search);
  let currentRoomId = urlParams.get('room') || '';

  if (currentRoomId) {
    inputRoomId.value = currentRoomId;
    hintRoomId.textContent = currentRoomId;
  }

  // Audio Context for Motion Chime
  let audioCtx = null;
  function playAlertChime() {
    try {
      if (!audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContext();
      }
      const now = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now);       // D5
      osc.frequency.setValueAtTime(880, now + 0.15);   // A5
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.5);
    } catch (e) {}
  }

  // 2. Initialize WebRTC Viewer
  let isTorchActive = false;
  let isRemoteRecording = false;
  let motionBannerTimer = null;
  let currentClipRequest = null;
  let currentCameraFpsMode = { isLowFps: false, fps: 30 };
  let currentMeasuredFps = 30;
  let nativeFramesReceivedCount = 0;
  let lastNativeFrameTime = 0;
  let nativeFps = 0;
  let isUsingNativeStream = false;

  function updateFpsDisplay() {
    if (!statFps) return;
    if (isUsingNativeStream && Date.now() - lastNativeFrameTime < 3000) {
      statFps.textContent = `🔒 ${currentMeasuredFps} FPS (จอดับ/เบื้องหลัง)`;
      statFps.style.color = 'var(--accent-green)';
      return;
    }
    const isEco = currentCameraFpsMode && currentCameraFpsMode.isLowFps;
    if (isEco) {
      statFps.textContent = `🔋 ECO (${currentMeasuredFps} FPS)`;
      statFps.style.color = 'var(--accent-green)';
    } else {
      statFps.textContent = `${currentMeasuredFps} FPS`;
      statFps.style.color = '#fff';
    }
  }

  const viewer = new WebRTCViewer({
    remoteVideo: remoteVideo,

    onConnectionStateChange: (state) => {
      statusBadge.className = 'badge';
      if (state === 'connected') {
        statusBadge.classList.add('badge-connected');
        statusBadge.textContent = 'เชื่อมต่อสำเร็จ';
        videoPlaceholder.style.display = 'none';
        if (remoteVideo) remoteVideo.style.display = 'block';
        if (remoteCanvas) remoteCanvas.style.display = 'none';
        if (signaling) signaling.stopHeartbeat();
        startStatsMonitor();
      } else if (state === 'connecting') {
        statusBadge.classList.add('badge-waiting');
        statusBadge.textContent = 'กำลังต่อ P2P...';
      } else {
        statusBadge.classList.add('badge-disconnected');
        statusBadge.textContent = 'สัญญาณขาดหาย';
        videoPlaceholder.style.display = 'flex';
        stopStatsMonitor();
      }
    },

    onMotionAlert: (payload) => {
      console.log('[Viewer] Motion Alert received from camera!', payload);
      motionAlertBanner.classList.add('active');
      playAlertChime();

      if (motionBannerTimer) clearTimeout(motionBannerTimer);
      motionBannerTimer = setTimeout(() => {
        motionAlertBanner.classList.remove('active');
      }, 4000);
    },

    onTelemetry: (telemetry) => {
      if (telemetry.battery !== null && telemetry.battery !== undefined) {
        const icon = telemetry.isCharging ? '⚡🔋' : '🔋';
        statBattery.textContent = `${icon} ${telemetry.battery}%`;
      }
    },

    onRecordingStatus: (status) => {
      isRemoteRecording = !!status.isRecording;
      osdRecTag.style.display = isRemoteRecording ? 'inline-block' : 'none';
      btnRemoteRecord.classList.toggle('active', isRemoteRecording);
      remoteRecText.textContent = isRemoteRecording ? 'หยุดอัดที่กล้อง' : 'สั่งอัดที่กล้อง';
    },

    onTorchStatus: (status) => {
      isTorchActive = !!status.isTorchOn;
      btnRemoteTorch.classList.toggle('active', isTorchActive);
    },

    onClipsList: (clips) => {
      clipsBadge.textContent = clips.length;
      renderRemoteClips(clips);
    },

    onClipDownloadProgress: ({ clipId, progress, receivedBytes, totalBytes }) => {
      downloadProgressBar.style.display = 'block';
      dlProgressFill.style.width = progress + '%';
      dlPercentText.textContent = `${progress}% (${formatBytes(receivedBytes)} / ${formatBytes(totalBytes)})`;
    },

    onClipDownloadComplete: ({ clipId, blob }) => {
      console.log(`[Viewer] Clip #${clipId} received completely via P2P DataChannel (${blob.size} bytes)`);
      downloadProgressBar.style.display = 'none';

      if (!currentClipRequest || currentClipRequest.clipId !== Number(clipId)) {
        return;
      }
      if (currentClipRequest.isHandled) {
        return;
      }
      currentClipRequest.isHandled = true;

      const blobUrl = URL.createObjectURL(blob);
      if (currentClipRequest.action === 'play') {
        playbackVideo.src = blobUrl;
        playbackModal.classList.add('active');
        playbackVideo.play().catch(() => {});
      } else if (currentClipRequest.action === 'download') {
        const a = document.createElement('a');
        a.href = blobUrl;
        a.download = `camera_clip_${clipId}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
        console.log(`[Viewer] Clip #${clipId} saved via P2P DataChannel`);
      }
    },

    onClipReady: ({ clipId, url }) => {
      console.log(`[Viewer] Clip #${clipId} ready via server: ${url}`);
      downloadProgressBar.style.display = 'none';

      if (!currentClipRequest || currentClipRequest.clipId !== Number(clipId)) {
        return;
      }
      if (currentClipRequest.isHandled) {
        return; // Duplicate message, ignore!
      }
      currentClipRequest.isHandled = true;

      if (currentClipRequest.action === 'play') {
        // STREAM / PLAY ONLY — DO NOT DOWNLOAD!
        playbackVideo.src = url;
        playbackModal.classList.add('active');
        playbackVideo.play().catch(() => {});
      } else if (currentClipRequest.action === 'download') {
        // DOWNLOAD ONLY ONCE
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.blob();
          })
          .then(blob => {
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = `camera_clip_${clipId}.webm`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
            console.log(`[Viewer] Clip #${clipId} downloaded successfully`);
          })
          .catch(err => {
            console.error('[Viewer] Download error:', err);
            // Fallback to P2P DataChannel download if server fetch fails
            viewer.sendCommand('transferClipDirect', { clipId: Number(clipId) });
          });
      }
    },
    onSettingsData: (settings) => {
      console.log('[Viewer] Received camera settings:', settings);
      if (!settings) return;
      const chkMotion = document.getElementById('chkMotionEnabled');
      const txtMotion = document.getElementById('txtMotionStatus');
      const sensSlider = document.getElementById('viewSensSlider');
      const sensVal = document.getElementById('viewSensVal');
      const chkSchedule = document.getElementById('chkScheduleEnabled');
      const timeStart = document.getElementById('timeScheduleStart');
      const timeEnd = document.getElementById('timeScheduleEnd');
      const durMin = document.getElementById('inputDurationMin');
      const durSec = document.getElementById('inputDurationSec');
      const maxStorage = document.getElementById('inputMaxStorageMB');

      if (chkMotion) {
        chkMotion.checked = !!settings.motionEnabled;
        if (txtMotion) {
          txtMotion.textContent = chkMotion.checked ? 'เปิด' : 'ปิด';
          txtMotion.style.color = chkMotion.checked ? 'var(--accent-green)' : 'var(--accent-red)';
        }
      }
      if (sensSlider) {
        sensSlider.value = settings.motionSensitivity || 25;
        if (sensVal) sensVal.textContent = (settings.motionSensitivity || 25) + '%';
      }
      if (chkSchedule && settings.motionSchedule) {
        chkSchedule.checked = !!settings.motionSchedule.enabled;
        if (timeStart) timeStart.value = settings.motionSchedule.startTime || '22:00';
        if (timeEnd) timeEnd.value = settings.motionSchedule.endTime || '06:00';
      }
      if (durMin && durSec) {
        const total = settings.clipDurationSec || 15;
        durMin.value = Math.floor(total / 60);
        durSec.value = total % 60;
      }
      if (maxStorage) {
        maxStorage.value = settings.maxStorageMB || 500;
      }
      const chkAutoOled = document.getElementById('chkAutoOled');
      const chkAutoFps = document.getElementById('chkAutoFps');
      if (chkAutoOled) chkAutoOled.checked = settings.autoOledEnabled !== false;
      if (chkAutoFps) chkAutoFps.checked = settings.autoFpsEnabled !== false;

      if (settings.storageUsage) {
        updateStorageUI(settings.storageUsage);
      }
    },

    onStorageUsage: (usage) => {
      updateStorageUI(usage);
    },

    onFpsMode: ({ isLowFps, fps }) => {
      console.log(`[Viewer] Camera FPS mode changed: ${isLowFps ? 'ECO' : 'ACTIVE'} (${fps} FPS)`);
      currentCameraFpsMode = { isLowFps, fps };
      updateFpsDisplay();
    },

    onNativeFrame: (base64Frame) => {
      if (videoPlaceholder) videoPlaceholder.style.display = 'none';
      if (remoteVideo) remoteVideo.style.display = 'none';
      if (remoteCanvas) {
        remoteCanvas.style.display = 'block';
        remoteCanvas.src = 'data:image/jpeg;base64,' + base64Frame;
      }
      isUsingNativeStream = true;
      nativeFramesReceivedCount++;
      lastNativeFrameTime = Date.now();
    },

    onLocalStreamInfo: (info) => {
      console.log('[Viewer] Native Stream Info:', info);
    },

    onClipDownloadComplete: ({ clipId, blob }) => {
      downloadProgressBar.style.display = 'none';
      dlProgressFill.style.width = '0%';

      if (!currentClipRequest || currentClipRequest.clipId !== Number(clipId)) {
        return;
      }
      if (currentClipRequest.isHandled) {
        return; // Already handled via server stream, ignore duplicate!
      }
      currentClipRequest.isHandled = true;

      if (currentClipRequest.action === 'play') {
        const videoUrl = URL.createObjectURL(blob);
        playbackVideo.src = videoUrl;
        playbackModal.classList.add('active');
        playbackVideo.play().catch(() => {});
      } else if (currentClipRequest.action === 'download') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `camera_clip_${clipId}.webm`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    }
  });

  // 3. Signaling setup
  let signaling = null;
  function connectToRoom(roomId) {
    if (!roomId) return;
    currentRoomId = normalizeRoomId(roomId);
    inputRoomId.value = currentRoomId;
    hintRoomId.textContent = currentRoomId;

    if (signaling) signaling.disconnect();

    signaling = new P2PSignaling(currentRoomId, 'viewer', {
      onConnect: () => {
        console.log('[Viewer] Signaling connected');
        statusBadge.textContent = 'รอสัญญาณกล้อง...';
      },
      onPeerReady: () => {
        console.log('[Viewer] Camera is ready, announcing viewer readiness');
        if (signaling) signaling.send('ready', { timestamp: Date.now() });
      },
      onOffer: async (offer) => {
        console.log('[Viewer] Received offer from camera, responding with answer');
        await viewer.handleOffer(offer);
      },
      onCandidate: async (candidate) => {
        await viewer.handleCandidate(candidate);
      },
      onCustomMessage: (type, payload) => {
        viewer.handleMessage(type, payload);
      },
      onDisconnect: () => {
        statusBadge.className = 'badge badge-disconnected';
        statusBadge.textContent = 'หลุดการเชื่อมต่อ';
      }
    });

    viewer.setSignaling(signaling);
    signaling.connect();

    // Update URL query string
    const newUrl = `${window.location.pathname}?room=${currentRoomId}`;
    window.history.replaceState(null, '', newUrl);
  }

  if (currentRoomId) {
    connectToRoom(currentRoomId);
  }

  btnJoinRoom.addEventListener('click', () => {
    connectToRoom(inputRoomId.value);
  });

  inputRoomId.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') connectToRoom(inputRoomId.value);
  });

  // 4. Remote Control Actions
  btnRemoteTorch.addEventListener('click', () => {
    isTorchActive = !isTorchActive;
    viewer.toggleTorch(isTorchActive);
    btnRemoteTorch.classList.toggle('active', isTorchActive);
  });

  btnRemoteFlip.addEventListener('click', () => {
    viewer.switchCamera();
  });

  btnRemoteRecord.addEventListener('click', () => {
    if (isRemoteRecording) {
      viewer.stopRecord();
    } else {
      viewer.startRecord(0);
    }
  });

  // Snapshot frame capture
  btnSnapshot.addEventListener('click', () => {
    if (!remoteVideo.videoWidth) {
      alert('ยังไม่มีสัญญาณภาพ');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = remoteVideo.videoWidth;
    canvas.height = remoteVideo.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(remoteVideo, 0, 0, canvas.width, canvas.height);

    const a = document.createElement('a');
    a.download = `snapshot_${currentRoomId}_${Date.now()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  });

  // Local MediaRecorder on Viewer device
  let localMediaRecorder = null;
  let localChunks = [];
  btnLocalRecord.addEventListener('click', () => {
    if (localMediaRecorder && localMediaRecorder.state === 'recording') {
      localMediaRecorder.stop();
      btnLocalRecord.classList.remove('active');
      localRecText.textContent = 'อัดลงเครื่องนี้';
    } else {
      const stream = remoteVideo.srcObject;
      if (!stream) {
        alert('ยังไม่มีสตรีมวิดีโอ');
        return;
      }
      localChunks = [];
      localMediaRecorder = new MediaRecorder(stream);
      localMediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) localChunks.push(e.data);
      };
      localMediaRecorder.onstop = () => {
        const blob = new Blob(localChunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `viewer_recording_${Date.now()}.webm`;
        a.click();
      };
      localMediaRecorder.start();
      btnLocalRecord.classList.add('active');
      localRecText.textContent = 'กำลังอัดสด...';
    }
  });

  // Settings Modal Elements
  const btnOpenSettings = document.getElementById('btnOpenSettings');
  const settingsModal = document.getElementById('settingsModal');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const chkMotionEnabled = document.getElementById('chkMotionEnabled');
  const txtMotionStatus = document.getElementById('txtMotionStatus');
  const chkScheduleEnabled = document.getElementById('chkScheduleEnabled');
  const timeScheduleStart = document.getElementById('timeScheduleStart');
  const timeScheduleEnd = document.getElementById('timeScheduleEnd');
  const inputDurationMin = document.getElementById('inputDurationMin');
  const inputDurationSec = document.getElementById('inputDurationSec');
  const inputMaxStorageMB = document.getElementById('inputMaxStorageMB');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const btnClearAllClipsSettings = document.getElementById('btnClearAllClipsSettings');
  const btnClearAllClipsRemote = document.getElementById('btnClearAllClipsRemote');

  if (btnOpenSettings) {
    btnOpenSettings.addEventListener('click', () => {
      settingsModal.classList.add('active');
      viewer.requestSettings();
      viewer.requestStorageUsage();
    });
  }

  if (btnCloseSettings) {
    btnCloseSettings.addEventListener('click', () => settingsModal.classList.remove('active'));
  }

  if (chkMotionEnabled) {
    chkMotionEnabled.addEventListener('change', () => {
      if (txtMotionStatus) {
        txtMotionStatus.textContent = chkMotionEnabled.checked ? 'เปิด' : 'ปิด';
        txtMotionStatus.style.color = chkMotionEnabled.checked ? 'var(--accent-green)' : 'var(--accent-red)';
      }
    });
  }

  if (viewSensSlider) {
    viewSensSlider.addEventListener('input', (e) => {
      viewSensVal.textContent = e.target.value + '%';
    });
  }

  if (btnSaveSettings) {
    btnSaveSettings.addEventListener('click', () => {
      const min = Math.max(0, Number(inputDurationMin.value) || 0);
      const sec = Math.max(0, Number(inputDurationSec.value) || 0);
      const totalSec = Math.max(3, (min * 60) + sec);

      const settings = {
        motionEnabled: chkMotionEnabled.checked,
        motionSensitivity: Number(viewSensSlider.value),
        motionSchedule: {
          enabled: chkScheduleEnabled.checked,
          startTime: timeScheduleStart.value || '22:00',
          endTime: timeScheduleEnd.value || '06:00'
        },
        clipDurationSec: totalSec,
        maxStorageMB: Math.max(50, Number(inputMaxStorageMB.value) || 500),
        autoOledEnabled: document.getElementById('chkAutoOled') ? document.getElementById('chkAutoOled').checked : true,
        autoFpsEnabled: document.getElementById('chkAutoFps') ? document.getElementById('chkAutoFps').checked : true
      };

      viewer.updateSettings(settings);
      btnSaveSettings.textContent = '✅ บันทึกแล้ว!';
      setTimeout(() => {
        btnSaveSettings.textContent = '💾 บันทึกการตั้งค่าไปยังกล้อง';
        settingsModal.classList.remove('active');
      }, 1000);
    });
  }

  // Clear All Clips Handlers
  function confirmClearAll() {
    if (confirm('คุณต้องการล้างไฟล์วิดีโอที่บันทึกไว้ทั้งหมดบนเครื่องกล้องใช่หรือไม่?\n(ไฟล์ทั้งหมดจะถูกลบอย่างถาวร ไม่สามารถกู้คืนได้)')) {
      viewer.clearAllClips();
    }
  }
  if (btnClearAllClipsSettings) btnClearAllClipsSettings.addEventListener('click', confirmClearAll);
  if (btnClearAllClipsRemote) btnClearAllClipsRemote.addEventListener('click', confirmClearAll);

  // Storage UI Update Helper
  function updateStorageUI(usage) {
    if (!usage) return;
    const txtStorageUsed = document.getElementById('txtStorageUsed');
    const txtStoragePercent = document.getElementById('txtStoragePercent');
    const storageProgressFill = document.getElementById('storageProgressFill');
    const statStorageText = document.getElementById('statStorageText');
    const statStoragePercentText = document.getElementById('statStoragePercentText');
    const settingsStorageProgressFill = document.getElementById('settingsStorageProgressFill');

    const str = `${usage.formattedTotal} / ${usage.formattedMax} (${usage.count} คลิป)`;
    if (txtStorageUsed) txtStorageUsed.textContent = str;
    if (txtStoragePercent) txtStoragePercent.textContent = `${usage.percent}%`;
    if (storageProgressFill) storageProgressFill.style.width = `${usage.percent}%`;

    if (statStorageText) statStorageText.textContent = str;
    if (statStoragePercentText) statStoragePercentText.textContent = `${usage.percent}%`;
    if (settingsStorageProgressFill) settingsStorageProgressFill.style.width = `${usage.percent}%`;
  }

  // Remote Clips Explorer
  btnBrowseClips.addEventListener('click', () => {
    clipsModal.classList.add('active');
    viewer.fetchClipsList();
    viewer.requestStorageUsage();
  });

  btnCloseClips.addEventListener('click', () => clipsModal.classList.remove('active'));
  btnRefreshClips.addEventListener('click', () => {
    viewer.fetchClipsList();
    viewer.requestStorageUsage();
  });

  function renderRemoteClips(clips) {
    if (!clips || clips.length === 0) {
      remoteClipsList.innerHTML = '<div style="text-align: center; color: var(--text-secondary); padding: 30px;">ยังไม่มีคลิปที่บันทึกไว้บนกล้อง</div>';
      return;
    }

    remoteClipsList.innerHTML = '';
    clips.forEach(clip => {
      const row = document.createElement('div');
      row.className = 'clip-row';
      row.innerHTML = `
        <div>
          <div style="font-weight: 600; font-size: 0.9rem;">
            <span>${clip.trigger === 'motion' ? '⚡ Motion Clip' : '🔴 Manual Clip'}</span>
            <span style="color: var(--accent-blue);">#${clip.id}</span>
          </div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">
            ${clip.dateStr} • ความยาว: ${clip.formattedDuration} • ขนาด: ${clip.formattedSize}
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn-action btn-play-clip" title="เปิดดูทันที" style="padding: 6px 12px;">▶ ดู</button>
          <button class="btn-action btn-dl-clip" title="ดาวน์โหลดผ่าน P2P" style="padding: 6px 12px;">⬇ บันทึก</button>
          <button class="btn-action btn-del-clip" title="ลบคลิป" style="padding: 6px 10px; color: var(--accent-red);">🗑</button>
        </div>
      `;

      const btnPlay = row.querySelector('.btn-play-clip');
      const btnDl = row.querySelector('.btn-dl-clip');

      btnPlay.addEventListener('click', () => {
        currentClipRequest = {
          clipId: Number(clip.id),
          action: 'play',
          isHandled: false
        };
        btnPlay.textContent = '⏳ โหลด...';
        viewer.downloadClip(clip.id);
        setTimeout(() => { btnPlay.textContent = '▶ ดู'; }, 4000);
      });

      btnDl.addEventListener('click', () => {
        currentClipRequest = {
          clipId: Number(clip.id),
          action: 'download',
          isHandled: false
        };
        btnDl.textContent = '⏳ บันทึก...';
        viewer.downloadClip(clip.id);
        setTimeout(() => { btnDl.textContent = '⬇ บันทึก'; }, 4000);
      });

      row.querySelector('.btn-del-clip').addEventListener('click', () => {
        if (confirm(`คุณต้องการสั่งลบคลิป #${clip.id} บนเครื่องกล้องหรือไม่?`)) {
          viewer.deleteClip(clip.id);
        }
      });

      remoteClipsList.appendChild(row);
    });
  }

  // Playback modal close
  btnClosePlayback.addEventListener('click', () => {
    playbackModal.classList.remove('active');
    playbackVideo.pause();
    playbackVideo.src = '';
  });

  // Download directly from Playback Modal
  const btnDownloadCurrentPlayback = document.getElementById('btnDownloadCurrentPlayback');
  if (btnDownloadCurrentPlayback) {
    btnDownloadCurrentPlayback.addEventListener('click', () => {
      const src = playbackVideo.src;
      if (!src) return;
      btnDownloadCurrentPlayback.textContent = '⏳ กำลังบันทึก...';
      fetch(src)
        .then(res => res.blob())
        .then(blob => {
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = blobUrl;
          a.download = `camera_clip_playback_${Date.now()}.webm`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          setTimeout(() => URL.revokeObjectURL(blobUrl), 15000);
          btnDownloadCurrentPlayback.textContent = '✅ บันทึกสำเร็จ!';
          setTimeout(() => { btnDownloadCurrentPlayback.textContent = '⬇ บันทึกคลิปนี้ลงคอมพิวเตอร์'; }, 2500);
        })
        .catch(err => {
          console.error('[Download] Error:', err);
          btnDownloadCurrentPlayback.textContent = '❌ บันทึกล้มเหลว';
        });
    });
  }

  // Audio Mute/Unmute Toggle
  const btnToggleAudio = document.getElementById('btnToggleAudio');
  const audioIcon = document.getElementById('audioIcon');
  const audioBtnText = document.getElementById('audioBtnText');

  function toggleAudio() {
    remoteVideo.muted = !remoteVideo.muted;
    if (remoteVideo.muted) {
      if (audioIcon) audioIcon.textContent = '🔇';
      if (audioBtnText) audioBtnText.textContent = 'เปิดเสียง';
      btnToggleAudio.classList.remove('active');
    } else {
      if (audioIcon) audioIcon.textContent = '🔊';
      if (audioBtnText) audioBtnText.textContent = 'ปิดเสียง';
      btnToggleAudio.classList.add('active');
      remoteVideo.play().catch(() => {});
    }
  }

  if (btnToggleAudio) btnToggleAudio.addEventListener('click', toggleAudio);

  remoteVideo.addEventListener('playing', () => {
    if (videoPlaceholder) videoPlaceholder.style.display = 'none';
    if (remoteVideo) remoteVideo.style.display = 'block';
    if (remoteCanvas) remoteCanvas.style.display = 'none';
  });

  // Click on video viewport to resume or toggle audio
  remoteVideo.addEventListener('click', () => {
    if (remoteVideo.paused) {
      remoteVideo.play().catch(() => {});
    } else {
      toggleAudio();
    }
  });

  // Fullscreen toggle
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // WebRTC & Native Stats Monitoring
  let statsTimer = null;
  function startStatsMonitor() {
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = setInterval(async () => {
      // 1. If receiving native background frames (phone screen locked/off)
      if (isUsingNativeStream && (Date.now() - lastNativeFrameTime < 3500)) {
        currentMeasuredFps = nativeFramesReceivedCount;
        nativeFramesReceivedCount = 0;
        updateFpsDisplay();
        if (statRes) statRes.textContent = "Native HD";
        return;
      }

      // 2. Otherwise use WebRTC video track stats
      const stats = await viewer.getStats();
      if (stats) {
        if (stats.fps !== undefined && stats.fps !== null) {
          currentMeasuredFps = Math.round(stats.fps);
          updateFpsDisplay();
        }
        if (stats.resolution) statRes.textContent = stats.resolution;
      }
    }, 1000);
  }

  function stopStatsMonitor() {
    if (statsTimer) {
      clearInterval(statsTimer);
      statsTimer = null;
    }
  }

  // Close modals on backdrop click
  [clipsModal, settingsModal, playbackModal].forEach(modal => {
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.classList.remove('active');
      });
    }
  });
});
