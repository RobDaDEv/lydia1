const $ = (s) => document.querySelector(s);
const statusEl = $('#status');
const startBtn = $('#startBtn');
const stopBtn = $('#stopBtn');
const muteBtn = $('#muteBtn');
const captionsEl = document.getElementById('captions');

// Lydia's default Agent ID
const DEFAULT_AGENT_ID = "agent_9901k319scqeftdt2x9nb1ht8p6j";

let audioCtx, micStream, workletNode, micMuted = false;
let ws, playingQueue = [], isPlaying = false;

// Three.js
let renderer, scene, camera;
let bgTex, bgCanvas, bgCtx, bgColumns, bgDrops;
let faceTex, faceCanvas, faceCtx;
let faceMesh;
let mouthOpen = 0, mouthTarget = 0;

function setStatus(t) { statusEl.textContent = t; }
function addCaption(who, text) {
  if (!text) return;
  const div = document.createElement('div');
  div.textContent = `${who}: ${text}`;
  captionsEl.appendChild(div);
  captionsEl.scrollTop = captionsEl.scrollHeight;
}

// Smooth scroll from hero
const talkBtn = document.getElementById('talkBtn');
if (talkBtn) {
  talkBtn.addEventListener('click', (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

async function initAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatus('Microphone blocked. Enable mic permissions and reload.');
    throw err;
  }
  const source = audioCtx.createMediaStreamSource(micStream);

  await audioCtx.audioWorklet.addModule('/mic-worklet.js');
  workletNode = new AudioWorkletNode(audioCtx, 'mic-processor');
  source.connect(workletNode);
  workletNode.port.onmessage = (ev) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || micMuted) return;
    const ab = ev.data;
    const base64 = arrayBufferToBase64(ab);
    ws.send(JSON.stringify({ user_audio_chunk: base64 }));
  };
  setStatus('Microphone ready');
}

function arrayBufferToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
function base64ToUint8(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function pcm16ToWav(pcmBytes, sampleRate = 16000) {
  const buffer = new ArrayBuffer(44 + pcmBytes.length);
  const view = new DataView(buffer);
  const write = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o+i, s.charCodeAt(i)); };

  write(0,'RIFF'); view.setUint32(4, 36+pcmBytes.length, true);
  write(8,'WAVE'); write(12,'fmt '); view.setUint32(16,16,true);
  view.setUint16(20,1,true); view.setUint16(22,1,true);
  view.setUint32(24,sampleRate,true); view.setUint32(28,sampleRate*2,true);
  view.setUint16(32,2,true); view.setUint16(34,16,true);
  write(36,'data'); view.setUint32(40, pcmBytes.length, true);
  new Uint8Array(buffer,44).set(pcmBytes);
  return buffer;
}
async function enqueueAndPlayWavBuffer(wavBuffer) {
  const copy = wavBuffer.slice(0);
  const audioBuffer = await new Promise((resolve, reject) =>
    audioCtx.decodeAudioData(copy, resolve, reject)
  );
  playingQueue.push(audioBuffer);
  if (!isPlaying) playNextInQueue();
}
function playNextInQueue() {
  if (!playingQueue.length) { isPlaying = false; return; }
  isPlaying = true;
  const buf = playingQueue.shift();
  const src = audioCtx.createBufferSource();
  src.buffer = buf;

  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 512;
  const data = new Uint8Array(analyser.frequencyBinCount);
  const gain = audioCtx.createGain();

  src.connect(analyser);
  analyser.connect(gain);
  gain.connect(audioCtx.destination);

  const tick = () => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128; sum += v*v;
    }
    const rms = Math.sqrt(sum / data.length);
    mouthTarget = Math.min(1, rms * 4);
    if (isPlaying) requestAnimationFrame(tick);
  };
  tick();
  src.onended = () => playNextInQueue();
  src.start();
}

