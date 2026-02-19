// app.js
// Main controller: camera, recorder, delay logic, fullscreen.

import { createMemoryStorage } from './storage-memory.js';
import { createOPFSStorage } from './storage-opfs.js';

const startBtn = document.getElementById('startBtn');
const delayInput = document.getElementById('delayInput');
const delayLabel = document.getElementById('delayLabel');
const fsBtn = document.getElementById('fsBtn');
const capabilityLabel = document.getElementById('capability');
const sourceVideo = document.getElementById('source');
const playbackVideo = document.getElementById('playback');

const CHUNK_SECONDS = 2;
const RAM_MAX_SECONDS = 90;
const OPFS_MAX_SECONDS = 600;

let storage;
let mediaRecorder;
let playing = false;
let lastPlayedTarget = 0;

function clampDelay() {
  const max = parseInt(delayInput.max, 10);
  const min = parseInt(delayInput.min, 10);
  let v = parseInt(delayInput.value, 10);
  if (Number.isNaN(v)) v = min;
  if (v < min) v = min;
  if (v > max) v = max;
  delayInput.value = v.toString();
  delayLabel.textContent = `${v} s`;
}

delayInput.addEventListener('input', clampDelay);
delayInput.addEventListener('change', clampDelay);

fsBtn.addEventListener('click', () => {
  const v = playbackVideo;
  if (v.requestFullscreen) {
    v.requestFullscreen();
  } else if (v.webkitEnterFullscreen) {
    v.webkitEnterFullscreen(); // iOS Safari
  } else if (v.webkitRequestFullscreen) {
    v.webkitRequestFullscreen();
  } else if (v.msRequestFullscreen) {
    v.msRequestFullscreen();
  }
});

async function chooseStorage() {
  const hasOPFS = !!(navigator.storage && navigator.storage.getDirectory);
  try {
    if (hasOPFS) {
      storage = await createOPFSStorage(OPFS_MAX_SECONDS, CHUNK_SECONDS);
      capabilityLabel.textContent = 'Storage: disk-backed (up to ~10 minutes on newer devices).';
      delayInput.max = OPFS_MAX_SECONDS.toString();
    } else {
      storage = createMemoryStorage(RAM_MAX_SECONDS, CHUNK_SECONDS);
      capabilityLabel.textContent = 'Storage: memory only (up to ~90 seconds).';
      delayInput.max = RAM_MAX_SECONDS.toString();
      if (parseInt(delayInput.value, 10) > RAM_MAX_SECONDS) {
        delayInput.value = RAM_MAX_SECONDS.toString();
      }
    }
  } catch (e) {
    // If OPFS init fails, fall back to memory
    console.warn('OPFS failed, falling back to memory:', e);
    storage = createMemoryStorage(RAM_MAX_SECONDS, CHUNK_SECONDS);
    capabilityLabel.textContent = 'Storage: memory only (up to ~90 seconds).';
    delayInput.max = RAM_MAX_SECONDS.toString();
  }

  clampDelay();
  if (storage.init) {
    await storage.init();
  }
}

async function startCameraAndRecording() {
  await chooseStorage();

  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 15 }
    },
    audio: false
  });

  sourceVideo.srcObject = stream;
  await sourceVideo.play();

  // NOTE: MediaRecorder must be supported in this Safari/Chrome version.
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8'
  });

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0) {
      await storage.addChunk(e.data);
    }
  };

  mediaRecorder.start(CHUNK_SECONDS * 1000);
  startBtn.textContent = 'Running';
  startBtn.disabled = true;

  startPlaybackLoop();
}

function startPlaybackLoop() {
  playing = true;
  lastPlayedTarget = 0;

  const loop = async () => {
    if (!playing) return;

    const delaySeconds = parseInt(delayInput.value, 10);
    const now = performance.now() / 1000;
    const targetSeconds = now - delaySeconds;

    if (targetSeconds <= 0 || Number.isNaN(targetSeconds)) {
      requestAnimationFrame(loop);
      return;
    }

    if (Math.abs(targetSeconds - lastPlayedTarget) < 0.5) {
      requestAnimationFrame(loop);
      return;
    }

    const blob = await storage.getChunkForTime(targetSeconds);
    if (blob) {
      lastPlayedTarget = targetSeconds;
      const url = URL.createObjectURL(blob);
      playbackVideo.src = url;
      playbackVideo.onloadeddata = () => {
        playbackVideo.play().catch(() => {});
      };
      playbackVideo.onended = () => {
        URL.revokeObjectURL(url);
      };
    }

    requestAnimationFrame(loop);
  };

  requestAnimationFrame(loop);
}

startBtn.addEventListener('click', () => {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    alert('Camera access not supported in this browser.');
    return;
  }
  if (typeof MediaRecorder === 'undefined') {
    alert('MediaRecorder is not supported on this device/browser (need newer iOS/Android).');
    return;
  }
  startCameraAndRecording().catch(err => {
    console.error(err);
    alert('Error starting camera: ' + err.message);
  });
});

// Initialize delay label
clampDelay();
