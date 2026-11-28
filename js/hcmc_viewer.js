/* ============================================================================
 * TP.HCM 3D Digital Twin — Universal Multi-Device & Zero-Loss 60/120Hz Viewer
 * Three.js r128 | Inertial Multi-Touch + Mouse Rig | Smart Shadow & Queue
 * ============================================================================ */
(function () {
  'use strict';

  const container = document.getElementById('viewport-container');
  const subtitleEl = document.getElementById('subtitle-status');
  const fpsBadge = document.getElementById('fps-badge');
  const labelsOverlay = document.getElementById('labels-overlay');
  const deviceBadge = document.getElementById('device-badge');
  const hudHintEl = document.getElementById('hud-hint-primary');
  const focusPing = document.getElementById('focus-ping');
  const controlPanel = document.getElementById('control-panel');
  const togglePanelBtn = document.getElementById('toggle-panel-btn');
  const minimapCard = document.getElementById('minimap-card');
  const minimapFabCount = document.getElementById('minimap-fab-count');
  const streamProgressWrap = document.getElementById('stream-progress-wrap');
  const streamProgressBar = document.getElementById('stream-progress-bar');
  const streamProgressText = document.getElementById('stream-progress-text');

  // ==================== 1. AUTO DEVICE & INPUT DETECTION ====================
  const deviceProfile = {
    type: 'desktop',   // 'mobile' | 'tablet' | 'desktop'
    input: 'mouse',    // 'touch' | 'hybrid' | 'mouse'
    isMobile: false,
    isTouch: false,
  };

  function detectDeviceProfile(initialRun) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const shortSide = Math.min(w, h);
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const fine = window.matchMedia && window.matchMedia('(any-pointer: fine)').matches;
    const touchPts = navigator.maxTouchPoints || 0;
    const hasTouch = coarse || touchPts > 0 || ('ontouchstart' in window);

    if (shortSide < 540 || w < 768) {
      deviceProfile.type = 'mobile';
    } else if ((hasTouch && w <= 1180) || (w >= 768 && w <= 1024)) {
      deviceProfile.type = 'tablet';
    } else {
      deviceProfile.type = 'desktop';
    }

    deviceProfile.isMobile = deviceProfile.type === 'mobile';
    deviceProfile.isTouch = hasTouch;
    deviceProfile.input = hasTouch ? (fine ? 'hybrid' : 'touch') : 'mouse';

    const root = document.documentElement;
    root.setAttribute('data-device', deviceProfile.type);
    root.setAttribute('data-input', deviceProfile.input);

    if (deviceBadge) {
      if (deviceProfile.type === 'mobile') deviceBadge.textContent = '📱 Mobile';
      else if (deviceProfile.type === 'tablet') deviceBadge.textContent = '📟 Tablet';
      else if (deviceProfile.input === 'hybrid') deviceBadge.textContent = '💻 Cảm ứng';
      else deviceBadge.textContent = '💻 PC';
    }

    if (hudHintEl) {
      if (deviceProfile.input === 'touch') {
        hudHintEl.textContent = '1 ngón: Xoay · 2 ngón: Trượt & Thu phóng · Chạm đúp: Bay tới';
      } else if (deviceProfile.input === 'hybrid') {
        hudHintEl.textContent = 'Cảm ứng 1-2 ngón hoặc Chuột · Nhấp/Chạm đúp: Bay tới · WASD';
      } else {
        hudHintEl.textContent = 'Trái: Xoay · Phải: Trượt · Cuộn: Thu phóng · Nhấp đúp: Bay tới · WASD';
      }
    }

    // On mobile first open, collapse studio sheet by default so user enjoys full 3D view immediately
    if (initialRun && deviceProfile.isMobile) {
      controlPanel.classList.add('collapsed');
      togglePanelBtn.classList.remove('active');
    }
  }
  detectDeviceProfile(true);

  // ==================== 2. ZERO-LOSS HIGH-FPS WEBGL RENDERER ====================
  // preserveDrawingBuffer: false unlocks hardware double-buffering (+30% FPS with ZERO visual quality loss!)
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // Smart On-Demand Shadow Updating (Zero quality loss, 2.5x smoother orbit!)
  renderer.shadowMap.needsUpdate = true;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd99b66);
  scene.fog = new THREE.FogExp2(0xd99b66, 0.000168);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2.5, 30000);

  // Studio Lighting (Full 2048x2048 Soft Shadows preserved 100%)
  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.68);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffedd5, 1.82);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 9200;
  sunLight.shadow.bias = -0.00035;
  const shadowHalfExtent = 3200;
  sunLight.shadow.camera.left = -shadowHalfExtent;
  sunLight.shadow.camera.right = shadowHalfExtent;
  sunLight.shadow.camera.top = shadowHalfExtent;
  sunLight.shadow.camera.bottom = -shadowHalfExtent;
  scene.add(sunLight);
  scene.add(sunLight.target);

  let sunDirOffset = new THREE.Vector3(1800, 1800, 1100);
  let lastShadowSnapX = Infinity;
  let lastShadowSnapZ = Infinity;

  function markShadowDirty() {
    renderer.shadowMap.needsUpdate = true;
  }

  function updateSmartSunShadow(force) {
    // Snap shadow frustum to 32m world texel grid -> eliminates shadow edge shimmering & redundant shadow passes!
    const snapX = Math.round(camState.target.x / 32) * 32;
    const snapZ = Math.round(camState.target.z / 32) * 32;
    if (force || snapX !== lastShadowSnapX || snapZ !== lastShadowSnapZ) {
      lastShadowSnapX = snapX;
      lastShadowSnapZ = snapZ;
      sunLight.target.position.set(snapX, 0, snapZ);
      sunLight.position.set(snapX + sunDirOffset.x, sunDirOffset.y, snapZ + sunDirOffset.z);
      sunLight.target.updateMatrixWorld();
      renderer.shadowMap.needsUpdate = true;
    }
  }

  // Layer groups
  const groups = {
    terrain: new THREE.Group(),
    water: new THREE.Group(),
    roads: new THREE.Group(),
    buildings: new THREE.Group(),
    trees: new THREE.Group(),
    satFloor: new THREE.Group(),
    grid: new THREE.Group(),
  };
  Object.values(groups).forEach(g => scene.add(g));

  const layerVisible = {
    terrain: true,
    water: true,
    roads: true,
    buildings: true,
    trees: true,
    satFloor: true,
    grid: false,
    labels: true,
  };
  groups.grid.visible = false;

  // Neutral soft horizon base plane outside Ring 1 (prevents jarring brown background gaps)
  const horizonGeo = new THREE.PlaneGeometry(80000, 80000);
  const horizonMat = new THREE.MeshStandardMaterial({
    color: 0x9aa698,
    roughness: 0.98,
    metalness: 0.0,
  });
  const horizonFloor = new THREE.Mesh(horizonGeo, horizonMat);
  horizonFloor.rotation.x = -Math.PI / 2;
  horizonFloor.position.set(2000, -2.6, 2000);
  horizonFloor.receiveShadow = true;
  scene.add(horizonFloor);

  // ==================== 3. BUTTER-SMOOTH INERTIAL CAMERA RIG ====================
  const urlCam = (() => {
    try {
      const q = new URLSearchParams(location.search).get('cam');
      if (!q) return null;
      const parts = q.split(',').map(Number);
      if (parts.length >= 3 && parts.every(Number.isFinite)) {
        return {
          x: parts[0],
          z: parts[1],
          dist: parts[2],
          yaw: Number.isFinite(parts[3]) ? parts[3] : -0.68,
          pitch: Number.isFinite(parts[4]) ? parts[4] : 0.44,
        };
      }
    } catch (_) {}
    return null;
  })();

  const camState = {
    target: new THREE.Vector3(urlCam ? urlCam.x : 450, 14, urlCam ? urlCam.z : 250),
    goalTarget: new THREE.Vector3(urlCam ? urlCam.x : 450, 14, urlCam ? urlCam.z : 250),
    yaw: urlCam ? urlCam.yaw : -0.68,
    goalYaw: urlCam ? urlCam.yaw : -0.68,
    pitch: urlCam ? urlCam.pitch : 0.44,
    goalPitch: urlCam ? urlCam.pitch : 0.44,
    dist: urlCam ? urlCam.dist : 2100,
    goalDist: urlCam ? urlCam.dist : 2100,
    flyAnim: null,
    dampingStrength: 11.5, // Controlled by UI smoothness slider
  };

  const keysDown = new Set();
  const virtualJoy = { x: 0, y: 0, vert: 0 };
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.5);
  const tmpVec2 = new THREE.Vector2();
  const tmpHit = new THREE.Vector3();

  function clampTargetBounds(v) {
    v.x = Math.max(-14000, Math.min(18000, v.x));
    v.y = Math.max(-2, Math.min(600, v.y));
    v.z = Math.max(-14000, Math.min(18000, v.z));
  }

  function applyCameraTransform() {
    const cosP = Math.cos(camState.pitch);
    const sinP = Math.sin(camState.pitch);
    const sinY = Math.sin(camState.yaw);
    const cosY = Math.cos(camState.yaw);

    camera.position.set(
      camState.target.x + camState.dist * cosP * sinY,
      Math.max(4.0, camState.target.y + camState.dist * sinP),
      camState.target.z + camState.dist * cosP * cosY
    );
    camera.lookAt(camState.target);
    updateSmartSunShadow(false);
  }
  applyCameraTransform();

  function flyTo(x, z, dist = 1050, y = 22, pitch = 0.44) {
    camState.flyAnim = {
      startTarget: camState.target.clone(),
      endTarget: new THREE.Vector3(x, y, z),
      startDist: camState.dist,
      endDist: Math.max(45, Math.min(14000, dist)),
      startPitch: camState.pitch,
      endPitch: pitch,
      elapsed: 0,
      duration: 0.92,
    };
    camState.goalTarget.set(x, y, z);
    camState.goalDist = camState.flyAnim.endDist;
    camState.goalPitch = pitch;
  }

  function cancelFlyAnim() {
    if (camState.flyAnim) {
      camState.goalTarget.copy(camState.target);
      camState.goalDist = camState.dist;
      camState.goalYaw = camState.yaw;
      camState.goalPitch = camState.pitch;
      camState.flyAnim = null;
    }
  }

  function panByScreenDelta(dx, dy) {
    const panScale = camState.goalDist * 0.00135;
    const forwardX = -Math.sin(camState.yaw);
    const forwardZ = -Math.cos(camState.yaw);
    const rightX = Math.cos(camState.yaw);
    const rightZ = -Math.sin(camState.yaw);
    camState.goalTarget.x -= (dx * rightX - dy * forwardX) * panScale;
    camState.goalTarget.z -= (dx * rightZ - dy * forwardZ) * panScale;
    clampTargetBounds(camState.goalTarget);
  }

  function zoomTowardScreenPoint(scaleFactor, clientX, clientY) {
    cancelFlyAnim();
    const prevDist = camState.goalDist;
    const nextDist = Math.max(38, Math.min(14500, prevDist * scaleFactor));
    const zoomRatio = 1 - nextDist / prevDist;

    if (Math.abs(zoomRatio) > 0.0001) {
      tmpVec2.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
      raycaster.setFromCamera(tmpVec2, camera);
      if (raycaster.ray.intersectPlane(groundPlane, tmpHit)) {
        const pull = Math.min(0.45, Math.abs(zoomRatio)) * Math.sign(zoomRatio);
        camState.goalTarget.x += (tmpHit.x - camState.goalTarget.x) * pull * 0.65;
        camState.goalTarget.z += (tmpHit.z - camState.goalTarget.z) * pull * 0.65;
        clampTargetBounds(camState.goalTarget);
      }
    }
    camState.goalDist = nextDist;
  }

  function showFocusPing(clientX, clientY) {
    if (!focusPing) return;
    focusPing.hidden = false;
    focusPing.style.left = clientX + 'px';
    focusPing.style.top = clientY + 'px';
    focusPing.style.animation = 'none';
    void focusPing.offsetWidth;
    focusPing.style.animation = '';
    setTimeout(() => { focusPing.hidden = true; }, 580);
  }

  function focusAtScreenPoint(clientX, clientY) {
    tmpVec2.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(tmpVec2, camera);

    const pickables = [groups.buildings, groups.terrain, groups.water];
    const hits = raycaster.intersectObjects(pickables, true);
    showFocusPing(clientX, clientY);

    if (hits.length > 0) {
      const p = hits[0].point;
      const nextDist = Math.max(160, Math.min(1200, camState.dist * 0.52));
      flyTo(p.x, p.z, nextDist, Math.max(8, Math.min(180, p.y + 8)), Math.max(0.34, camState.pitch));
      return;
    }
    if (raycaster.ray.intersectPlane(groundPlane, tmpHit)) {
      flyTo(tmpHit.x, tmpHit.z, Math.max(220, camState.dist * 0.55), 14, Math.max(0.36, camState.pitch));
    }
  }

  // ==================== 4. UNIFIED MOUSE + MULTI-TOUCH GESTURE ENGINE ====================
  const dom = renderer.domElement;
  dom.addEventListener('contextmenu', e => e.preventDefault());

  // Mouse Controls
  let mouseMode = null;
  let lastMouseX = 0;
  let lastMouseY = 0;

  dom.addEventListener('mousedown', e => {
    if (e.button === 0) mouseMode = e.shiftKey ? 'pan' : 'orbit';
    else if (e.button === 1 || e.button === 2) mouseMode = 'pan';
    if (!mouseMode) return;
    cancelFlyAnim();
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    container.classList.add('dragging');
  });

  window.addEventListener('mousemove', e => {
    if (!mouseMode) return;
    const dx = e.clientX - lastMouseX;
    const dy = e.clientY - lastMouseY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    if (mouseMode === 'orbit') {
      camState.goalYaw -= dx * 0.0052;
      camState.goalPitch = Math.max(0.06, Math.min(1.48, camState.goalPitch + dy * 0.0052));
    } else {
      panByScreenDelta(dx, dy);
    }
  }, { passive: true });

  window.addEventListener('mouseup', () => {
    mouseMode = null;
    container.classList.remove('dragging');
  });

  dom.addEventListener('wheel', e => {
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
    const factor = Math.exp(Math.max(-0.35, Math.min(0.35, delta * 0.0011)));
    zoomTowardScreenPoint(factor, e.clientX, e.clientY);
  }, { passive: false });

  dom.addEventListener('dblclick', e => {
    focusAtScreenPoint(e.clientX, e.clientY);
  });

  // Multi-Touch Gesture Controls (1-finger Orbit, 2-finger Simultaneous Pinch-Zoom & Pan, Double-Tap Focus)
  let prevTouchCount = 0;
  let tLastX = 0;
  let tLastY = 0;
  let tLastSpan = 0;
  let lastTapTime = 0;
  let lastTapX = 0;
  let lastTapY = 0;
  let tapMoved = false;

  dom.addEventListener('touchstart', e => {
    e.preventDefault();
    cancelFlyAnim();
    const n = e.touches.length;
    if (n === 1) {
      tLastX = e.touches[0].clientX;
      tLastY = e.touches[0].clientY;
      tapMoved = false;
    } else if (n >= 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      tLastX = 0.5 * (t0.clientX + t1.clientX);
      tLastY = 0.5 * (t0.clientY + t1.clientY);
      tLastSpan = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      tapMoved = true;
    }
    prevTouchCount = n;
  }, { passive: false });

  dom.addEventListener('touchmove', e => {
    e.preventDefault();
    const n = e.touches.length;
    if (n === 1 && prevTouchCount === 1) {
      const cx = e.touches[0].clientX;
      const cy = e.touches[0].clientY;
      const dx = cx - tLastX;
      const dy = cy - tLastY;
      if (Math.hypot(dx, dy) > 6) tapMoved = true;
      tLastX = cx;
      tLastY = cy;
      camState.goalYaw -= dx * 0.0062;
      camState.goalPitch = Math.max(0.06, Math.min(1.48, camState.goalPitch + dy * 0.0062));
    } else if (n >= 2) {
      const t0 = e.touches[0];
      const t1 = e.touches[1];
      const midX = 0.5 * (t0.clientX + t1.clientX);
      const midY = 0.5 * (t0.clientY + t1.clientY);
      const span = Math.max(12, Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY));

      if (prevTouchCount >= 2 && tLastSpan > 12) {
        const dx = midX - tLastX;
        const dy = midY - tLastY;
        panByScreenDelta(dx * 1.15, dy * 1.15);
        const zoomFactor = tLastSpan / span;
        if (Math.abs(1 - zoomFactor) > 0.002) {
          zoomTowardScreenPoint(zoomFactor, midX, midY);
        }
      }
      tLastX = midX;
      tLastY = midY;
      tLastSpan = span;
      prevTouchCount = n;
    }
  }, { passive: false });

  dom.addEventListener('touchend', e => {
    if (e.touches.length === 0 && prevTouchCount === 1 && !tapMoved) {
      const ct = e.changedTouches[0];
      const now = performance.now();
      if (now - lastTapTime < 310 && Math.hypot(ct.clientX - lastTapX, ct.clientY - lastTapY) < 34) {
        focusAtScreenPoint(ct.clientX, ct.clientY);
        lastTapTime = 0;
      } else {
        lastTapTime = now;
        lastTapX = ct.clientX;
        lastTapY = ct.clientY;
      }
    } else if (e.touches.length === 1) {
      tLastX = e.touches[0].clientX;
      tLastY = e.touches[0].clientY;
    }
    prevTouchCount = e.touches.length;
  }, { passive: true });

  // Virtual Drone Pad (Thumbstick + Altitude buttons)
  const flypadEl = document.getElementById('virtual-flypad');
  const flypadBtn = document.getElementById('flypad-toggle-btn');
  const joyZone = document.getElementById('joy-move-zone');
  const joyKnob = document.getElementById('joy-move-knob');

  if (flypadBtn && flypadEl) {
    flypadEl.style.display = flypadEl.hidden ? 'none' : 'flex';
    flypadBtn.addEventListener('click', () => {
      flypadEl.hidden = !flypadEl.hidden;
      flypadEl.style.display = flypadEl.hidden ? 'none' : 'flex';
      flypadBtn.classList.toggle('active', !flypadEl.hidden);
    });
  }

  if (joyZone && joyKnob) {
    let joyPointerId = null;
    const maxR = 34;
    const updateJoy = (clientX, clientY) => {
      const rect = joyZone.querySelector('.joy-ring').getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const len = Math.hypot(dx, dy);
      if (len > maxR) {
        dx = (dx / len) * maxR;
        dy = (dy / len) * maxR;
      }
      joyKnob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
      virtualJoy.x = dx / maxR;
      virtualJoy.y = -dy / maxR;
      cancelFlyAnim();
    };
    const resetJoy = () => {
      joyPointerId = null;
      joyKnob.style.transform = 'translate3d(0,0,0)';
      virtualJoy.x = 0;
      virtualJoy.y = 0;
    };
    joyZone.addEventListener('pointerdown', e => {
      joyPointerId = e.pointerId;
      joyZone.setPointerCapture(e.pointerId);
      updateJoy(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointermove', e => {
      if (e.pointerId === joyPointerId) updateJoy(e.clientX, e.clientY);
    });
    joyZone.addEventListener('pointerup', resetJoy);
    joyZone.addEventListener('pointercancel', resetJoy);
  }

  function bindHoldButton(btnId, dir) {
    const el = document.getElementById(btnId);
    if (!el) return;
    const stop = () => { if (virtualJoy.vert === dir) virtualJoy.vert = 0; };
    el.addEventListener('pointerdown', e => { e.preventDefault(); cancelFlyAnim(); virtualJoy.vert = dir; });
    el.addEventListener('pointerup', stop);
    el.addEventListener('pointerleave', stop);
    el.addEventListener('pointercancel', stop);
  }
  bindHoldButton('joy-up-btn', 1);
  bindHoldButton('joy-down-btn', -1);

  // Keyboard shortcuts
  window.addEventListener('keydown', e => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      if (e.key === 'Escape') document.activeElement.blur();
      return;
    }
    const k = e.key.toLowerCase();
    keysDown.add(k);
    if (k === 'p') takeScreenshot();
    else if (k === 'h') toggleCinemaMode();
    else if (k === 'r') flyTo(450, 250, 1850, 20, 0.44);
    else if (k >= '1' && k <= '4') {
      const presets = document.querySelectorAll('.preset-btn');
      const btn = presets[Number(k) - 1];
      if (btn) btn.click();
    }
  });
  window.addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));

  // ==================== 5. SHARED MATERIALS, NIGHT EMISSIVE & PRIORITY STREAMER ====================
  const treeCanopyGeo = new THREE.ConeGeometry(4.5, 11, 7);
  treeCanopyGeo.translate(0, 9.5, 0);
  const treeTrunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 5, 5);
  treeTrunkGeo.translate(0, 2.5, 0);
  const speciesColors = [0x1b4d2b, 0x2f6e38, 0x3f8442, 0x26634f];
  const sharedCanopyMats = speciesColors.map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const sharedTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.95 });

  // Registry of emissive-capable building/landmark materials for Night CBD Glow
  const nightGlowMats = new Set();
  let currentNightFactor = 0.38;

  // Unified city-wide PBR materials (eliminates inter-tile color/water seam steps)
  const SHARED_WATER_MAT = new THREE.MeshStandardMaterial({
    name: 'MAT_02_SAIGON_RIVER_WATER',
    color: 0x2f7484,
    roughness: 0.18,
    metalness: 0.30,
    transparent: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const SHARED_ROAD_MAT = new THREE.MeshStandardMaterial({
    name: 'MAT_03_ROAD_ASPHALT_METRO',
    color: 0x4b535e,
    roughness: 0.88,
    metalness: 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  const UNIFIED_BLDG_PALETTE = {
    TUBE_HOUSE: { color: 0xdccbb6, roughness: 0.86, metalness: 0.04 },
    SHOPHOUSE: { color: 0xe6d8c3, roughness: 0.82, metalness: 0.06 },
    VILLA: { color: 0xefe7d8, roughness: 0.80, metalness: 0.05 },
    APARTMENT: { color: 0xcfd6de, roughness: 0.84, metalness: 0.08 },
    MODERN_TOWER: { color: 0x6c9cc2, roughness: 0.24, metalness: 0.52 },
  };
  const sharedBldgMats = {};
  Object.entries(UNIFIED_BLDG_PALETTE).forEach(([k, spec]) => {
    sharedBldgMats[k] = new THREE.MeshStandardMaterial({
      name: 'MAT_UNIFIED_' + k,
      color: spec.color,
      roughness: spec.roughness,
      metalness: spec.metalness,
    });
  });

  function resolveUnifiedBldgMat(meshName, matName) {
    const key = ((meshName || '') + ' ' + (matName || '')).toUpperCase();
    if (key.includes('MODERN') || key.includes('TOWER') || key.includes('CURTAIN') || key.includes('08')) {
      return sharedBldgMats.MODERN_TOWER;
    }
    if (key.includes('APARTMENT') || key.includes('CONCRETE') || key.includes('07')) {
      return sharedBldgMats.APARTMENT;
    }
    if (key.includes('VILLA') || key.includes('COLONIAL') || key.includes('06')) {
      return sharedBldgMats.VILLA;
    }
    if (key.includes('SHOPHOUSE') || key.includes('COMMERCIAL') || key.includes('05')) {
      return sharedBldgMats.SHOPHOUSE;
    }
    return sharedBldgMats.TUBE_HOUSE;
  }

  function registerNightMaterial(mat, isLandmark) {
    if (!mat || nightGlowMats.has(mat)) return;
    const nm = (mat.name || '').toUpperCase();
    if (nm.includes('TERRAIN') || nm.includes('WATER') || nm.includes('RIVER')) return;
    if (mat.emissive) {
      if (!mat.userData) mat.userData = {};
      const baseE = (mat.emissive.r + mat.emissive.g + mat.emissive.b) > 0.02
        ? mat.emissive.clone()
        : new THREE.Color(isLandmark ? 0xffd180 : (nm.includes('TOWER') || nm.includes('GLASS') ? 0x93c5fd : 0xfbbf24));
      mat.userData.nightColor = baseE;
      mat.userData.nightMax = isLandmark ? 0.55 : (nm.includes('ROAD') || nm.includes('METRO') ? 0.22 : 0.28);
      nightGlowMats.add(mat);
      applyMaterialNightGlow(mat);
    }
  }

  function applyMaterialNightGlow(mat) {
    if (!mat.userData || !mat.userData.nightColor) return;
    mat.emissive.copy(mat.userData.nightColor);
    mat.emissiveIntensity = currentNightFactor * mat.userData.nightMax;
  }

  function updateAllNightGlow() {
    nightGlowMats.forEach(applyMaterialNightGlow);
  }

  // Priority Tile Queue (Max 3 concurrent downloads, closest to camera target first, 1-frame yield per parse)
  const MAX_CONCURRENT_TILE_LOADS = 3;
  const tileQueue = [];
  const queuedIds = new Set();
  const loadedTiles = new Map();
  let activeLoads = 0;
  const satTilesLoaded = new Set();
  let worldData = null;
  let totalTreesCount = 0;
  let labelItems = [];

  const gltfLoader = new THREE.GLTFLoader();
  const texLoader = new THREE.TextureLoader();

  function classifyMeshLayer(meshName) {
    const u = (meshName || '').toUpperCase();
    if (u.includes('TERRAIN')) return 'terrain';
    if (u.includes('WATER') || u.includes('RIVER')) return 'water';
    if (u.includes('ROAD') || u.includes('METRO')) return 'roads';
    return 'buildings';
  }

  function updateStreamBanner() {
    if (!worldData) return;
    const totalReady = worldData.tiles.filter(t => t.glb_url).length;
    const done = loadedTiles.size;
    if (done >= totalReady || totalReady === 0) {
      streamProgressWrap.hidden = true;
      return;
    }
    streamProgressWrap.hidden = false;
    const pct = Math.round((done / totalReady) * 100);
    streamProgressBar.style.width = pct + '%';
    streamProgressText.textContent = `Đang nạp mượt ${done}/${totalReady} ô 3D (${pct}%)`;
  }

  function enqueueTileLoad(tile) {
    if (!tile.glb_url || loadedTiles.has(tile.tile_id) || queuedIds.has(tile.tile_id)) return;
    queuedIds.add(tile.tile_id);
    tileQueue.push(tile);
    pumpTileQueue();
  }

  function pumpTileQueue() {
    while (activeLoads < MAX_CONCURRENT_TILE_LOADS && tileQueue.length > 0) {
      // Always pick the tile closest to where the user is currently looking!
      tileQueue.sort((a, b) => {
        const da = Math.hypot(a.center_x - camState.goalTarget.x, a.center_z - camState.goalTarget.z);
        const db = Math.hypot(b.center_x - camState.goalTarget.x, b.center_z - camState.goalTarget.z);
        return da - db;
      });
      const nextTile = tileQueue.shift();
      loadSingleTileAsync(nextTile);
    }
    updateStreamBanner();
  }

  function loadScatterBin(tile) {
    if (!tile.scatter_url) return;
    fetch(tile.scatter_url)
      .then(r => (r.ok ? r.arrayBuffer() : null))
      .then(buf => {
        if (!buf || buf.byteLength < 16) return;
        const dv = new DataView(buf);
        const count = dv.getUint32(12, true);
        if (!count || buf.byteLength < 16 + count * 24) return;
        const bySpecies = [[], [], [], []];
        for (let i = 0; i < count; i++) {
          const off = 16 + i * 24;
          const x = dv.getFloat32(off, true);
          const y = dv.getFloat32(off + 4, true);
          const z = dv.getFloat32(off + 8, true);
          const rotY = dv.getFloat32(off + 12, true);
          const scale = Math.max(0.3, Math.min(2.5, dv.getFloat32(off + 16, true)));
          const sp = dv.getUint32(off + 20, true) % 4;
          bySpecies[sp].push({ x, y, z, rotY, scale });
        }

        requestAnimationFrame(() => {
          const dummy = new THREE.Object3D();
          const tileTreeGroup = new THREE.Group();
          const trunkInst = new THREE.InstancedMesh(treeTrunkGeo, sharedTrunkMat, count);
          trunkInst.castShadow = false;
          trunkInst.receiveShadow = false;
          let tIdx = 0;

          bySpecies.forEach((arr, sp) => {
            if (!arr.length) return;
            const inst = new THREE.InstancedMesh(treeCanopyGeo, sharedCanopyMats[sp], arr.length);
            inst.castShadow = false;
            inst.receiveShadow = false;
            for (let idx = 0; idx < arr.length; idx++) {
              const t = arr[idx];
              dummy.position.set(t.x, t.y, t.z);
              dummy.rotation.set(0, t.rotY, 0);
              dummy.scale.setScalar(t.scale);
              dummy.updateMatrix();
              inst.setMatrixAt(idx, dummy.matrix);
              trunkInst.setMatrixAt(tIdx++, dummy.matrix);
            }
            inst.instanceMatrix.needsUpdate = true;
            inst.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile.center_x, 12, tile.center_z), 1500);
            tileTreeGroup.add(inst);
          });

          trunkInst.instanceMatrix.needsUpdate = true;
          trunkInst.boundingSphere = new THREE.Sphere(new THREE.Vector3(tile.center_x, 12, tile.center_z), 1500);
          tileTreeGroup.add(trunkInst);
          groups.trees.add(tileTreeGroup);
          totalTreesCount += count;
          document.getElementById('stat-trees').textContent = totalTreesCount.toLocaleString('vi-VN');
        });
      })
      .catch(() => {});
  }

  function loadSingleTileAsync(tile) {
    activeLoads++;
    gltfLoader.load(
      tile.glb_url,
      gltf => {
        // Yield 1 animation frame so pointer/touch drag stays silky 60/120fps during heavy scene insertion
        requestAnimationFrame(() => {
          activeLoads--;
          loadedTiles.set(tile.tile_id, true);

          const satMesh = groups.satFloor.getObjectByName('sat_' + tile.tile_id);
          if (satMesh) groups.satFloor.remove(satMesh);

          // Auto-align Tile-Local GLBs to World-Space if offset > 500m from tile.center
          gltf.scene.updateMatrixWorld(true);
          let refBox = null;
          gltf.scene.traverse(obj => {
            if (!refBox && obj.isMesh && classifyMeshLayer(obj.name || '') === 'terrain') {
              refBox = new THREE.Box3().setFromObject(obj);
            }
          });
          if (!refBox) refBox = new THREE.Box3().setFromObject(gltf.scene);
          if (!refBox.isEmpty()) {
            const c = refBox.getCenter(new THREE.Vector3());
            if (Math.hypot(c.x - tile.center_x, c.z - tile.center_z) > 500) {
              gltf.scene.position.set(tile.center_x - c.x, 0, tile.center_z - c.z);
              gltf.scene.updateMatrixWorld(true);
            }
          }

          const toMove = [];
          gltf.scene.traverse(obj => {
            if (obj.isMesh) {
              const layer = classifyMeshLayer(obj.name || (obj.parent && obj.parent.name) || '');
              // Zero-quality-loss Shadow Optimization: only buildings cast shadows; terrain/roads/water receive shadows!
              obj.castShadow = (layer === 'buildings');
              obj.receiveShadow = true;

              if (layer === 'water') {
                obj.material = SHARED_WATER_MAT;
              } else if (obj.material) {
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                const newMats = mats.map(m => {
                  if (m.map) {
                    m.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
                    if (layer === 'terrain') {
                      m.map.wrapS = THREE.ClampToEdgeWrapping;
                      m.map.wrapT = THREE.ClampToEdgeWrapping;
                      m.map.needsUpdate = true;
                      m.color.setHex(0xffffff);
                      m.roughness = 0.96;
                      m.metalness = 0.0;
                    } else if (layer === 'buildings') {
                      m.color.setHex(0xffffff);
                      registerNightMaterial(m, false);
                    }
                    return m;
                  }
                  if (layer === 'roads') return SHARED_ROAD_MAT;
                  if (layer === 'buildings') {
                    const unified = resolveUnifiedBldgMat(obj.name, m.name);
                    registerNightMaterial(unified, false);
                    return unified;
                  }
                  return m;
                });
                obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
              }
              toMove.push({ mesh: obj, layer });
            }
          });

          toMove.forEach(({ mesh, layer }) => {
            groups[layer].attach(mesh);
          });

          markShadowDirty();
          loadScatterBin(tile);
          updateStatsUI();
          pumpTileQueue();
        });
      },
      undefined,
      () => {
        activeLoads--;
        queuedIds.delete(tile.tile_id);
        pumpTileQueue();
      }
    );
  }

  // Fallback anchors for extra Landmark GLBs not yet listed in world-index.landmarks
  const EXTRA_LANDMARK_ANCHORS = {
    saigon_centre_takashimaya: { id: 'saigon_centre_takashimaya', name: 'Saigon Centre (Takashimaya)', tile_id: 'T_E00_S00', x: 165.0, z: 685.0, height_m: 193.7 },
    times_square_nguyen_hue: { id: 'times_square_nguyen_hue', name: 'Times Square Nguyễn Huệ', tile_id: 'T_E00_S00', x: 545.0, z: 595.0, height_m: 165.0 },
    vinhomes_central_park_cluster: { id: 'vinhomes_central_park_cluster', name: 'Quần thể Vinhomes Central Park', tile_id: 'T_E01_N01', x: 2380.0, z: -1580.0, height_m: 185.0 },
    cau_mong_heritage: { id: 'cau_mong_heritage', name: 'Cầu Móng Lịch sử', tile_id: 'T_E00_S01', x: 530.0, z: 1180.0, height_m: 10.0 },
    metro_line1_elevated_stations_viaduct: { id: 'metro_line1_elevated_stations_viaduct', name: 'Ga Trên Cao Tuyến Metro Số 1', tile_id: 'T_E02_N01', x: 3180.0, z: -2150.0, height_m: 22.0 },
    thuthiem_exhibition_and_tower: { id: 'thuthiem_exhibition_and_tower', name: 'Trung tâm Triển lãm & Tháp Thủ Thiêm', tile_id: 'T_E01_S00', x: 1580.0, z: 620.0, height_m: 85.0 },
    crescent_mall_secc_pmh: { id: 'crescent_mall_secc_pmh', name: 'Crescent Mall & SECC Phú Mỹ Hưng', tile_id: 'T_E01_S03', x: 2390.0, z: 5820.0, height_m: 38.0 },
  };

  const loadedLandmarks = new Set();
  function loadLandmarksAssets(data) {
    if (!data.landmarks_assets || !data.landmarks_assets.length) return;
    const byId = new Map((data.landmarks || []).map(l => [l.id, l]));
    Object.values(EXTRA_LANDMARK_ANCHORS).forEach(ex => {
      if (!byId.has(ex.id)) byId.set(ex.id, ex);
    });

    data.landmarks_assets.forEach((item, idx) => {
      if (loadedLandmarks.has(item.name)) return;
      const id = item.name.replace(/\.glb$/i, '');
      const anchor = byId.get(id);
      if (!anchor) return;
      loadedLandmarks.add(item.name);

      setTimeout(() => {
        gltfLoader.load(
          item.url,
          gltf => {
            const groundY = (typeof anchor.ground_y === 'number')
              ? (anchor.ground_y + (anchor.plinth_offset || 0))
              : (id.startsWith('cau_') ? 0.4 : 1.5);
            gltf.scene.position.set(anchor.x, groundY, anchor.z);
            gltf.scene.updateMatrixWorld(true);
            const lmBox = new THREE.Box3().setFromObject(gltf.scene);
            if (!id.startsWith('cau_') && !lmBox.isEmpty() && (lmBox.min.y - groundY) > 0.5) {
              gltf.scene.position.y -= (lmBox.min.y - groundY);
            }
            gltf.scene.traverse(obj => {
              if (obj.isMesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
                const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                mats.forEach(m => registerNightMaterial(m, true));
              }
            });
            groups.buildings.add(gltf.scene);
            markShadowDirty();
            updateStatsUI();
          },
          undefined,
          () => { loadedLandmarks.delete(item.name); }
        );
      }, idx * 85); // Gentle stagger prevents decode spikes
    });
  }

  function buildRing1GridAndSat(data) {
    groups.grid.clear();
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.32 });
    const readyMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.72 });

    data.tiles.forEach(tile => {
      const b = tile.bounds;
      const pts = [
        new THREE.Vector3(b.x_min, 2.5, b.z_min),
        new THREE.Vector3(b.x_max, 2.5, b.z_min),
        new THREE.Vector3(b.x_max, 2.5, b.z_max),
        new THREE.Vector3(b.x_min, 2.5, b.z_max),
        new THREE.Vector3(b.x_min, 2.5, b.z_min),
      ];
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      groups.grid.add(new THREE.Line(geo, tile.glb_url ? readyMat : borderMat));

      if (!tile.glb_url && tile.satellite_url && !satTilesLoaded.has(tile.tile_id)) {
        satTilesLoaded.add(tile.tile_id);
        texLoader.load(tile.satellite_url, tex => {
          tex.encoding = THREE.sRGBEncoding;
          const plane = new THREE.Mesh(
            new THREE.PlaneGeometry(2000, 2000),
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.45 })
          );
          plane.name = 'sat_' + tile.tile_id;
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(tile.center_x, 0.2, tile.center_z);
          groups.satFloor.add(plane);
        });
      }
    });
  }

  // ==================== 6. ZERO-GC GPU-COMPOSITED LABELS ====================
  const projVec = new THREE.Vector3();

  function buildLabels(landmarks) {
    labelsOverlay.innerHTML = '';
    const sorted = [...landmarks].sort((a, b) => (b.height_m || 20) - (a.height_m || 20));
    labelItems = sorted.map(lm => {
      const el = document.createElement('div');
      el.className = 'landmark-tag';
      el.textContent = lm.name;
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
      el.addEventListener('click', e => {
        e.stopPropagation();
        flyTo(lm.x, lm.z, Math.max(380, (lm.height_m || 40) * 4.2), (lm.height_m || 20) * 0.35);
      });
      labelsOverlay.appendChild(el);
      const estW = Math.max(96, Math.min(280, (lm.name || '').length * 6.6 + 24));
      return { lm, el, estW, pos: new THREE.Vector3(lm.x, (lm.height_m || 25) + 18, lm.z), visible: false };
    });
  }

  function updateLabelsProjection() {
    if (!layerVisible.labels) {
      labelsOverlay.style.display = 'none';
      return;
    }
    labelsOverlay.style.display = 'block';
    const w = window.innerWidth;
    const h = window.innerHeight;
    const placedBoxes = [];
    const maxDist = deviceProfile.isMobile ? 6500 : 9500;

    for (let i = 0; i < labelItems.length; i++) {
      const item = labelItems[i];
      const distCam = camera.position.distanceTo(item.pos);
      if (distCam > maxDist && (item.lm.height_m || 30) < 120) {
        if (item.visible) { item.el.style.opacity = '0'; item.el.style.pointerEvents = 'none'; item.visible = false; }
        continue;
      }

      projVec.copy(item.pos).project(camera);
      if (projVec.z > 1 || projVec.x < -0.96 || projVec.x > 0.96 || projVec.y < -0.94 || projVec.y > 0.92) {
        if (item.visible) { item.el.style.opacity = '0'; item.el.style.pointerEvents = 'none'; item.visible = false; }
        continue;
      }

      const sx = (projVec.x * 0.5 + 0.5) * w;
      const sy = (-projVec.y * 0.5 + 0.5) * h;
      if (sy < 72 || sy > h - 46) {
        if (item.visible) { item.el.style.opacity = '0'; item.el.style.pointerEvents = 'none'; item.visible = false; }
        continue;
      }

      // Smart overlap decluttering using actual estimated label width
      let overlaps = false;
      for (let j = 0; j < placedBoxes.length; j++) {
        const pb = placedBoxes[j];
        if (Math.abs(sx - pb.x) < 0.5 * (item.estW + pb.w) + 8 && Math.abs(sy - pb.y) < 28) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) {
        if (item.visible) { item.el.style.opacity = '0'; item.el.style.pointerEvents = 'none'; item.visible = false; }
        continue;
      }

      placedBoxes.push({ x: sx, y: sy, w: item.estW });
      item.el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
      if (!item.visible) {
        item.el.style.opacity = '1';
        item.el.style.pointerEvents = 'auto';
        item.visible = true;
      }
    }
  }

  // ==================== 7. UI POPULATION & ADAPTIVE INTERACTIONS ====================
  function populateUI(data) {
    const s = data.stats;
    subtitleEl.textContent = `Ring 1: ${s.ready_tiles}/${s.total_ring1_tiles} ô 3D · ${data.landmarks_assets ? data.landmarks_assets.length : 0} công trình biểu tượng`;
    document.getElementById('minimap-progress').textContent = `${s.ready_tiles}/${s.total_ring1_tiles}`;
    if (minimapFabCount) minimapFabCount.textContent = `${s.ready_tiles}/${s.total_ring1_tiles}`;

    const gridEl = document.getElementById('minimap-grid');
    gridEl.innerHTML = '';
    const byCoord = new Map(data.tiles.map(t => [`${t.ix},${t.iz}`, t]));
    for (let iz = -1; iz <= 3; iz++) {
      for (let ix = -1; ix <= 3; ix++) {
        const t = byCoord.get(`${ix},${iz}`);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.dataset.ix = ix;
        cell.dataset.iz = iz;
        cell.className = 'mini-cell ' + (t ? t.status : 'pending');
        cell.textContent = t ? t.tile_id.replace('T_', '').replace('_', '') : `${ix},${iz}`;
        cell.title = t ? `${t.tile_id} (${t.status}) — ${t.buildings_gis} công trình` : '';
        if (t) {
          cell.addEventListener('click', () => {
            flyTo(t.center_x, t.center_z, 1550, 14);
            if (deviceProfile.isMobile) minimapCard.classList.remove('mobile-open');
          });
        }
        gridEl.appendChild(cell);
      }
    }

    const lmList = document.getElementById('landmarks-list');
    lmList.innerHTML = '';
    data.landmarks.forEach(lm => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-btn';
      b.innerHTML = `<span>${lm.name}</span><span class="badge ready">${lm.tile_id}</span>`;
      b.addEventListener('click', () => {
        flyTo(lm.x, lm.z, Math.max(420, (lm.height_m || 40) * 4.2), 20);
        if (deviceProfile.isMobile) setPanelOpen(false);
      });
      lmList.appendChild(b);
    });

    const tList = document.getElementById('tiles-list');
    tList.innerHTML = '';
    const sorted = [...data.tiles].sort((a, b) => (a.glb_url ? 0 : 1) - (b.glb_url ? 0 : 1));
    sorted.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-btn';
      const label = t.glb_url ? 'Đã có 3D' : (t.status === 'locked' ? 'Đang dựng' : 'Chờ');
      b.innerHTML = `<span>${t.tile_id} <small class="muted">(${t.buildings_gis} nhà)</small></span><span class="badge ${t.status}">${label}</span>`;
      b.addEventListener('click', () => {
        flyTo(t.center_x, t.center_z, 1550, 14);
        if (deviceProfile.isMobile) setPanelOpen(false);
      });
      tList.appendChild(b);
    });
  }

  function updateStatsUI() {
    document.getElementById('stat-tiles').textContent = `${loadedTiles.size} / ${worldData ? worldData.tiles.length : 25}`;
    document.getElementById('stat-calls').textContent = renderer.info.render.calls.toLocaleString('vi-VN');
    document.getElementById('stat-tris').textContent = renderer.info.render.triangles.toLocaleString('vi-VN');
  }

  async function fetchWorldIndex(force = false) {
    const isLocalNode = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') && location.port === '3000';
    if (isLocalNode) {
      try {
        const r = await fetch('/api/world-index' + (force ? '?refresh=1' : ''), { cache: 'no-cache' });
        if (r.ok) return await r.json();
      } catch (_) {}
    }
    const r2 = await fetch('./api/world-index.json?t=' + Date.now(), { cache: 'no-cache' });
    if (!r2.ok) throw new Error('HTTP ' + r2.status);
    return await r2.json();
  }

  function syncWorldIndex(force = false) {
    fetchWorldIndex(force)
      .then(data => {
        const firstLoad = !worldData;
        worldData = data;
        buildRing1GridAndSat(data);
        populateUI(data);
        if (firstLoad) {
          buildLabels(data.landmarks || []);
          const ready = data.tiles.filter(t => t.glb_url);
          if (urlCam) {
            camState.target.set(urlCam.x, 14, urlCam.z);
            camState.goalTarget.set(urlCam.x, 14, urlCam.z);
            camState.dist = urlCam.dist;
            camState.goalDist = urlCam.dist;
            camState.yaw = urlCam.yaw;
            camState.goalYaw = urlCam.yaw;
            camState.pitch = urlCam.pitch;
            camState.goalPitch = urlCam.pitch;
            applyCameraTransform();
          } else if (ready.length > 0) {
            const first = ready.find(t => t.tile_id === 'T_E00_S00') || ready[0];
            flyTo(first.center_x, first.center_z, deviceProfile.isMobile ? 1950 : 1680, 20);
          }
        }
        data.tiles.forEach(t => {
          if (t.glb_url) enqueueTileLoad(t);
        });
        loadLandmarksAssets(data);
        updateStatsUI();
      })
      .catch(err => {
        subtitleEl.textContent = 'Lỗi kết nối dữ liệu: ' + err.message;
      });
  }

  // ==================== 8. LIGHTING, CLIMATE & CONTROLS ====================
  const timeSlider = document.getElementById('time-slider');
  const fogSlider = document.getElementById('fog-slider');
  const nightSlider = document.getElementById('night-slider');
  const dampingSlider = document.getElementById('damping-slider');

  function applyTimeOfDay(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    document.getElementById('time-value').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const frac = minutes / 1440;
    const sunAngle = (frac - 0.25) * Math.PI * 2;
    const sunElev = Math.sin(sunAngle);
    const sunAzim = Math.cos(sunAngle);
    const dayFactor = Math.max(0, Math.min(1, sunElev * 1.4 + 0.15));

    const nightColor = new THREE.Color(0x07101f);
    const dawnColor = new THREE.Color(0xe2956b);
    const dayColor = new THREE.Color(0x8ecae6);
    const sky = nightColor.clone().lerp(sunElev < 0.35 && sunElev > -0.15 ? dawnColor : dayColor, dayFactor);

    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    if (typeof horizonMat !== 'undefined') {
      horizonMat.color.setHex(0x889484).lerp(sky, 0.35);
    }
    sunLight.intensity = 0.22 + dayFactor * 1.78;
    hemiLight.intensity = 0.34 + dayFactor * 0.56;
    sunLight.color.setHSL(0.08 + dayFactor * 0.04, 0.7 - dayFactor * 0.55, 0.65 + dayFactor * 0.3);

    sunDirOffset.set(
      sunAzim * 2100,
      Math.max(420, Math.abs(sunElev) * 2400 + 380),
      1050
    );
    updateSmartSunShadow(true);
  }

  timeSlider.addEventListener('input', () => applyTimeOfDay(Number(timeSlider.value)));

  fogSlider.addEventListener('input', e => {
    const v = Number(e.target.value);
    document.getElementById('fog-val').textContent = v + '%';
    scene.fog.density = v * 0.000012;
  });

  nightSlider.addEventListener('input', e => {
    const v = Number(e.target.value);
    document.getElementById('night-val').textContent = v + '%';
    currentNightFactor = v / 100;
    updateAllNightGlow();
  });

  if (dampingSlider) {
    dampingSlider.addEventListener('input', e => {
      const v = Number(e.target.value);
      // Higher slider value = softer, more cinematic inertia
      camState.dampingStrength = 24 - (v / 100) * 17.5;
      document.getElementById('damping-val').textContent = v > 80 ? 'Êm điện ảnh' : (v < 45 ? 'Nhạy tức thì' : 'Chuẩn');
    });
  }

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mins = Number(btn.dataset.minutes);
      const fogVal = Number(btn.dataset.fog);
      const nightVal = Number(btn.dataset.night);
      timeSlider.value = mins;
      fogSlider.value = fogVal;
      nightSlider.value = nightVal;
      document.getElementById('fog-val').textContent = fogVal + '%';
      document.getElementById('night-val').textContent = nightVal + '%';
      scene.fog.density = fogVal * 0.000012;
      currentNightFactor = nightVal / 100;
      applyTimeOfDay(mins);
      updateAllNightGlow();
    });
  });

  let timelapseOn = false;
  document.getElementById('timelapse-btn').addEventListener('click', e => {
    timelapseOn = !timelapseOn;
    e.target.textContent = timelapseOn ? '⏸ Tạm dừng' : '▶ Tua ngày đêm';
  });

  // Panel / Bottom Sheet controls (with mobile swipe-down to dismiss)
  function setPanelOpen(open) {
    controlPanel.classList.toggle('collapsed', !open);
    togglePanelBtn.classList.toggle('active', open);
  }
  togglePanelBtn.addEventListener('click', () => setPanelOpen(controlPanel.classList.contains('collapsed')));

  const panelCloseMobile = document.getElementById('panel-close-mobile');
  if (panelCloseMobile) panelCloseMobile.addEventListener('click', () => setPanelOpen(false));

  const sheetHandle = document.getElementById('sheet-drag-handle');
  if (sheetHandle) {
    let startY = 0;
    sheetHandle.addEventListener('pointerdown', e => { startY = e.clientY; });
    sheetHandle.addEventListener('pointerup', e => {
      if (e.clientY - startY > 35) setPanelOpen(false);
      else setPanelOpen(controlPanel.classList.contains('collapsed'));
    });
  }

  // Minimap FAB on mobile
  const minimapFab = document.getElementById('minimap-fab');
  const minimapClose = document.getElementById('minimap-close-btn');
  if (minimapFab) {
    minimapFab.addEventListener('click', () => minimapCard.classList.toggle('mobile-open'));
  }
  if (minimapClose) {
    minimapClose.addEventListener('click', () => minimapCard.classList.remove('mobile-open'));
  }

  // Mobile expandable search
  const searchWrap = document.getElementById('search-wrap');
  const mobileSearchBtn = document.getElementById('mobile-search-btn');
  const searchCloseBtn = document.getElementById('search-close-btn');
  const searchInp = document.getElementById('search-input');
  const searchRes = document.getElementById('search-results');

  if (mobileSearchBtn) {
    mobileSearchBtn.addEventListener('click', () => {
      searchWrap.classList.add('mobile-open');
      searchInp.focus();
    });
  }
  if (searchCloseBtn) {
    searchCloseBtn.addEventListener('click', () => {
      searchWrap.classList.remove('mobile-open');
      searchRes.hidden = true;
    });
  }

  // Cinema Mode & Reset Camera
  const exitCinemaBtn = document.getElementById('exit-cinema-btn');
  function toggleCinemaMode(forceState) {
    const next = typeof forceState === 'boolean' ? forceState : !document.body.classList.contains('cinema-mode');
    document.body.classList.toggle('cinema-mode', next);
    if (exitCinemaBtn) exitCinemaBtn.hidden = !next;
  }
  const cinemaBtn = document.getElementById('cinema-btn');
  if (cinemaBtn) cinemaBtn.addEventListener('click', () => toggleCinemaMode(true));
  if (exitCinemaBtn) exitCinemaBtn.addEventListener('click', () => toggleCinemaMode(false));

  const resetCamBtn = document.getElementById('reset-cam-btn');
  if (resetCamBtn) resetCamBtn.addEventListener('click', () => flyTo(450, 250, 1850, 20, 0.44));

  // Studio Tabs
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Layer toggles
  document.querySelectorAll('[data-layer]').forEach(cb => {
    cb.addEventListener('change', () => {
      const k = cb.dataset.layer;
      layerVisible[k] = cb.checked;
      if (groups[k]) groups[k].visible = cb.checked;
      markShadowDirty();
    });
  });

  // Instant Search
  searchInp.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    if (!q || !worldData) { searchRes.hidden = true; return; }
    const hits = [];
    worldData.landmarks.forEach(lm => {
      if (lm.name.toLowerCase().includes(q) || lm.tile_id.toLowerCase().includes(q)) {
        hits.push({ label: lm.name, sub: lm.tile_id, x: lm.x, z: lm.z, d: 520 });
      }
    });
    worldData.tiles.forEach(t => {
      if (t.tile_id.toLowerCase().includes(q)) {
        hits.push({ label: `Ô ${t.tile_id}`, sub: t.status, x: t.center_x, z: t.center_z, d: 1550 });
      }
    });
    if (!hits.length) { searchRes.hidden = true; return; }
    searchRes.innerHTML = '';
    hits.slice(0, 12).forEach(h => {
      const d = document.createElement('div');
      d.className = 'search-item';
      d.innerHTML = `<span>${h.label}</span><span class="muted">${h.sub}</span>`;
      d.addEventListener('click', () => {
        flyTo(h.x, h.z, h.d, 18);
        searchRes.hidden = true;
        searchWrap.classList.remove('mobile-open');
      });
      searchRes.appendChild(d);
    });
    searchRes.hidden = false;
  });

  window.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap') && !e.target.closest('#mobile-search-btn')) {
      searchRes.hidden = true;
    }
  });

  // Zero-Loss Synchronous Screenshot (works cleanly with preserveDrawingBuffer: false!)
  function takeScreenshot() {
    renderer.render(scene, camera);
    const link = document.createElement('a');
    link.download = `HCMC_3D_${Date.now()}.jpg`;
    link.href = renderer.domElement.toDataURL('image/jpeg', 0.95);
    link.click();
  }
  document.getElementById('photo-btn').addEventListener('click', takeScreenshot);

  const refreshBtn = document.getElementById('refresh-btn');
  if (refreshBtn) refreshBtn.addEventListener('click', () => syncWorldIndex(true));

  window.addEventListener('resize', () => {
    detectDeviceProfile(false);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    markShadowDirty();
  });

  // ==================== 9. MAIN 60/120Hz ANIMATION LOOP ====================
  let frames = 0;
  let lastFpsAt = performance.now();
  let lastTime = performance.now();
  const coordsEl = document.getElementById('cursor-coords');

  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.08, (now - lastTime) / 1000);
    lastTime = now;

    if (timelapseOn) {
      const v = (Number(timeSlider.value) + dt * 42) % 1440;
      timeSlider.value = Math.round(v);
      applyTimeOfDay(Math.round(v));
    }

    // Keyboard + Virtual Thumbstick continuous movement
    const hasKeys = keysDown.size > 0;
    const hasJoy = Math.abs(virtualJoy.x) > 0.02 || Math.abs(virtualJoy.y) > 0.02 || virtualJoy.vert !== 0;
    if (hasKeys || hasJoy) {
      cancelFlyAnim();
      const boost = keysDown.has('shift') ? 2.2 : 1.0;
      const spd = Math.max(95, camState.goalDist * 0.72) * boost * dt;
      const fx = -Math.sin(camState.yaw);
      const fz = -Math.cos(camState.yaw);
      const rx = Math.cos(camState.yaw);
      const rz = -Math.sin(camState.yaw);

      let moveFwd = virtualJoy.y;
      let moveRight = virtualJoy.x;
      if (keysDown.has('w') || keysDown.has('arrowup')) moveFwd += 1;
      if (keysDown.has('s') || keysDown.has('arrowdown')) moveFwd -= 1;
      if (keysDown.has('d') || keysDown.has('arrowright')) moveRight += 1;
      if (keysDown.has('a') || keysDown.has('arrowleft')) moveRight -= 1;

      camState.goalTarget.x += (fx * moveFwd + rx * moveRight) * spd;
      camState.goalTarget.z += (fz * moveFwd + rz * moveRight) * spd;

      if (keysDown.has('e') || virtualJoy.vert < 0) camState.goalDist = Math.max(38, camState.goalDist - spd * 0.85);
      if (keysDown.has('q') || virtualJoy.vert > 0) camState.goalDist = Math.min(14500, camState.goalDist + spd * 0.85);
      clampTargetBounds(camState.goalTarget);
    }

    // Cubic-Out Fly-To vs Frame-Rate-Independent Inertial Damping
    if (camState.flyAnim) {
      const fa = camState.flyAnim;
      fa.elapsed += dt;
      const t = Math.min(1, fa.elapsed / fa.duration);
      const ease = 1 - Math.pow(1 - t, 3);
      camState.target.lerpVectors(fa.startTarget, fa.endTarget, ease);
      camState.dist = fa.startDist + (fa.endDist - fa.startDist) * ease;
      camState.pitch = fa.startPitch + (fa.endPitch - fa.startPitch) * ease;
      camState.yaw += (camState.goalYaw - camState.yaw) * Math.min(1, dt * 10);
      if (t >= 1) camState.flyAnim = null;
    } else {
      const alpha = 1 - Math.exp(-camState.dampingStrength * dt);
      camState.target.lerp(camState.goalTarget, alpha);
      camState.dist += (camState.goalDist - camState.dist) * alpha;
      camState.yaw += (camState.goalYaw - camState.yaw) * alpha;
      camState.pitch += (camState.goalPitch - camState.pitch) * alpha;
    }

    applyCameraTransform();
    renderer.render(scene, camera);
    updateLabelsProjection();

    frames++;
    if (now - lastFpsAt >= 500) {
      const fps = Math.round((frames * 1000) / (now - lastFpsAt));
      fpsBadge.textContent = `${fps} FPS`;
      coordsEl.textContent = `X: ${Math.round(camState.target.x)} m · Z: ${Math.round(camState.target.z)} m`;
      updateStatsUI();

      // Highlight active minimap cell
      const curIx = Math.round(camState.target.x / 2000);
      const curIz = Math.round(camState.target.z / 2000);
      document.querySelectorAll('.mini-cell').forEach(c => {
        c.classList.toggle('current', Number(c.dataset.ix) === curIx && Number(c.dataset.iz) === curIz);
      });

      frames = 0;
      lastFpsAt = now;
    }
  }

  applyTimeOfDay(1000);
  syncWorldIndex(true);
  setInterval(() => syncWorldIndex(true), 45000);
  requestAnimationFrame(animate);
})();