// ---------- Three.js setup with Matrix background and face outline ----------
function initThree() {
  const canvas = document.getElementById('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 100);
  camera.position.set(0,0,3.2);
  scene.add(camera);

  // Digital-rain background (canvas texture on a fullscreen plane)
  bgCanvas = document.createElement('canvas');
  bgCanvas.width = 1024; bgCanvas.height = 1024;
  bgCtx = bgCanvas.getContext('2d');
  bgColumns = Math.floor(bgCanvas.width / 12);
  bgDrops = Array(bgColumns).fill(0);
  bgTex = new THREE.CanvasTexture(bgCanvas);
  const bgMat = new THREE.MeshBasicMaterial({ map: bgTex });
  const bgGeo = new THREE.PlaneGeometry(10, 10);
  const bgMesh = new THREE.Mesh(bgGeo, bgMat);
  bgMesh.position.z = -1.5;
  scene.add(bgMesh);

  // Face line-art canvas texture on transparent plane (glowing)
  faceCanvas = document.createElement('canvas');
  faceCanvas.width = 1024; faceCanvas.height = 1024;
  faceCtx = faceCanvas.getContext('2d');
  faceTex = new THREE.CanvasTexture(faceCanvas);
  faceTex.magFilter = THREE.LinearFilter;
  faceTex.minFilter = THREE.LinearMipmapLinearFilter;
  const faceMat = new THREE.MeshBasicMaterial({
    map: faceTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const faceGeo = new THREE.PlaneGeometry(2.3, 2.3);
  faceMesh = new THREE.Mesh(faceGeo, faceMat);
  faceMesh.position.z = 0;
  scene.add(faceMesh);

  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  });

  animate();
}

function drawMatrixBG() {
  const ctx = bgCtx;
  const W = bgCanvas.width, H = bgCanvas.height;
  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.fillRect(0,0,W,H);
  ctx.fillStyle = '#0f0';
  ctx.font = 'bold 16px monospace';
  for (let i = 0; i < bgDrops.length; i++) {
    const text = String.fromCharCode(0x30A0 + Math.random()*96);
    ctx.fillText(text, i*12, bgDrops[i]*16);
    if (bgDrops[i]*16 > H && Math.random() > 0.975) bgDrops[i] = 0;
    bgDrops[i]++;
  }
  bgTex.needsUpdate = true;
}

// Neon stroke helper with glow
function neonStroke(ctx, pathFn, color = '#0f0', width = 2, blur = 12) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.beginPath();
  pathFn(ctx);
  ctx.stroke();
  ctx.restore();
}

// Draw a stylized face in line-art; mouth height reacts to mouthOpen
function drawFace() {
  const ctx = faceCtx;
  const W = faceCanvas.width, H = faceCanvas.height;
  ctx.clearRect(0,0,W,H);

  // subtle green vertical scan
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.fillRect(0,0,W,H);

  const cx = W/2, cy = H*0.48, sx = W*0.32, sy = H*0.38;

  // Outer silhouette
  neonStroke(ctx, (c)=>{
    c.moveTo(cx, cy - sy*1.05);
    c.bezierCurveTo(cx - sx*0.6, cy - sy*1.0, cx - sx*0.95, cy - sy*0.35, cx - sx*0.95, cy + sy*0.2);
    c.bezierCurveTo(cx - sx*0.95, cy + sy*0.65, cx - sx*0.55, cy + sy*0.95, cx, cy + sy*1.0);
    c.bezierCurveTo(cx + sx*0.55, cy + sy*0.95, cx + sx*0.95, cy + sy*0.65, cx + sx*0.95, cy + sy*0.2);
    c.bezierCurveTo(cx + sx*0.95, cy - sy*0.35, cx + sx*0.6, cy - sy*1.0, cx, cy - sy*1.05);
  }, '#1fff9e', 2.2, 18);

  // Hair outline waves
  neonStroke(ctx, (c)=>{
    c.moveTo(cx - sx*0.75, cy - sy*0.75);
    c.bezierCurveTo(cx - sx*0.9, cy - sy*0.2, cx - sx*0.9, cy + sy*0.2, cx - sx*0.6, cy + sy*0.6);
  }, '#13f28a', 1.6, 10);
  neonStroke(ctx, (c)=>{
    c.moveTo(cx + sx*0.75, cy - sy*0.75);
    c.bezierCurveTo(cx + sx*0.9, cy - sy*0.2, cx + sx*0.9, cy + sy*0.2, cx + sx*0.6, cy + sy*0.6);
  }, '#13f28a', 1.6, 10);

  // Eyes
  neonStroke(ctx, (c)=>{
    c.moveTo(cx - sx*0.28, cy - sy*0.1);
    c.quadraticCurveTo(cx - sx*0.18, cy - sy*0.18, cx - sx*0.08, cy - sy*0.1);
    c.quadraticCurveTo(cx - sx*0.18, cy - sy*0.02, cx - sx*0.28, cy - sy*0.1);
  }, '#0aff84', 1.6, 10);
  neonStroke(ctx, (c)=>{
    c.moveTo(cx + sx*0.28, cy - sy*0.1);
    c.quadraticCurveTo(cx + sx*0.18, cy - sy*0.18, cx + sx*0.08, cy - sy*0.1);
    c.quadraticCurveTo(cx + sx*0.18, cy - sy*0.02, cx + sx*0.28, cy - sy*0.1);
  }, '#0aff84', 1.6, 10);

  // Nose
  neonStroke(ctx, (c)=>{
    c.moveTo(cx, cy - sy*0.02);
    c.quadraticCurveTo(cx - sx*0.02, cy + sy*0.12, cx, cy + sy*0.12);
    c.quadraticCurveTo(cx + sx*0.02, cy + sy*0.12, cx + sx*0.03, cy + sy*0.1);
  }, '#12ff90', 1.4, 8);

  // Mouth (animated height)
  const mh = Math.max(1, mouthOpen * 24); // up to ~24px
  neonStroke(ctx, (c)=>{
    c.moveTo(cx - sx*0.18, cy + sy*0.22);
    c.bezierCurveTo(cx - sx*0.08, cy + sy*0.24 + mh*0.01, cx + sx*0.08, cy + sy*0.24 + mh*0.01, cx + sx*0.18, cy + sy*0.22);
    c.bezierCurveTo(cx + sx*0.08, cy + sy*0.26 - mh*0.01, cx - sx*0.08, cy + sy*0.26 - mh*0.01, cx - sx*0.18, cy + sy*0.22);
  }, '#1fff9e', 1.8, 12);

  // Chin highlight
  neonStroke(ctx, (c)=>{
    c.moveTo(cx - sx*0.15, cy + sy*0.38);
    c.quadraticCurveTo(cx, cy + sy*0.43, cx + sx*0.15, cy + sy*0.38);
  }, '#0aff84', 1.2, 8);

  // Title text "LYDIA AI"
  ctx.save();
  ctx.fillStyle = '#1cff8a';
  ctx.shadowColor = '#1cff8a';
  ctx.shadowBlur = 16;
  ctx.font = 'bold 120px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('LYDIA AI', cx, H*0.92);
  ctx.restore();

  faceTex.needsUpdate = true;
}

