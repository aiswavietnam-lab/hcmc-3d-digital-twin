/* TP.HCM 3D Digital Twin — Interactive Web Viewer (Three.js r128) */
(function () {
  'use strict';

  const container = document.getElementById('viewport-container');
  const subtitleEl = document.getElementById('subtitle-status');
  const fpsBadge = document.getElementById('fps-badge');
  const labelsOverlay = document.getElementById('labels-overlay');

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd99b66);
  scene.fog = new THREE.FogExp2(0xd99b66, 0.00018);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2.0, 28000);

  // Lights
  const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x334155, 0.65);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xffedd5, 1.8);
  sunLight.position.set(1800, 1600, 1200);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 100;
  sunLight.shadow.camera.far = 9000;
  const d = 3200;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);
  scene.add(sunLight.target);

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
    grid: true,
    labels: true,
  };

  // Orbit + Fly Camera Controller
  const camState = {
    target: new THREE.Vector3(1200, 12, -800),
    yaw: -0.68,
    pitch: 0.42,
    dist: 2400,
    flyGoal: null,
  };
  const keysDown = new Set();

  function updateCameraFromState() {
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
    sunLight.target.position.copy(camState.target);
    sunLight.position.set(camState.target.x + 1800, 1800, camState.target.z + 1100);
    document.getElementById('cursor-coords').textContent =
      `X: ${Math.round(camState.target.x)} m · Z: ${Math.round(camState.target.z)} m`;
  }
  updateCameraFromState();

  function flyTo(x, z, dist = 1100, y = 24) {
    camState.flyGoal = {
      target: new THREE.Vector3(x, y, z),
      dist,
      pitch: 0.44,
    };
  }

  // Pointer interactions
  let dragMode = null;
  let lastX = 0;
  let lastY = 0;
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());
  renderer.domElement.addEventListener('mousedown', e => {
    camState.flyGoal = null;
    dragMode = e.button === 0 ? 'orbit' : 'pan';
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mouseup', () => { dragMode = null; });
  window.addEventListener('mousemove', e => {
    if (!dragMode) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (dragMode === 'orbit') {
      camState.yaw -= dx * 0.0055;
      camState.pitch = Math.max(0.06, Math.min(1.48, camState.pitch + dy * 0.0055));
    } else {
      const panSpeed = camState.dist * 0.0014;
      const forwardX = -Math.sin(camState.yaw);
      const forwardZ = -Math.cos(camState.yaw);
      const rightX = Math.cos(camState.yaw);
      const rightZ = -Math.sin(camState.yaw);
      camState.target.x -= (dx * rightX - dy * forwardX) * panSpeed;
      camState.target.z -= (dx * rightZ - dy * forwardZ) * panSpeed;
    }
  });
  renderer.domElement.addEventListener('wheel', e => {
    e.preventDefault();
    camState.flyGoal = null;
    const factor = e.deltaY > 0 ? 1.12 : 0.89;
    camState.dist = Math.max(40, Math.min(14000, camState.dist * factor));
  }, { passive: false });

  window.addEventListener('keydown', e => {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keysDown.add(k);
    if (k === 'p') takeScreenshot();
  });
  window.addEventListener('keyup', e => keysDown.delete(e.key.toLowerCase()));

  // Tree prototypes (4 Saigon species)
  const treeCanopyGeo = new THREE.ConeGeometry(4.5, 11, 7);
  treeCanopyGeo.translate(0, 9.5, 0);
  const treeTrunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 5, 5);
  treeTrunkGeo.translate(0, 2.5, 0);
  const speciesColors = [0x1b4d2b, 0x2f6e38, 0x3f8442, 0x26634f];
  const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x4b382a, roughness: 0.95 });

  // State tracking
  const loadedTiles = new Map();
  const loadingTiles = new Set();
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

  function loadScatterBin(tile) {
    if (!tile.scatter_url) return;
    fetch(tile.scatter_url)
      .then(r => r.ok ? r.arrayBuffer() : null)
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
        const dummy = new THREE.Object3D();
        const tileTreeGroup = new THREE.Group();
        const trunkTotal = count;
        const trunkInst = new THREE.InstancedMesh(treeTrunkGeo, treeTrunkMat, trunkTotal);
        let tIdx = 0;
        bySpecies.forEach((arr, sp) => {
          if (!arr.length) return;
          const mat = new THREE.MeshStandardMaterial({ color: speciesColors[sp], roughness: 0.85 });
          const inst = new THREE.InstancedMesh(treeCanopyGeo, mat, arr.length);
          inst.castShadow = false;
          arr.forEach((t, idx) => {
            dummy.position.set(t.x, t.y, t.z);
            dummy.rotation.set(0, t.rotY, 0);
            dummy.scale.setScalar(t.scale);
            dummy.updateMatrix();
            inst.setMatrixAt(idx, dummy.matrix);
            trunkInst.setMatrixAt(tIdx++, dummy.matrix);
          });
          inst.instanceMatrix.needsUpdate = true;
          tileTreeGroup.add(inst);
        });
        trunkInst.instanceMatrix.needsUpdate = true;
        tileTreeGroup.add(trunkInst);
        groups.trees.add(tileTreeGroup);
        totalTreesCount += count;
        document.getElementById('stat-trees').textContent = totalTreesCount.toLocaleString('vi-VN');
      })
      .catch(() => {});
  }

  function loadTileGLB(tile) {
    if (!tile.glb_url || loadedTiles.has(tile.tile_id) || loadingTiles.has(tile.tile_id)) return;
    loadingTiles.add(tile.tile_id);
    gltfLoader.load(
      tile.glb_url,
      gltf => {
        loadingTiles.delete(tile.tile_id);
        loadedTiles.set(tile.tile_id, gltf.scene);
        // Remove satellite placeholder floor if present
        const satMesh = groups.satFloor.getObjectByName('sat_' + tile.tile_id);
        if (satMesh) groups.satFloor.remove(satMesh);

        const toMove = [];
        gltf.scene.traverse(obj => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (obj.material) {
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              mats.forEach(m => {
                if (m.name && m.name.toUpperCase().includes('WATER')) {
                  m.roughness = 0.15;
                  m.metalness = 0.35;
                }
              });
            }
            toMove.push(obj);
          }
        });
        toMove.forEach(mesh => {
          const layer = classifyMeshLayer(mesh.name || (mesh.parent && mesh.parent.name) || '');
          mesh.updateWorldMatrix(true, false);
          groups[layer].add(mesh);
        });
        loadScatterBin(tile);
        updateStatsUI();
      },
      undefined,
      () => {
        loadingTiles.delete(tile.tile_id);
      }
    );
  }

  function buildRing1GridAndSat(data) {
    groups.grid.clear();
    const borderMat = new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.35 });
    const readyMat = new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.75 });

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
            new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.42 })
          );
          plane.name = 'sat_' + tile.tile_id;
          plane.rotation.x = -Math.PI / 2;
          plane.position.set(tile.center_x, 0.2, tile.center_z);
          groups.satFloor.add(plane);
        });
      }
    });
  }

  function buildLabels(landmarks) {
    labelsOverlay.innerHTML = '';
    labelItems = landmarks.map(lm => {
      const el = document.createElement('div');
      el.className = 'landmark-tag';
      el.textContent = lm.name;
      el.addEventListener('click', () => flyTo(lm.x, lm.z, Math.max(420, (lm.height_m || 40) * 4.5), (lm.height_m || 20) * 0.4));
      labelsOverlay.appendChild(el);
      return { lm, el, pos: new THREE.Vector3(lm.x, (lm.height_m || 25) + 18, lm.z) };
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
    for (const item of labelItems) {
      const v = item.pos.clone().project(camera);
      if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) {
        item.el.style.display = 'none';
      } else {
        item.el.style.display = 'block';
        item.el.style.left = ((v.x * 0.5 + 0.5) * w) + 'px';
        item.el.style.top = ((-v.y * 0.5 + 0.5) * h) + 'px';
      }
    }
  }

  function populateUI(data) {
    const s = data.stats;
    subtitleEl.textContent = `Ring 1: ${s.ready_tiles}/${s.total_ring1_tiles} ô 3D đã xong · ${s.locked_tiles} đang dựng · Tự động đồng bộ`;
    document.getElementById('minimap-progress').textContent = `${s.ready_tiles}/${s.total_ring1_tiles}`;

    // Minimap 5x5 (iz from -1 to 3, ix from -1 to 3)
    const gridEl = document.getElementById('minimap-grid');
    gridEl.innerHTML = '';
    const byCoord = new Map(data.tiles.map(t => [`${t.ix},${t.iz}`, t]));
    for (let iz = -1; iz <= 3; iz++) {
      for (let ix = -1; ix <= 3; ix++) {
        const t = byCoord.get(`${ix},${iz}`);
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'mini-cell ' + (t ? t.status : 'pending');
        cell.textContent = t ? t.tile_id.replace('T_', '').replace('_', '') : `${ix},${iz}`;
        cell.title = t ? `${t.tile_id} (${t.status}) — ${t.buildings_gis} công trình` : '';
        if (t) cell.addEventListener('click', () => flyTo(t.center_x, t.center_z, 1600, 10));
        gridEl.appendChild(cell);
      }
    }

    // Landmarks list
    const lmList = document.getElementById('landmarks-list');
    lmList.innerHTML = '';
    data.landmarks.forEach(lm => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-btn';
      b.innerHTML = `<span>${lm.name}</span><span class="badge ready">${lm.tile_id}</span>`;
      b.addEventListener('click', () => flyTo(lm.x, lm.z, Math.max(450, (lm.height_m || 40) * 4.5), 20));
      lmList.appendChild(b);
    });

    // Tiles list
    const tList = document.getElementById('tiles-list');
    tList.innerHTML = '';
    const sorted = [...data.tiles].sort((a, b) => (a.glb_url ? 0 : 1) - (b.glb_url ? 0 : 1));
    sorted.forEach(t => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'item-btn';
      const label = t.glb_url ? 'Đã có 3D' : (t.status === 'locked' ? 'Đang dựng' : 'Chờ');
      b.innerHTML = `<span>${t.tile_id} <small class="muted">(${t.buildings_gis} nhà)</small></span><span class="badge ${t.status}">${label}</span>`;
      b.addEventListener('click', () => flyTo(t.center_x, t.center_z, 1550, 12));
      tList.appendChild(b);
    });
  }

  function updateStatsUI() {
    document.getElementById('stat-tiles').textContent = `${loadedTiles.size} / ${worldData ? worldData.tiles.length : 25}`;
    document.getElementById('stat-calls').textContent = renderer.info.render.calls.toLocaleString('vi-VN');
    document.getElementById('stat-tris').textContent = renderer.info.render.triangles.toLocaleString('vi-VN');
  }

  async function fetchWorldIndex(force = false) {
    const isLocalNode = location.hostname === '127.0.0.1' || location.hostname === 'localhost';
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
          if (ready.length > 0) {
            const first = ready.find(t => t.tile_id === 'T_E00_S00') || ready[0];
            flyTo(first.center_x, first.center_z, 1750, 20);
          }
        }
        data.tiles.forEach(t => {
          if (t.glb_url) loadTileGLB(t);
        });
        loadLandmarksAssets(data);
        updateStatsUI();
      })
      .catch(err => {
        subtitleEl.textContent = 'Lỗi kết nối máy chủ: ' + err.message;
      });
  }

  const loadedLandmarks = new Set();
  function loadLandmarksAssets(data) {
    if (!data.landmarks_assets || !data.landmarks_assets.length) return;
    const byId = new Map((data.landmarks || []).map(l => [l.id, l]));
    data.landmarks_assets.forEach(item => {
      if (loadedLandmarks.has(item.name)) return;
      const id = item.name.replace(/\.glb$/i, '');
      const anchor = byId.get(id);
      if (!anchor) return;
      loadedLandmarks.add(item.name);
      gltfLoader.load(
        item.url,
        gltf => {
          gltf.scene.position.set(anchor.x, 4.5, anchor.z);
          gltf.scene.traverse(obj => {
            if (obj.isMesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
          groups.buildings.add(gltf.scene);
          updateStatsUI();
        },
        undefined,
        () => { loadedLandmarks.delete(item.name); }
      );
    });
  }

  // Lighting & Climate controls
  function applyTimeOfDay(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    document.getElementById('time-value').textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const frac = minutes / 1440;
    const sunElev = Math.sin((frac - 0.25) * Math.PI * 2);
    const dayFactor = Math.max(0, Math.min(1, sunElev * 1.4 + 0.15));

    const nightColor = new THREE.Color(0x0a1324);
    const dawnColor = new THREE.Color(0xe2956b);
    const dayColor = new THREE.Color(0x8ecae6);
    const sky = nightColor.clone().lerp(sunElev < 0.35 && sunElev > -0.15 ? dawnColor : dayColor, dayFactor);

    scene.background.copy(sky);
    scene.fog.color.copy(sky);
    sunLight.intensity = 0.25 + dayFactor * 1.75;
    hemiLight.intensity = 0.35 + dayFactor * 0.55;
    sunLight.color.setHSL(0.08 + dayFactor * 0.04, 0.7 - dayFactor * 0.55, 0.65 + dayFactor * 0.3);
  }

  const timeSlider = document.getElementById('time-slider');
  timeSlider.addEventListener('input', () => applyTimeOfDay(Number(timeSlider.value)));
  document.getElementById('fog-slider').addEventListener('input', e => {
    scene.fog.density = Number(e.target.value) * 0.000012;
  });

  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const mins = Number(btn.dataset.minutes);
      timeSlider.value = mins;
      applyTimeOfDay(mins);
      const fogVal = Number(btn.dataset.fog);
      document.getElementById('fog-slider').value = fogVal;
      scene.fog.density = fogVal * 0.000012;
    });
  });

  let timelapseOn = false;
  document.getElementById('timelapse-btn').addEventListener('click', e => {
    timelapseOn = !timelapseOn;
    e.target.textContent = timelapseOn ? '⏸ Tạm dừng' : '▶ Tua ngày đêm';
  });

  // Tabs & Panel toggle
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('pane-' + btn.dataset.tab).classList.add('active');
    });
  });
  document.getElementById('toggle-panel-btn').addEventListener('click', e => {
    const p = document.getElementById('control-panel');
    p.classList.toggle('collapsed');
    e.currentTarget.classList.toggle('active', !p.classList.contains('collapsed'));
  });

  // Layer checkboxes
  document.querySelectorAll('[data-layer]').forEach(cb => {
    cb.addEventListener('change', () => {
      const k = cb.dataset.layer;
      layerVisible[k] = cb.checked;
      if (groups[k]) groups[k].visible = cb.checked;
    });
  });

  // Search box
  const searchInp = document.getElementById('search-input');
  const searchRes = document.getElementById('search-results');
  searchInp.addEventListener('input', () => {
    const q = searchInp.value.trim().toLowerCase();
    if (!q || !worldData) { searchRes.hidden = true; return; }
    const hits = [];
    worldData.landmarks.forEach(lm => {
      if (lm.name.toLowerCase().includes(q) || lm.tile_id.toLowerCase().includes(q)) {
        hits.push({ label: lm.name, sub: lm.tile_id, x: lm.x, z: lm.z, d: 550 });
      }
    });
    worldData.tiles.forEach(t => {
      if (t.tile_id.toLowerCase().includes(q)) {
        hits.push({ label: `Ô ${t.tile_id}`, sub: t.status, x: t.center_x, z: t.center_z, d: 1600 });
      }
    });
    if (!hits.length) { searchRes.hidden = true; return; }
    searchRes.innerHTML = '';
    hits.slice(0, 12).forEach(h => {
      const d = document.createElement('div');
      d.className = 'search-item';
      d.innerHTML = `<span>${h.label}</span><span class="muted">${h.sub}</span>`;
      d.addEventListener('click', () => { flyTo(h.x, h.z, h.d, 18); searchRes.hidden = true; });
      searchRes.appendChild(d);
    });
    searchRes.hidden = false;
  });
  window.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) searchRes.hidden = true;
  });

  function takeScreenshot() {
    const link = document.createElement('a');
    link.download = `HCMC_3D_${Date.now()}.png`;
    link.href = renderer.domElement.toDataURL('image/png');
    link.click();
  }
  document.getElementById('photo-btn').addEventListener('click', takeScreenshot);
  document.getElementById('refresh-btn').addEventListener('click', () => syncWorldIndex(true));

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // Main animation loop
  let frames = 0;
  let lastFpsAt = performance.now();
  let lastTime = performance.now();
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;

    if (timelapseOn) {
      let v = (Number(timeSlider.value) + dt * 45) % 1440;
      timeSlider.value = Math.round(v);
      applyTimeOfDay(Math.round(v));
    }

    if (camState.flyGoal) {
      camState.target.lerp(camState.flyGoal.target, 0.09);
      camState.dist += (camState.flyGoal.dist - camState.dist) * 0.09;
      camState.pitch += (camState.flyGoal.pitch - camState.pitch) * 0.09;
      if (camState.target.distanceTo(camState.flyGoal.target) < 2 && Math.abs(camState.dist - camState.flyGoal.dist) < 5) {
        camState.flyGoal = null;
      }
    }

    if (keysDown.size > 0) {
      const spd = Math.max(80, camState.dist * 0.65) * dt;
      const fx = -Math.sin(camState.yaw);
      const fz = -Math.cos(camState.yaw);
      const rx = Math.cos(camState.yaw);
      const rz = -Math.sin(camState.yaw);
      if (keysDown.has('w') || keysDown.has('arrowup')) { camState.target.x += fx * spd; camState.target.z += fz * spd; }
      if (keysDown.has('s') || keysDown.has('arrowdown')) { camState.target.x -= fx * spd; camState.target.z -= fz * spd; }
      if (keysDown.has('a') || keysDown.has('arrowleft')) { camState.target.x -= rx * spd; camState.target.z -= rz * spd; }
      if (keysDown.has('d') || keysDown.has('arrowright')) { camState.target.x += rx * spd; camState.target.z += rz * spd; }
      if (keysDown.has('e')) camState.dist = Math.max(40, camState.dist - spd);
      if (keysDown.has('q')) camState.dist = Math.min(14000, camState.dist + spd);
    }

    updateCameraFromState();
    renderer.render(scene, camera);
    updateLabelsProjection();

    frames++;
    if (now - lastFpsAt >= 600) {
      const fps = Math.round((frames * 1000) / (now - lastFpsAt));
      fpsBadge.textContent = `${fps} FPS`;
      updateStatsUI();
      frames = 0;
      lastFpsAt = now;
    }
  }

  applyTimeOfDay(1000);
  syncWorldIndex(true);
  setInterval(() => syncWorldIndex(true), 30000);
  requestAnimationFrame(animate);
})();
