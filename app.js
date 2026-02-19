// app.js
import { createMemoryStorage } from './storage-memory.js';
import { createOPFSStorage } from './storage-opfs.js';

const startBtn = document.getElementById('startBtn');
const delayRange = document.getElementById('delayRange');
const delayLabel = document.getElementById('delayLabel');
const capabilityLabel = document.getElementById('capability');
const sourceVideo = document.getElementById('source');
const playbackVideo = document.getElementById('playback');

const CHUNK_SECONDS = 2; // length of each recorded chunk
const RAM_MAX_SECONDS = 90; // safe upper bound for pure RAM
const OPFS_MAX_SECONDS = 600; // 10 minutes

let storage;
let mediaRecorder;
let playing = false;
let lastPlayedTarget = 0;

delayRange.addEventListener('input', () => {
  delayLabel.textContent = `${delayRange.value} s`;
});

async function chooseStorage() {
  const hasOPFS = !!(navigator.storage && navigator.storage.getDirectory); // OPFS check[web:58]
  if (hasOPFS) {
    storage = await createOPFSStorage(OPFS_MAX_SECONDS, CHUNK_SECONDS);
    capabilityLabel.textContent = 'Storage: disk-backed (up to 10 minutes, newer devices).';
    delayRange.max = OPFS_MAX_SECONDS.toString();
  } else {
    storage = createMemoryStorage(RAM_MAX_SECONDS, CHUNK_SECONDS);
    capabilityLabel.textContent = 'Storage: memory only (up to ~90 seconds).';
    delayRange.max = RAM_MAX_SECONDS.toString();
    if (parseInt(delayRange.value, 10) > RAM_MAX_SECONDS) {
      delayRange.value = RAM_MAX_SECONDS.toString();
    }
  }
  delayLabel.textContent = `${delayRange.value} s`;
  await storage.init?.();
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

  mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp8'
  });

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data && e.data.size > 0) {
      await storage.addChunk(e.data);
    }
  };

  mediaRecorder.start(CHUNK_SECONDS * 1000); // timeslice in ms[web:31]
  startBtn.textContent = 'Running';
  startBtn.disabled = true;

  startPlaybackLoop();
}

function startPlaybackLoop() {
  playing = true;
  lastPlayedTarget = 0;

  const loop = async () => {
    if (!playing) return;

    const delaySeconds = parseInt(delayRange.value, 10);
    const nowSeconds = performance.now() / 1000;
    const targetSeconds = nowSeconds - delaySeconds;

    if (targetSeconds <= 0 || Number.isNaN(targetSeconds)) {
      requestAnimationFrame(loop);
      return;
    }

    // Avoid refetching for nearly same time
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
  startCameraAndRecording().catch(err => {
    console.error(err);
    alert('Error starting camera: ' + err.message);
  });
});
