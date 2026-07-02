(function () {
  const bg = document.getElementById('bgcanvas');
  const fx = document.getElementById('fxcanvas');
  const bgctx = bg.getContext('2d');
  const fxctx = fx.getContext('2d');
  const video = document.getElementById('camvideo');
  const camBtn = document.getElementById('camBtn');
  const burstBtn = document.getElementById('burstBtn');
  const hint = document.getElementById('hint');
  const permMsg = document.getElementById('permMsg');

  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

  // Columns for body snow cap
  let cols = [], colW = 5.5, N = 0;
  let camSurfaceY = null;
  let camSurfaceExists = null;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    [bg, fx].forEach(c => {
      c.width = W * DPR;
      c.height = H * DPR;
      c.style.width = W + 'px';
      c.style.height = H + 'px';
    });
    bgctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    fxctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    initColumns();
  }
  window.addEventListener('resize', resize);

  // ---------- background scene: dim room + fairy lights ----------
  function drawScene() {
    bgctx.clearRect(0, 0, W, H);
    if (camOn) {
      // Clear overlay - video is fully visible
    } else {
      const g = bgctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#100c1c');
      g.addColorStop(0.55, '#171224');
      g.addColorStop(1, '#0c0a13');
      bgctx.fillStyle = g;
      bgctx.fillRect(0, 0, W, H);

      // soft vignette
      const vg = bgctx.createRadialGradient(W / 2, H * 0.4, H * 0.15, W / 2, H * 0.5, H * 0.85);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.55)');
      bgctx.fillStyle = vg;
      bgctx.fillRect(0, 0, W, H);
    }

    // fairy light string across top
    bgctx.save();
    bgctx.strokeStyle = 'rgba(255,255,255,0.15)';
    bgctx.lineWidth = 1.2;
    bgctx.beginPath();
    const swag = 40;
    bgctx.moveTo(0, H * 0.10);
    for (let x = 0; x <= W; x += 40) {
      const y = H * 0.10 + Math.sin(x / 90) * 6 + swag * Math.sin((x / W) * Math.PI);
      bgctx.lineTo(x, y);
    }
    bgctx.stroke();
    for (let x = 10; x < W; x += 26) {
      const y = H * 0.10 + Math.sin(x / 90) * 6 + swag * Math.sin((x / W) * Math.PI) + 3;
      const tw = 0.35 + 0.65 * Math.abs(Math.sin(x * 0.13 + performance.now() * 0.0012));
      bgctx.fillStyle = `rgba(255,216,156,${0.25 + tw * 0.55})`;
      bgctx.beginPath();
      bgctx.arc(x, y, 2.1, 0, Math.PI * 2);
      bgctx.fill();
    }
    bgctx.restore();
  }

  // ---------- body silhouette (target for cam OR pointer) ----------
  let px = W / 2, py = H * 0.42;      // silhouette anchor (head center)
  let tx = px, ty = py;
  let headR = 0, shW = 0;

  function sizeSilhouette() {
    headR = Math.min(W, H) * 0.11;
    shW = Math.min(W, H) * 0.34;
  }

  // returns top surface Y of the body at a given x (without snow), or null if no body there
  function bodySurfaceY(x) {
    if (camOn && isWsConnected) {
      const ci = colIndex(x);
      if (ci >= 0 && ci < N && camSurfaceExists[ci] === 1) {
        return camSurfaceY[ci];
      }
      return null;
    }
    const dx = x - px;
    const adx = Math.abs(dx);
    const headBottom = py + headR * 0.15;
    if (adx <= headR * 0.98) {
      // top hemisphere of head
      const under = headR * headR - dx * dx;
      return py - Math.sqrt(Math.max(under, 0));
    }
    const slopeStart = headR * 0.98;
    const slopeEnd = headR * 1.9;
    const shoulderY = py + headR * 1.55;
    if (adx <= slopeEnd) {
      const t = (adx - slopeStart) / (slopeEnd - slopeStart);
      return headBottom + (shoulderY - headBottom) * Math.min(Math.max(t, 0), 1);
    }
    if (adx <= shW) {
      // gently sloped shoulder top, drooping outward
      const t = (adx - slopeEnd) / (shW - slopeEnd);
      return shoulderY + t * t * headR * 1.1;
    }
    return null; // off the body
  }

  // slope estimate (dy/dx) of the *body* (not incl. snow) for stick/slide decision
  function bodySlope(x) {
    const y1 = bodySurfaceY(x - 4), y2 = bodySurfaceY(x + 4);
    if (y1 == null || y2 == null) return 99;
    return (y2 - y1) / 8;
  }

  function initColumns() {
    colW = 5.5;
    N = Math.ceil(W / colW) + 2;
    cols = new Float32Array(N);
    camSurfaceY = new Float32Array(N);
    camSurfaceExists = new Uint8Array(N);
    camSurfaceY.fill(9999);
    sizeSilhouette();
  }

  function colIndex(x) {
    return Math.min(N - 1, Math.max(0, Math.round(x / colW)));
  }

  // ---------- particles ----------
  const MAX_PARTICLES = 1400;
  let particles = [];

  function spawnParticle(x, y, vx, vy, r) {
    particles.push({
      x, y,
      vx: vx || 0,
      vy: vy || 0,
      r: r || (1.1 + Math.random() * 1.9),
      tw: Math.random() * Math.PI * 2,
      stuck: false,
      life: 0,
      rested: false,
      restTimer: 0
    });
  }

  function ambientSpawn(dt) {
    waveTimer -= dt;
    if (waveTimer <= 0) {
      waveTimer = waveInterval + (Math.random() - 0.5) * 0.05;
      spawnRow();
    }
  }

  let waveTimer = 0, waveInterval = 0.5;

  function spawnRow() {
    const spacing = 16;
    const startY = -10 - Math.random() * 20;
    for (let x = Math.random() * spacing; x < W; x += spacing) {
      if (particles.length >= MAX_PARTICLES) break;
      if (Math.random() < 0.15) continue; // slight gaps so it doesn't look like a solid ruled line
      const jitterY = (Math.random() - 0.5) * 14;
      spawnParticle(x + (Math.random() - 0.5) * 6, startY + jitterY, (Math.random() - 0.5) * 4, 130 + Math.random() * 40, 1.3 + Math.random() * 1.7);
    }
  }

  function burst() {
    for (let i = 0; i < 70 && particles.length < MAX_PARTICLES; i++) {
      const x = px + (Math.random() - 0.5) * shW * 1.3;
      spawnParticle(x, -10 - Math.random() * 30, (Math.random() - 0.5) * 30, 40 + Math.random() * 40, 1.2 + Math.random() * 2.2);
    }
  }

  const GRAV = 260;        // px/s^2 rain-like fall
  const STICK_SLOPE = 0.25; // below this |slope| -> can stick (stricter slope for sticking)
  const MAX_DEPTH = 3;     // px of pile before it starts spilling harder (very low depth to prevent stacking)
  const GROUND_Y_FRAC = 0.94;

  function step(dt) {
    // smooth silhouette follow
    px += (tx - px) * Math.min(1, dt * 6);
    py += (ty - py) * Math.min(1, dt * 6);

    const groundY = H * GROUND_Y_FRAC;

    // particles
    for (let k = particles.length - 1; k >= 0; k--) {
      const p = particles[k];

      // normal particle physics
      p.vy += GRAV * dt;
      p.x += p.vx * dt;
      p.vx *= (1 - 0.6 * dt);
      p.y += p.vy * dt;

      if (p.x < -20 || p.x > W + 20) {
        particles.splice(k, 1);
        continue;
      }

      const bY = bodySurfaceY(p.x);
      if (bY != null) {
        if (p.y >= bY - p.r) {
          // Slide along surface instantly: redirect velocity down-slope
          const slope = bodySlope(p.x);
          let dir = slope >= 0 ? 1 : -1;
          if (Math.abs(slope) < 0.08) {
            dir = Math.random() < 0.5 ? 1 : -1;
          }
          p.vx = dir * (120 + Math.random() * 80); // slide velocity
          p.vy = Math.max(p.vy * 0.4, 50); // slide downwards along the slope
          p.y = bY - p.r - 1;
          continue;
        }
      }

      // ground: vanish softly
      if (p.y >= groundY - p.r) {
        particles.splice(k, 1);
        continue;
      }
      if (p.y > H + 30) {
        particles.splice(k, 1);
      }
    }
  }

  // ---------- render ----------
  function render() {
    fxctx.clearRect(0, 0, W, H);
    const groundY = H * GROUND_Y_FRAC;

    // particles (both falling and resting/stuck ones)
    const t = performance.now() * 0.004;
    fxctx.shadowColor = 'rgba(255,255,255,0.55)';
    fxctx.shadowBlur = 3;
    for (const p of particles) {
      const s = 0.75 + 0.25 * Math.sin(t * 3 + p.tw);
      let alpha = 0.65 * s + 0.3;
      if (p.stuck) {
        // smooth fade out during the last 0.5 seconds of its 1.5 seconds life
        const remaining = 1.5 - p.life;
        if (remaining < 0.5) {
          alpha *= Math.max(0, remaining / 0.5);
        }
      }
      fxctx.fillStyle = `rgba(255,255,255,${alpha})`;
      fxctx.beginPath();
      fxctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      fxctx.fill();
    }
    fxctx.shadowBlur = 0;

    // Draw hand skeleton if hands are detected
    if (camOn && isWsConnected && detectedHands.length > 0) {
      fxctx.save();
      // Glow effect for skeleton lines
      fxctx.shadowColor = 'rgba(201, 168, 255, 0.7)';
      fxctx.shadowBlur = 6;
      fxctx.strokeStyle = 'rgba(201, 168, 255, 0.8)'; // purple accent
      fxctx.lineWidth = 3;
      fxctx.lineCap = 'round';
      
      for (const hand of detectedHands) {
        // Draw connection lines
        for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
          const start = hand[startIdx];
          const end = hand[endIdx];
          if (start && end) {
            const sx = (1 - start.x) * W;
            const sy = start.y * H;
            const ex = (1 - end.x) * W;
            const ey = end.y * H;
            
            fxctx.beginPath();
            fxctx.moveTo(sx, sy);
            fxctx.lineTo(ex, ey);
            fxctx.stroke();
          }
        }
        
        // Draw joint dots
        fxctx.shadowBlur = 0; // disable shadow for dots
        for (let idx = 0; idx < hand.length; idx++) {
          const lm = hand[idx];
          const sx = (1 - lm.x) * W;
          const sy = lm.y * H;
          
          const isTip = [4, 8, 12, 16, 20].includes(idx);
          fxctx.fillStyle = isTip ? '#ffd89c' : '#c9a8ff'; // gold for tips, purple for joints
          
          fxctx.beginPath();
          fxctx.arc(sx, sy, isTip ? 5.5 : 4.5, 0, Math.PI * 2);
          fxctx.fill();
        }
      }
      fxctx.restore();
    }
  }

  // ---------- input ----------
  let usingPointer = false;
  window.addEventListener('pointermove', e => {
    usingPointer = true;
    tx = e.clientX;
    ty = e.clientY - headR * 0.4;
    if (!hint.classList.contains('fade')) hint.classList.add('fade');
  }, { passive: true });

  window.addEventListener('pointerdown', e => {
    tx = e.clientX;
    ty = e.clientY - headR * 0.4;
  });

  let idleT = 0;

  // ---------- WebSocket and Video Setup ----------
  let camOn = false;
  let ws = null;
  let isWsConnected = false;
  let freezeParticles = false;
  let detectedHands = [];
  let wsReadyToSend = true;

  const HAND_CONNECTIONS = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [9, 10], [10, 11], [11, 12],
    [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
    [5, 9], [9, 13], [13, 17]
  ];

  // Hidden canvas for sending scaled/compressed camera frames
  const sendCanvas = document.createElement('canvas');
  sendCanvas.width = 320;
  sendCanvas.height = 240;
  const sendCtx = sendCanvas.getContext('2d');

  let lastFrameSentTime = 0;
  const FRAME_SEND_INTERVAL = 20; // ms to throttle frame uploads (up to 50 fps)

  function initWebSocket() {
    if (ws) {
      try {
        ws.close();
      } catch (e) { }
    }

    ws = new WebSocket('ws://localhost:8765');
    ws.binaryType = 'blob';

    ws.onopen = () => {
      console.log('Connected to Python AI Edge Detection server.');
      isWsConnected = true;
      wsReadyToSend = true;
      permMsg.style.display = 'none';
    };
 
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        handleDetectionData(data);
      } catch (err) {
        console.error('Error parsing WS message:', err);
      } finally {
        wsReadyToSend = true; // Acknowledge and allow sending next frame
      }
    };
 
    ws.onclose = () => {
      console.log('Disconnected from Python AI server. Reconnecting in 3s...');
      isWsConnected = false;
      wsReadyToSend = true;
      // Retrying...
      if (camOn) {
        setTimeout(initWebSocket, 3000);
      }
    };
 
    ws.onerror = (err) => {
      console.warn('WebSocket error. Ensure Python backend is running.');
      isWsConnected = false;
      wsReadyToSend = true;
    };
  }

  function handleDetectionData(data) {
    const vW = data.width;
    const vH = data.height;
    const topEdges = data.top_edges;

    const scaleX = W / vW;
    const scaleY = H / vH;

    // Map the raw columns back to local snow columns
    for (let i = 0; i < N; i++) {
      const screenX = i * colW;

      // Mirroring: the raw image is not mirrored, but the display is.
      // So screen column i maps to mirrored relative position in raw image.
      const normalizedX = screenX / W;
      const mirroredNormalizedX = 1 - normalizedX;

      const detX = Math.round(mirroredNormalizedX * (vW - 1));
      const clampedDetX = Math.min(vW - 1, Math.max(0, detX));

      const detY = topEdges[clampedDetX];

      if (detY < vH) {
        const screenY = detY * scaleY;
        if (camSurfaceExists[i] === 1) {
          // Temporal smoothing interpolation to prevent shaky edge transitions
          camSurfaceY[i] = camSurfaceY[i] * 0.70 + screenY * 0.30;
        } else {
          camSurfaceY[i] = screenY;
        }
        camSurfaceExists[i] = 1;
      } else {
        camSurfaceExists[i] = 0;
        camSurfaceY[i] = 9999;
      }
    }

    // Map overall centroid for smooth tracking
    if (data.min_y < vH) {
      const normCentroidX = data.centroid_x / vW;
      const mirroredNormCentroidX = 1 - normCentroidX;
      tx = mirroredNormCentroidX * W;
      ty = (data.min_y / vH) * H + headR * 0.55;
    }

    // Set particle freeze status based on hand gestures
    freezeParticles = data.freeze_particles || false;
    detectedHands = data.hands || [];
  }

  camBtn.addEventListener('click', async () => {
    if (camOn) {
      stopCam();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false
      });
      video.srcObject = stream;
      await video.play();
      video.classList.add('on');
      camOn = true;
      camBtn.textContent = 'ปิดกล้อง AI';
      camBtn.classList.add('active');

      // Initialize WebSocket connection to AI Backend
      initWebSocket();

    } catch (err) {
      console.error('Camera access failed:', err);
      permMsg.textContent = 'ไม่สามารถเข้าถึงกล้องได้ โปรดอนุญาตการใช้กล้องในเบราว์เซอร์';
      permMsg.style.display = 'block';
      setTimeout(() => permMsg.style.display = 'none', 3000);
      stopCam();
    }
  });

  function stopCam() {
    const stream = video.srcObject;
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
    }
    video.srcObject = null;
    video.classList.remove('on');
    camOn = false;
    camBtn.textContent = 'เปิดกล้อง AI';
    camBtn.classList.remove('active');

    if (ws) {
      try {
        ws.close();
      } catch (e) { }
      ws = null;
    }
    isWsConnected = false;
    freezeParticles = false;
    detectedHands = [];
    wsReadyToSend = true;

    if (camSurfaceExists) camSurfaceExists.fill(0);
    if (camSurfaceY) camSurfaceY.fill(9999);
  }

  function sendFrameIfNeeded(now) {
    if (!camOn || !isWsConnected || !video.srcObject) return;
    if (!wsReadyToSend) return; // Prevent queue buildup by waiting for acknowledgment
    if (now - lastFrameSentTime < FRAME_SEND_INTERVAL) return;

    wsReadyToSend = false;
    lastFrameSentTime = now;

    // Draw current video frame to hidden canvas
    sendCtx.drawImage(video, 0, 0, sendCanvas.width, sendCanvas.height);

    // Convert to jpeg blob and transmit over WS (lower quality slightly for faster transfer)
    sendCanvas.toBlob((blob) => {
      if (blob && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(blob);
      } else {
        wsReadyToSend = true; // Release if connection failed
      }
    }, 'image/jpeg', 0.40);
  }

  burstBtn.addEventListener('click', burst);

  // ---------- main loop ----------
  let last = performance.now();

  function loop(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    idleT += dt;

    // Mouse fallback movement when camera is not running or WS is disconnected
    if (!usingPointer && (!camOn || !isWsConnected)) {
      tx = W / 2 + Math.sin(idleT * 0.5) * W * 0.12;
      ty = H * 0.4 + Math.sin(idleT * 0.8) * 10;
    }

    // Throttle and send frames to Python
    if (camOn && isWsConnected) {
      sendFrameIfNeeded(now);
    }

    if (!freezeParticles) {
      ambientSpawn(dt);
      step(dt);
    }
    drawScene();
    render();
    requestAnimationFrame(loop);
  }

  // Initial setup
  resize();
  sizeSilhouette();
  requestAnimationFrame(loop);

  setTimeout(() => hint.classList.add('fade'), 6000);
})();