function animate() {
  requestAnimationFrame(animate);
  drawMatrixBG();

  // Smooth mouth
  mouthOpen += (mouthTarget - mouthOpen) * 0.3;

  drawFace();
  renderer.render(scene, camera);
}

// ------------- WebSocket connect -------------
async function connect(agentId) {
  setStatus('Requesting signed URL…'); console.log('Fetching /api/signed-url for', agentId);
  const r = await fetch(`/api/signed-url?agentId=${encodeURIComponent(agentId)}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'Failed to get signed URL');
  const signedUrl = j.signedUrl;

  setStatus('Connecting to ElevenLabs…');
  ws = new WebSocket(signedUrl);

  ws.onopen = () => {
    setStatus('Connected. Say something!');
    ws.send(JSON.stringify({
      type: "conversation_initiation_client_data",
      conversation_config_override: {
        agent: { first_message: "Hello from Lydia AI. How can I assist today?", language: "en" },
        tts: { audio_format: "pcm_16000" }
      }
    }));
  };

  ws.onmessage = async (evt) => {
    let data; try { data = JSON.parse(evt.data); } catch { return; }
    if (data.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', event_id: data.ping_event?.event_id }));
      return;
    }
    if (data.type === 'user_transcript') {
      const t = data.user_transcription_event?.user_transcript;
      addCaption('You', t);
      return;
    }
    if (data.type === 'agent_response') {
      const t = data.agent_response_event?.agent_response;
      addCaption('Lydia', t);
      return;
    }
    if (data.type === 'audio') {
      const pcmBytes = base64ToUint8(data.audio_event.audio_base_64);
      mouthTarget = 0.7;
      const wav = pcm16ToWav(pcmBytes, 16000);
      await enqueueAndPlayWavBuffer(wav);
      return;
    }
  };

  ws.onclose = (ev) => {
    console.warn('WS closed:', ev.code, ev.reason);
    setStatus('Disconnected (code ' + ev.code + (ev.reason? (', ' + ev.reason) : '') + ')');
  };
  ws.onerror = () => setStatus('Connection issue. Check your network and try again.');
}

// Controls
startBtn.onclick = async () => {
  try {
    await initAudio();
    await connect(DEFAULT_AGENT_ID);
    startBtn.disabled = true; stopBtn.disabled = false; muteBtn.disabled = false;
  } catch (e) { console.error(e); setStatus('Failed to start: ' + e.message); }
};
stopBtn.onclick = () => {
  try {
    if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    if (micStream) micStream.getTracks().forEach(t => t.stop());
    startBtn.disabled = false; stopBtn.disabled = true; muteBtn.disabled = true;
    setStatus('Stopped');
  } catch (e) { console.error(e); }
};
muteBtn.onclick = () => { micMuted = !micMuted; muteBtn.textContent = micMuted ? 'Unmute' : 'Mute'; setStatus(micMuted ? 'Mic muted' : 'Mic live'); };

// Test sound
const beepBtn = document.getElementById('beepBtn');
if (beepBtn) {
  beepBtn.onclick = async () => {
    if (!audioCtx) await initAudio();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.05, audioCtx.currentTime);
    o.connect(g).connect(audioCtx.destination);
    o.frequency.value = 880;
    o.start();
    o.stop(audioCtx.currentTime + 0.25);
  };
}

// Boot
initThree();
setStatus('Press Start to talk to Lydia.');
