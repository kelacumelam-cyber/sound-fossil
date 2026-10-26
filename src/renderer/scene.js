import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mulberry32 } from '../core/prng.js';

function disposeMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    material.forEach(disposeMaterial);
    return;
  }
  if (material.map) material.map.dispose();
  material.dispose();
}

function makePlaqueTexture(state) {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 2048, 512);
  gradient.addColorStop(0, '#211a14');
  gradient.addColorStop(0.55, '#18120e');
  gradient.addColorStop(1, '#241b14');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2048, 512);

  ctx.strokeStyle = 'rgba(231, 201, 156, 0.2)';
  ctx.lineWidth = 3;
  ctx.strokeRect(38, 38, 2048 - 76, 512 - 76);
  ctx.strokeStyle = 'rgba(212, 154, 88, 0.5)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(78, 118);
  ctx.lineTo(78 + 150, 118);
  ctx.stroke();

  ctx.fillStyle = '#c9a26f';
  ctx.font = '500 36px "Cascadia Mono", Consolas, monospace';
  ctx.letterSpacing = '10px';
  ctx.fillText('SOUND FOSSIL  ·  SPECIMEN LABEL', 78, 88);

  const title = state?.name || 'Untitled specimen';
  ctx.fillStyle = '#ecdfc8';
  ctx.font = '400 126px "Palatino Linotype", Georgia, serif';
  let size = 126;
  while (ctx.measureText(title).width > 1560 && size > 60) {
    size -= 6;
    ctx.font = `400 ${size}px "Palatino Linotype", Georgia, serif`;
  }
  ctx.fillText(title, 74, 278);

  ctx.fillStyle = 'rgba(185, 165, 136, 0.92)';
  ctx.font = '400 38px "Cascadia Mono", Consolas, monospace';
  const meta = [state?.code || 'SF-0000', state?.tone || '—', state?.duration || '—', `#${state?.hash || '--------'}`]
    .filter(Boolean)
    .join('   /   ');
  ctx.fillText(meta, 78, 368);

  ctx.strokeStyle = 'rgba(231, 201, 156, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(78, 408);
  ctx.lineTo(1970, 408);
  ctx.stroke();

  ctx.fillStyle = 'rgba(151, 133, 111, 0.9)';
  ctx.font = '400 26px "Cascadia Mono", Consolas, monospace';
  ctx.letterSpacing = '3px';
  ctx.fillText('AUDITORY FOSSIL  ·  MADE ENTIRELY OFFLINE', 78, 458);
  ctx.textAlign = 'right';
  ctx.fillText('1 : 1  SCALE', 1970, 458);
  ctx.textAlign = 'left';

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function createViewer(canvas, stage) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.62;
  controls.zoomSpeed = 0.75;
  controls.panSpeed = 0.6;
  controls.minDistance = 3.2;
  controls.maxDistance = 12;
  controls.minPolarAngle = 0.22;
  controls.maxPolarAngle = Math.PI * 0.56;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.55;
  controls.target.set(0, 1.35, 0);
  controls.update();

  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  scene.environment = pmrem.fromScene(room, 0.04).texture;
  scene.environmentIntensity = 0.36;
  room.dispose?.();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xd8c3a4, 0x162522, 0.75);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffd0a0, 2.8);
  key.position.set(4.2, 7.2, 5.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -2;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 20;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.02;
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x86b6a9, 2.1);
  rim.position.set(-5.4, 3.6, -4.8);
  scene.add(rim);

  const fill = new THREE.DirectionalLight(0xffdfb8, 0.65);
  fill.position.set(-3.6, 1.8, 5.2);
  scene.add(fill);

  const baseGlow = new THREE.PointLight(0xd89a55, 1.1, 4.2, 2);
  baseGlow.position.set(0, 0.32, 1.6);
  scene.add(baseGlow);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 24),
    new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.42 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.208;
  floor.receiveShadow = true;
  scene.add(floor);

  const plinthGroup = new THREE.Group();
  scene.add(plinthGroup);

  const plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(1.17, 1.29, 0.2, 96, 1),
    new THREE.MeshStandardMaterial({
      color: 0x1a1511,
      roughness: 0.72,
      metalness: 0.22,
    }),
  );
  plinth.position.y = -0.1;
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  plinthGroup.add(plinth);

  const brassRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.172, 0.0065, 8, 128),
    new THREE.MeshStandardMaterial({
      color: 0xb9854e,
      roughness: 0.3,
      metalness: 0.85,
      emissive: 0x2a1808,
      emissiveIntensity: 0.5,
    }),
  );
  brassRing.rotation.x = Math.PI / 2;
  brassRing.position.y = 0.002;
  plinthGroup.add(brassRing);

  const plaqueMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.48,
    metalness: 0.26,
    map: makePlaqueTexture(null),
  });
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.96, 0.24), plaqueMaterial);
  plaque.position.set(0, -0.085, 1.242);
  plinthGroup.add(plaque);

  const grid = new THREE.PolarGridHelper(2.35, 8, 5, 120, 0x8d6f4e, 0x453a2f);
  grid.position.y = 0.004;
  grid.material.transparent = true;
  grid.material.opacity = 0.27;
  grid.material.depthWrite = false;
  grid.visible = false;
  scene.add(grid);

  let sculpture = null;
  let specimenMeta = null;
  let currentPlaqueState = null;

  function updatePlaque(state) {
    currentPlaqueState = state;
    const old = plaqueMaterial.map;
    plaqueMaterial.map = makePlaqueTexture(state);
    plaqueMaterial.needsUpdate = true;
    if (old) old.dispose();
  }

  function clearSculpture() {
    if (sculpture) {
      scene.remove(sculpture);
      sculpture.geometry.dispose();
      disposeMaterial(sculpture.material);
      sculpture = null;
    }
    specimenMeta = null;
  }

  function setSculpture(geometryData, plaqueState, options = {}) {
    clearSculpture();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(geometryData.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(geometryData.colors, 3));
    geometry.setIndex(new THREE.BufferAttribute(geometryData.indices, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    geometry.computeBoundingBox();

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.58,
      metalness: 0.24,
      envMapIntensity: 0.5,
      side: THREE.FrontSide,
    });

    sculpture = new THREE.Mesh(geometry, material);
    sculpture.castShadow = true;
    sculpture.receiveShadow = true;
    sculpture.position.y = 0;
    scene.add(sculpture);

    const { meta } = geometryData;
    specimenMeta = meta;
    updatePlaque(plaqueState);
    if (options.resetView !== false) resetView();
    if (options.grid !== undefined) setGrid(options.grid);
    if (options.autoRotate !== undefined) setAutoRotate(options.autoRotate);
  }

  function setPlaque(state) {
    if (state) updatePlaque(state);
  }

  function setAutoRotate(enabled) {
    controls.autoRotate = Boolean(enabled);
  }

  function setGrid(enabled) {
    grid.visible = Boolean(enabled);
  }

  function resetView(immediate = true) {
    if (!specimenMeta) {
      controls.target.set(0, 1.3, 0);
      const position = new THREE.Vector3(3.2, 2.7, 5.4);
      camera.position.copy(position);
      controls.update();
      return;
    }
    const height = specimenMeta.height;
    const target = new THREE.Vector3(0, height * 0.47, 0);
    const distance = 5.9 + (height - 2.7) * 0.65;
    const azimuth = 0.55;
    const elevation = 0.22;
    const position = new THREE.Vector3(
      target.x + Math.sin(azimuth) * Math.cos(elevation) * distance,
      target.y + Math.sin(elevation) * distance,
      target.z + Math.cos(azimuth) * Math.cos(elevation) * distance,
    );
    controls.target.copy(target);
    camera.position.copy(position);
    controls.update();
    if (!immediate) camera.updateProjectionMatrix();
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();

  let frameAnimation = 0;
  function animate() {
    frameAnimation = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  function composeExport(size, plaqueState) {
    const previousWidth = renderer.domElement.width;
    const previousHeight = renderer.domElement.height;
    const previousPixelRatio = renderer.getPixelRatio();
    const previousAspect = camera.aspect;
    const previousPosition = camera.position.clone();

    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();

    if (specimenMeta) {
      const target = controls.target.clone();
      const direction = camera.position.clone().sub(target);
      const minDistance = 5.7 + (specimenMeta.height - 2.7) * 0.6;
      if (direction.length() < minDistance) {
        direction.setLength(minDistance);
        camera.position.copy(target).add(direction);
      }
      camera.lookAt(target);
    }

    renderer.render(scene, camera);

    const output = document.createElement('canvas');
    output.width = size;
    output.height = size;
    const ctx = output.getContext('2d');

    const background = ctx.createRadialGradient(size * 0.5, size * 0.34, size * 0.05, size * 0.5, size * 0.5, size * 0.78);
    background.addColorStop(0, '#211a14');
    background.addColorStop(0.46, '#120f0c');
    background.addColorStop(1, '#060505');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);

    const glow = ctx.createRadialGradient(size * 0.5, size * 0.36, 0, size * 0.5, size * 0.36, size * 0.36);
    glow.addColorStop(0, 'rgba(211, 151, 87, 0.16)');
    glow.addColorStop(0.6, 'rgba(150, 99, 55, 0.04)');
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size, size);

    const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.32, size / 2, size / 2, size * 0.78);
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.58)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, size, size);

    ctx.drawImage(renderer.domElement, 0, 0, size, size);

    const seed = Number.parseInt(plaqueState?.hash || '12345678', 16) || 1234567;
    const random = mulberry32(seed);
    ctx.fillStyle = 'rgba(235, 217, 189, 0.1)';
    for (let i = 0; i < 3800; i += 1) {
      const x = random() * size;
      const y = random() * size;
      const r = random() * 1.2 + 0.2;
      ctx.globalAlpha = random() * 0.22;
      ctx.fillRect(x, y, r, r);
    }
    ctx.globalAlpha = 1;

    const margin = Math.round(size * 0.052);
    const line = Math.max(1, Math.round(size / 1400));
    ctx.strokeStyle = 'rgba(233, 216, 189, 0.28)';
    ctx.lineWidth = line;
    ctx.strokeRect(margin, margin, size - margin * 2, size - margin * 2);

    const tick = Math.round(size * 0.016);
    ctx.strokeStyle = 'rgba(212, 154, 88, 0.85)';
    ctx.lineWidth = line * 2;
    const corners = [
      [margin, margin, 1, 1],
      [size - margin, margin, -1, 1],
      [margin, size - margin, 1, -1],
      [size - margin, size - margin, -1, -1],
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * tick, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * tick);
      ctx.stroke();
    }

    const unit = size / 2048;
    ctx.fillStyle = '#d8c6a9';
    ctx.font = `500 ${Math.round(25 * unit)}px "Cascadia Mono", Consolas, monospace`;
    ctx.letterSpacing = `${Math.round(7 * unit)}px`;
    ctx.fillText('SOUND FOSSIL', margin + 34 * unit, margin + 62 * unit);
    ctx.fillStyle = 'rgba(184, 164, 137, 0.85)';
    ctx.font = `400 ${Math.round(19 * unit)}px "Cascadia Mono", Consolas, monospace`;
    ctx.letterSpacing = `${Math.round(4 * unit)}px`;
    ctx.fillText('AUDITORY FOSSIL STUDIO', margin + 34 * unit, margin + 98 * unit);

    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(184, 164, 137, 0.8)';
    ctx.fillText(`${size} × ${size}  ·  PNG`, size - margin - 34 * unit, margin + 62 * unit);
    ctx.fillText('MADE ENTIRELY LOCALLY', size - margin - 34 * unit, margin + 98 * unit);
    ctx.textAlign = 'left';

    const footerLineY = size - margin - Math.round(size * 0.165);
    ctx.strokeStyle = 'rgba(233, 216, 189, 0.2)';
    ctx.lineWidth = line;
    ctx.beginPath();
    ctx.moveTo(margin + 34 * unit, footerLineY);
    ctx.lineTo(size - margin - 34 * unit, footerLineY);
    ctx.stroke();

    ctx.fillStyle = '#ecdfc8';
    const title = plaqueState?.name || 'Untitled specimen';
    let titleSize = Math.round(82 * unit);
    ctx.font = `400 ${titleSize}px "Palatino Linotype", Georgia, serif`;
    while (ctx.measureText(title).width > size - margin * 2 - 120 * unit && titleSize > 30) {
      titleSize -= 3;
      ctx.font = `400 ${titleSize}px "Palatino Linotype", Georgia, serif`;
    }
    ctx.fillText(title, margin + 34 * unit, footerLineY + 72 * unit);

    ctx.fillStyle = 'rgba(206, 184, 151, 0.9)';
    ctx.font = `400 ${Math.round(24 * unit)}px "Cascadia Mono", Consolas, monospace`;
    ctx.letterSpacing = `${Math.round(3 * unit)}px`;
    const footerMeta = [
      plaqueState?.code || 'SF-0000',
      plaqueState?.tone || '',
      plaqueState?.duration || '',
      `SCULPTURE #${plaqueState?.hash || '--------'}`,
      `AUDIO #${plaqueState?.fingerprint || '--------'}`,
    ]
      .filter(Boolean)
      .join('   /   ');
    ctx.fillText(footerMeta, margin + 34 * unit, footerLineY + 120 * unit);

    ctx.fillStyle = 'rgba(212, 154, 88, 0.75)';
    ctx.font = `400 ${Math.round(17 * unit)}px "Cascadia Mono", Consolas, monospace`;
    ctx.fillText('same audio + same settings = same fossil', margin + 34 * unit, size - margin - 38 * unit);
    ctx.textAlign = 'right';
    ctx.fillText('SOUNDFOSSIL · LOCAL', size - margin - 34 * unit, size - margin - 38 * unit);
    ctx.textAlign = 'left';

    const dataUrl = output.toDataURL('image/png');

    renderer.setPixelRatio(previousPixelRatio);
    renderer.setSize(previousWidth / previousPixelRatio, previousHeight / previousPixelRatio, false);
    camera.aspect = previousAspect;
    camera.position.copy(previousPosition);
    camera.updateProjectionMatrix();
    controls.update();
    renderer.render(scene, camera);

    return { dataUrl, width: size, height: size };
  }

  function exportPng(size, plaqueState) {
    return composeExport(size, plaqueState || currentPlaqueState);
  }

  function getState() {
    return {
      hasSculpture: Boolean(sculpture),
      height: specimenMeta?.height || 0,
      autoRotate: controls.autoRotate,
      grid: grid.visible,
      camera: camera.position.toArray(),
    };
  }

  function setViewOptions(options = {}) {
    if (options.autoRotate !== undefined) setAutoRotate(options.autoRotate);
    if (options.grid !== undefined) setGrid(options.grid);
  }

  function dispose() {
    cancelAnimationFrame(frameAnimation);
    observer.disconnect();
    controls.dispose();
    clearSculpture();
    renderer.dispose();
  }

  return {
    setSculpture,
    setPlaque,
    setAutoRotate,
    setGrid,
    resetView,
    exportPng,
    getState,
    setViewOptions,
    resize,
    dispose,
    clearSculpture,
  };
}
