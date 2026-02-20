const canvas = document.getElementById("sim");
const ctx = canvas.getContext("2d", { alpha: true });
const fluidCanvas = document.createElement("canvas");
const fluidCtx = fluidCanvas.getContext("2d", { alpha: true });
const blobCanvas = document.createElement("canvas");
const blobCtx = blobCanvas.getContext("2d", { alpha: true });
const statsEl = document.getElementById("stats");
const pourToggleEl = document.getElementById("pourToggle");
const tiltToggleEl = document.getElementById("tiltToggle");
const resetBtnEl = document.getElementById("resetBtn");
const nozzleButtons = Array.from(document.querySelectorAll(".nozzle-btn"));

const particles = [];
const grid = new Map();

const config = {
  targetParticles: 200,
  spawnPerSecond: 24,
  gravityMag: 1320,
  airDamping: 0.994,
  h: 32,
  restDensity: 7.1,
  pressureK: 0.12,
  nearPressureK: 0.28,
  collisionStiffness: 0.72,
  solverIterations: 5,
  substeps: 2,
  boundaryBounce: 0,
  boundaryFriction: 0.16,
  viscosity: 0.12,
  cohesionK: 1.1,
  maxSpeed: 520,
  pourWidth: 10,
  pourSpeedY: 70,
  pourWobble: 0,
  pourWobbleHz: 1.0,
};

const cup = {
  centerX: 0,
  topY: 0,
  bottomY: 0,
  topHalfOuter: 0,
  topHalfInner: 0,
  bottomHalfOuter: 0,
  bottomHalfInner: 0,
  wall: 13,
  rimHeight: 20,
  rimInset: 10,
};

let width = 0;
let height = 0;
let dpr = 1;
let spawnTimer = 0;
let lastTime = performance.now();
let simTime = 0;
let isPouring = false;
let selectedColor = hexToRgb(nozzleButtons[0]?.dataset.color || "#f1ab62");
let gravityX = 0;
let gravityY = config.gravityMag;
let tiltEnabled = false;
let tiltListening = false;
let baseAlpha = null;
let smoothAngleDeg = 0;
let gotOrientationSample = false;
let gotMotionSample = false;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function hexToRgb(hex) {
  const v = hex.replace("#", "");
  const n = Number.parseInt(v.length === 3 ? v.split("").map((x) => x + x).join("") : v, 16);
  return {
    r: (n >> 16) & 255,
    g: (n >> 8) & 255,
    b: n & 255,
  };
}

function rgba(color, alpha) {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})`;
}

function angleDiffDeg(a, b) {
  let d = a - b;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function applyTiltAlpha(alphaDeg) {
  if (baseAlpha == null) baseAlpha = alphaDeg;
  const deltaDeg = angleDiffDeg(alphaDeg, baseAlpha);
  smoothAngleDeg = smoothAngleDeg * 0.82 + deltaDeg * 0.18;
  const rad = (smoothAngleDeg * Math.PI) / 180;
  gravityX = Math.sin(rad) * config.gravityMag;
  gravityY = Math.cos(rad) * config.gravityMag;
}

function handleOrientation(event) {
  if (!tiltEnabled) return;
  if (gotMotionSample) return;
  if (typeof event.alpha !== "number") return;
  gotOrientationSample = true;
  applyTiltAlpha(event.alpha);
}

function handleMotion(event) {
  if (!tiltEnabled) return;
  const g = event.accelerationIncludingGravity;
  if (!g) return;

  // Map device gravity to screen coordinates (x right, y down).
  // Keep default gravity downward, while tilt rotation direction is inverted from previous mapping.
  const nx = (g.x || 0) / 9.81;
  const ny = -((g.y || 0) / 9.81);
  const mag = Math.hypot(nx, ny);
  if (mag < 0.05) return;

  const tx = nx * config.gravityMag;
  const ty = ny * config.gravityMag;
  gravityX = gravityX * 0.82 + tx * 0.18;
  gravityY = gravityY * 0.82 + ty * 0.18;
  gotMotionSample = true;
}

function setTiltButtonState(active) {
  tiltToggleEl.classList.toggle("active", active);
  tiltToggleEl.textContent = active ? "TILT ON" : "TILT";
}

async function startTilt() {
  baseAlpha = null;
  smoothAngleDeg = 0;
  gotOrientationSample = false;
  gotMotionSample = false;

  if (typeof DeviceOrientationEvent === "undefined") {
    alert("이 기기/브라우저는 DeviceOrientation을 지원하지 않습니다.");
    return false;
  }

  const localHost =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";
  if (!window.isSecureContext && !localHost) {
    alert("기울기 센서는 HTTPS에서만 동작합니다. https 주소로 접속해 주세요.");
    return false;
  }

  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const perm = await DeviceOrientationEvent.requestPermission();
      if (perm !== "granted") return false;
    } catch {
      return false;
    }
  }

  if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
    try {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== "granted") return false;
    } catch {
      return false;
    }
  }

  if (!tiltListening) {
    window.addEventListener("deviceorientation", handleOrientation, true);
    window.addEventListener("devicemotion", handleMotion, true);
    tiltListening = true;
  }

  // Enable before probe wait, otherwise handlers ignore incoming samples.
  tiltEnabled = true;

  // Ensure we actually receive sensor values.
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (!gotOrientationSample && !gotMotionSample) {
    alert("센서 값을 받지 못했습니다. HTTPS 접속 상태와 Safari 센서 권한을 확인한 뒤 다시 시도해 주세요.");
    return false;
  }
  return true;
}

function stopTilt() {
  tiltEnabled = false;
  baseAlpha = null;
  smoothAngleDeg = 0;
  gravityX = 0;
  gravityY = config.gravityMag;
  setTiltButtonState(false);
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;
  dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.width = Math.floor(width * dpr);
  canvas.height = Math.floor(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fluidCanvas.width = width;
  fluidCanvas.height = height;
  blobCanvas.width = width;
  blobCanvas.height = height;

  const topWidth = Math.min(width * 0.58, 360);
  const bottomWidth = topWidth * 0.72;
  const cupHeight = Math.min(height * 0.6, 660);

  cup.wall = Math.max(11, Math.min(14, width * 0.028));
  cup.centerX = width * 0.5;
  cup.topY = height * 0.34;
  cup.bottomY = cup.topY + cupHeight;
  cup.topHalfOuter = topWidth * 0.5;
  cup.bottomHalfOuter = bottomWidth * 0.5;
  cup.topHalfInner = cup.topHalfOuter - cup.wall;
  cup.bottomHalfInner = cup.bottomHalfOuter - cup.wall;
  cup.rimHeight = Math.max(16, cup.wall * 1.4);
}

function cellKey(cx, cy) {
  return `${cx},${cy}`;
}

function buildGrid() {
  grid.clear();
  const s = config.h;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const cx = Math.floor(p.x / s);
    const cy = Math.floor(p.y / s);
    const key = cellKey(cx, cy);
    let list = grid.get(key);

    if (!list) {
      list = [];
      grid.set(key, list);
    }

    list.push(i);
  }
}

function getNozzlePos() {
  const active = document.querySelector(".nozzle-btn.active .nozzle-neck") || document.querySelector(".nozzle-btn .nozzle-neck");
  const appRect = canvas.getBoundingClientRect();

  if (!active) {
    return { x: cup.centerX, y: cup.topY - 125 };
  }

  const r = active.getBoundingClientRect();
  return {
    x: r.left + r.width * 0.5 - appRect.left,
    y: r.bottom - appRect.top,
  };
}

function spawnParticles(dt) {
  if (!isPouring) {
    spawnTimer = 0;
    return;
  }
  if (particles.length >= config.targetParticles) {
    stopPouring(false);
    return;
  }

  const interval = 1 / Math.max(config.spawnPerSecond, 1);
  spawnTimer += dt;
  if (spawnTimer < interval) return;
  spawnTimer -= interval;

  const nozzle = getNozzlePos();
  const sx = nozzle.x;
  const sy = nozzle.y + 2;

  const r = (6.5 + Math.random() * 1.2) * 2.55;
  particles.push({
    x: sx + (Math.random() - 0.5) * 0.7,
    y: sy + (Math.random() - 0.5) * 0.7,
    oldX: sx,
    oldY: sy,
    vx: 0,
    vy: config.pourSpeedY,
    r,
    density: 0,
    densityNear: 0,
    pressure: 0,
    pressureNear: 0,
    color: { ...selectedColor },
  });
}

function stopPouring(clearAirborneParticles) {
  isPouring = false;
  spawnTimer = 0;
  pourToggleEl.classList.remove("active");
  pourToggleEl.textContent = "POUR";

  if (!clearAirborneParticles) return;

  const streamX = getStreamX();
  const maxY = cup.topY + 16;
  const maxDx = 46;

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    if (p.y < maxY && Math.abs(p.x - streamX) < maxDx) {
      particles.splice(i, 1);
    }
  }
}

function clearAirborneAtMouth() {
  const streamX = getStreamX();
  const maxY = cup.topY + 16;
  const maxDx = 46;

  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    if (p.y < maxY && Math.abs(p.x - streamX) < maxDx) {
      particles.splice(i, 1);
    }
  }
}

function getStreamX() {
  const nozzle = getNozzlePos();
  const wave = Math.sin(simTime * Math.PI * 2 * config.pourWobbleHz) * config.pourWobble;
  return nozzle.x + wave;
}

function innerHalfAt(y) {
  const t = Math.max(0, Math.min(1, (y - cup.topY) / (cup.bottomY - cup.topY)));
  return lerp(cup.topHalfInner, cup.bottomHalfInner, t * 1.03);
}

function solveCupCollision(p) {
  const floorY = cup.bottomY - cup.wall - 2;
  const sideCollisionStartY = cup.topY + cup.rimHeight * 0.9;

  if (p.y + p.r > floorY) {
    p.y = floorY - p.r;
    if (p.vy > 0) p.vy = 0;
    p.vx *= 1 - config.boundaryFriction;
  }

  // Delay side-wall collision below the mouth so particles don't hit an invisible rim wall.
  if (p.y > sideCollisionStartY) {
    const half = innerHalfAt(p.y);
    const left = cup.centerX - half;
    const right = cup.centerX + half;

    if (p.x - p.r < left) {
      p.x = left + p.r;
      if (p.vx < 0) p.vx = 0;
      p.vy *= 1 - config.boundaryFriction * 0.7;
    }

    if (p.x + p.r > right) {
      p.x = right - p.r;
      if (p.vx > 0) p.vx = 0;
      p.vy *= 1 - config.boundaryFriction * 0.7;
    }
  }
}

function viscosityPass() {
  const h = config.h;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const cx = Math.floor(p.x / h);
    const cy = Math.floor(p.y / h);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const list = grid.get(cellKey(cx + ox, cy + oy));
        if (!list) continue;

        for (let n = 0; n < list.length; n += 1) {
          const j = list[n];
          if (j <= i) continue;

          const q = particles[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= 0 || distSq >= h * h) continue;

          const dist = Math.sqrt(distSq);
          const nx = dx / dist;
          const ny = dy / dist;
          const ratio = 1 - dist / h;
          const ratio2 = ratio * ratio;

          const rvx = q.vx - p.vx;
          const rvy = q.vy - p.vy;
          const rel = rvx * nx + rvy * ny;
          if (rel > 0) continue;

          const impulse = rel * ratio * config.viscosity * 0.5;
          p.vx += nx * impulse;
          p.vy += ny * impulse;
          q.vx -= nx * impulse;
          q.vy -= ny * impulse;

          // Mild cohesion force so neighboring particles bind like liquid blobs.
          const coh = config.cohesionK * ratio2;
          p.vx += nx * coh;
          p.vy += ny * coh;
          q.vx -= nx * coh;
          q.vy -= ny * coh;
        }
      }
    }
  }
}

function densityPass() {
  const h = config.h;

  for (let i = 0; i < particles.length; i += 1) {
    particles[i].density = 0;
    particles[i].densityNear = 0;
  }

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const cx = Math.floor(p.x / h);
    const cy = Math.floor(p.y / h);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const list = grid.get(cellKey(cx + ox, cy + oy));
        if (!list) continue;

        for (let n = 0; n < list.length; n += 1) {
          const j = list[n];
          if (j <= i) continue;

          const q = particles[j];
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const distSq = dx * dx + dy * dy;
          if (distSq <= 0 || distSq >= h * h) continue;

          const dist = Math.sqrt(distSq);
          const ratio = 1 - dist / h;
          const ratio2 = ratio * ratio;
          const ratio3 = ratio2 * ratio;

          p.density += ratio2;
          q.density += ratio2;
          p.densityNear += ratio3;
          q.densityNear += ratio3;
        }
      }
    }
  }

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    p.pressure = Math.max(0, (p.density - config.restDensity) * config.pressureK);
    p.pressureNear = p.densityNear * config.nearPressureK;
  }
}

function relaxationPass(dt) {
  const h = config.h;
  const mouthY = cup.topY + 6;

  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const cx = Math.floor(p.x / h);
    const cy = Math.floor(p.y / h);

    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        const list = grid.get(cellKey(cx + ox, cy + oy));
        if (!list) continue;

        for (let n = 0; n < list.length; n += 1) {
          const j = list[n];
          if (j <= i) continue;

          const q = particles[j];
          if (p.y < mouthY && q.y < mouthY) continue;
          let dx = q.x - p.x;
          let dy = q.y - p.y;
          let distSq = dx * dx + dy * dy;

          if (distSq <= 0) {
            dx = 0.001;
            dy = 0;
            distSq = dx * dx;
          }

          const dist = Math.sqrt(distSq);
          if (dist >= h) continue;

          const nx = dx / dist;
          const ny = dy / dist;
          const ratio = 1 - dist / h;

          const d = ((p.pressure + q.pressure) * ratio + (p.pressureNear + q.pressureNear) * ratio * ratio) * dt * dt;
          const corr = d * 0.5 * config.collisionStiffness;

          p.x -= nx * corr;
          p.y -= ny * corr;
          q.x += nx * corr;
          q.y += ny * corr;

          const minDist = (p.r + q.r) * 0.46;
          if (dist < minDist) {
            const overlap = (minDist - dist) * 0.5;
            p.x -= nx * overlap;
            p.y -= ny * overlap;
            q.x += nx * overlap;
            q.y += ny * overlap;
          }
        }
      }
    }
  }
}

function cullOverflow() {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const p = particles[i];
    const outsideScreen = p.x < -120 || p.x > width + 120 || p.y > height + 120 || p.y < -120;

    if (outsideScreen) {
      particles.splice(i, 1);
    }
  }
}

function step(dt) {
  simTime += dt;
  spawnParticles(dt);

  const subDt = dt / config.substeps;
  for (let s = 0; s < config.substeps; s += 1) {
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.oldX = p.x;
      p.oldY = p.y;

      p.vx += gravityX * subDt;
      p.vy += gravityY * subDt;
      p.vx *= config.airDamping;
      p.vy *= config.airDamping;

      const speed = Math.hypot(p.vx, p.vy);
      if (speed > config.maxSpeed) {
        const scale = config.maxSpeed / speed;
        p.vx *= scale;
        p.vy *= scale;
      }

      p.x += p.vx * subDt;
      p.y += p.vy * subDt;
      solveCupCollision(p);
    }

    buildGrid();
    viscosityPass();

    for (let iter = 0; iter < config.solverIterations; iter += 1) {
      buildGrid();
      densityPass();
      relaxationPass(subDt);

      for (let i = 0; i < particles.length; i += 1) {
        solveCupCollision(particles[i]);
      }
    }

    const invDt = 1 / Math.max(subDt, 1e-5);
    for (let i = 0; i < particles.length; i += 1) {
      const p = particles[i];
      p.vx = (p.x - p.oldX) * invDt;
      p.vy = (p.y - p.oldY) * invDt;
    }
  }

  cullOverflow();
}

function cupInnerPath(extraTop = 0) {
  const topY = cup.topY + 10 - extraTop;
  const bottomY = cup.bottomY - 10;
  const lipArcY = topY - cup.rimHeight * 0.35;

  ctx.moveTo(cup.centerX - cup.topHalfInner, topY);
  ctx.bezierCurveTo(
    cup.centerX - cup.topHalfInner * 1.03,
    topY + (bottomY - topY) * 0.25,
    cup.centerX - cup.bottomHalfInner * 1.02,
    bottomY - (bottomY - topY) * 0.2,
    cup.centerX - cup.bottomHalfInner,
    bottomY,
  );

  ctx.lineTo(cup.centerX + cup.bottomHalfInner, bottomY);
  ctx.bezierCurveTo(
    cup.centerX + cup.bottomHalfInner * 1.02,
    bottomY - (bottomY - topY) * 0.2,
    cup.centerX + cup.topHalfInner * 1.03,
    topY + (bottomY - topY) * 0.25,
    cup.centerX + cup.topHalfInner,
    topY,
  );

  // Curve the fluid mask at the mouth to avoid a hard, cut-off top edge.
  ctx.quadraticCurveTo(cup.centerX, lipArcY, cup.centerX - cup.topHalfInner, topY);
  ctx.closePath();
}

function drawFluidBody() {
  fluidCtx.clearRect(0, 0, width, height);

  // Group by color and render each group as a merged blob layer.
  const groups = new Map();
  for (let i = 0; i < particles.length; i += 1) {
    const p = particles[i];
    const key = `${p.color.r},${p.color.g},${p.color.b}`;
    let group = groups.get(key);
    if (!group) {
      group = { color: p.color, items: [] };
      groups.set(key, group);
    }
    group.items.push(p);
  }

  for (const group of groups.values()) {
    blobCtx.clearRect(0, 0, width, height);
    blobCtx.globalCompositeOperation = "source-over";
    blobCtx.filter = "blur(6px)";
    blobCtx.fillStyle = "rgba(255,255,255,1)";

    for (let i = 0; i < group.items.length; i += 1) {
      const p = group.items[i];
      blobCtx.beginPath();
      blobCtx.arc(p.x, p.y, p.r * 1.5, 0, Math.PI * 2);
      blobCtx.fill();
    }

    blobCtx.filter = "none";
    blobCtx.globalCompositeOperation = "source-in";
    blobCtx.fillStyle = rgba(group.color, 1);
    blobCtx.fillRect(0, 0, width, height);
    blobCtx.globalCompositeOperation = "source-over";

    fluidCtx.drawImage(blobCanvas, 0, 0);
  }

  // No visual clipping: rely on physical wall collision + off-screen culling.
  ctx.drawImage(fluidCanvas, 0, 0);
}

function drawPourStream() {
  if (!isPouring) return;
  if (particles.length >= config.targetParticles) return;

  const nozzle = getNozzlePos();
  const sx = getStreamX();
  const sy = nozzle.y + 3;
  const ey = cup.topY + 14;

  ctx.save();
  ctx.strokeStyle = rgba(selectedColor, 0.4);
  ctx.lineWidth = 20;
  ctx.lineCap = "round";
  ctx.filter = "blur(5px)";

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, ey);
  ctx.stroke();

  ctx.filter = "none";
  ctx.strokeStyle = rgba(selectedColor, 0.9);
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx, ey);
  ctx.stroke();

  ctx.restore();
}

function drawCupGlass() {
  const topY = cup.topY;
  const bottomY = cup.bottomY;

  ctx.save();

  ctx.beginPath();
  ctx.moveTo(cup.centerX - cup.topHalfOuter, topY);
  ctx.bezierCurveTo(
    cup.centerX - cup.topHalfOuter * 1.02,
    topY + (bottomY - topY) * 0.28,
    cup.centerX - cup.bottomHalfOuter * 1.03,
    bottomY - (bottomY - topY) * 0.16,
    cup.centerX - cup.bottomHalfOuter,
    bottomY,
  );
  ctx.lineTo(cup.centerX + cup.bottomHalfOuter, bottomY);
  ctx.bezierCurveTo(
    cup.centerX + cup.bottomHalfOuter * 1.03,
    bottomY - (bottomY - topY) * 0.16,
    cup.centerX + cup.topHalfOuter * 1.02,
    topY + (bottomY - topY) * 0.28,
    cup.centerX + cup.topHalfOuter,
    topY,
  );

  const glassGrad = ctx.createLinearGradient(0, topY, 0, bottomY);
  glassGrad.addColorStop(0, "rgba(255,255,255,0.18)");
  glassGrad.addColorStop(1, "rgba(255,255,255,0.08)");

  ctx.fillStyle = glassGrad;
  ctx.fill();
  ctx.lineWidth = cup.wall;
  ctx.strokeStyle = "rgba(245, 245, 245, 0.62)";
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cup.centerX, cup.topY + 2, cup.topHalfOuter, cup.rimHeight * 0.52, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(245,245,245,0.74)";
  ctx.lineWidth = cup.wall * 0.45;
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(cup.centerX, cup.topY + 3, cup.topHalfInner, cup.rimHeight * 0.36, 0, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = cup.wall * 0.16;
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cup.centerX - cup.topHalfOuter * 0.85, topY + 14);
  ctx.lineTo(cup.centerX - cup.bottomHalfOuter * 0.95, bottomY - 12);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = cup.wall * 0.24;
  ctx.stroke();

  ctx.restore();
}

function render() {
  ctx.clearRect(0, 0, width, height);
  drawFluidBody();
  drawCupGlass();
  statsEl.textContent = `particles: ${particles.length}`;
}

function tick(now) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 60);
  lastTime = now;

  step(dt);
  render();
  requestAnimationFrame(tick);
}

function bindUI() {
  pourToggleEl.addEventListener("click", () => {
    if (isPouring) {
      stopPouring(true);
      return;
    }
    clearAirborneAtMouth();
    spawnTimer = 0;
    isPouring = true;
    pourToggleEl.classList.add("active");
    pourToggleEl.textContent = "STOP";
  });

  nozzleButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      nozzleButtons.forEach((x) => x.classList.remove("active"));
      btn.classList.add("active");
      selectedColor = hexToRgb(btn.dataset.color || "#f1ab62");
      if (!isPouring) {
        pourToggleEl.classList.remove("active");
        pourToggleEl.textContent = "POUR";
      }
    });
  });

  tiltToggleEl.addEventListener("click", async () => {
    if (tiltEnabled) {
      stopTilt();
      return;
    }

    const ok = await startTilt();
    if (!ok) {
      stopTilt();
      return;
    }
    tiltEnabled = true;
    setTiltButtonState(true);
  });

  resetBtnEl.addEventListener("click", () => {
    particles.length = 0;
    spawnTimer = 0;
    stopPouring(false);
    stopTilt();
  });
}

async function enableTiltAuto() {
  if (tiltEnabled) return;

  const needsGesture =
    (typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function") ||
    (typeof DeviceMotionEvent !== "undefined" &&
      typeof DeviceMotionEvent.requestPermission === "function");

  // iOS Safari: permission call must be triggered by user gesture.
  if (needsGesture) {
    const onFirstTouch = async () => {
      const ok = await startTilt();
      if (ok) {
        tiltEnabled = true;
        setTiltButtonState(true);
      }
    };
    window.addEventListener("pointerdown", onFirstTouch, { once: true });
    window.addEventListener("touchstart", onFirstTouch, { once: true });
    return;
  }

  // Browsers without explicit permission gate can enable immediately.
  const ok = await startTilt();
  if (ok) {
    tiltEnabled = true;
    setTiltButtonState(true);
  }
}

bindUI();
window.addEventListener("resize", resize);
resize();
enableTiltAuto();
requestAnimationFrame((t) => {
  lastTime = t;
  tick(t);
});
