"use strict";

// ------------------------------------------------------------------
// Setup & constants
// ------------------------------------------------------------------
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const TILE = 40;
const COLS = canvas.width / TILE; // 18
const ROWS = canvas.height / TILE; // 12
const WAVE_MAX = 20;

// Path defined as a sequence of grid waypoints (col, row). The first and
// last points sit just off-grid so enemies spawn/leave off-screen.
const GRID_WAYPOINTS = [
  [-1, 5],
  [3, 5],
  [3, 2],
  [9, 2],
  [9, 9],
  [14, 9],
  [14, 5],
  [18, 5],
];

function gridToPixel([col, row]) {
  return { x: (col + 0.5) * TILE, y: (row + 0.5) * TILE };
}

const PATH_PIXELS = GRID_WAYPOINTS.map(gridToPixel);

// Cells the path occupies (used to block tower placement + draw the road).
const PATH_CELLS = new Set();
function cellKey(c, r) {
  return `${c},${r}`;
}
(function buildPathCells() {
  for (let i = 0; i < GRID_WAYPOINTS.length - 1; i++) {
    const [c1, r1] = GRID_WAYPOINTS[i];
    const [c2, r2] = GRID_WAYPOINTS[i + 1];
    const steps = Math.max(Math.abs(c2 - c1), Math.abs(r2 - r1));
    for (let s = 0; s <= steps; s++) {
      const c = Math.round(c1 + ((c2 - c1) * s) / steps);
      const r = Math.round(r1 + ((r2 - r1) * s) / steps);
      // mark a 1-tile-wide road plus its immediate neighbor for visual width
      PATH_CELLS.add(cellKey(c, r));
    }
  }
})();

function isBuildable(col, row) {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return false;
  return !PATH_CELLS.has(cellKey(col, row));
}

// ------------------------------------------------------------------
// Tower definitions
// ------------------------------------------------------------------
const TOWER_TYPES = {
  arrow: {
    id: "arrow",
    name: "アロータワー",
    icon: "🏹",
    color: "#4468e8",
    cost: 50,
    range: 110,
    rate: 0.6,
    damage: 12,
    splash: 0,
    slow: 0,
    desc: "単体攻撃・連射が速い基本タワー",
  },
  cannon: {
    id: "cannon",
    name: "キャノンタワー",
    icon: "💣",
    color: "#e08a2b",
    cost: 90,
    range: 90,
    rate: 1.4,
    damage: 28,
    splash: 50,
    slow: 0,
    desc: "着弾地点の周囲に範囲ダメージ",
  },
  sniper: {
    id: "sniper",
    name: "スナイパータワー",
    icon: "🎯",
    color: "#a34be0",
    cost: 130,
    range: 230,
    rate: 1.8,
    damage: 60,
    splash: 0,
    slow: 0,
    desc: "超長射程・高火力だが連射は遅い",
  },
  frost: {
    id: "frost",
    name: "フロストタワー",
    icon: "❄️",
    color: "#3ec9d6",
    cost: 70,
    range: 100,
    rate: 1.0,
    damage: 5,
    splash: 0,
    slow: 0.5,
    desc: "命中した敵を1.5秒減速させる",
  },
};

const MAX_LEVEL = 3;
function upgradeCost(type, level) {
  return Math.round(TOWER_TYPES[type].cost * 0.65 * level);
}
function statsForLevel(type, level) {
  const base = TOWER_TYPES[type];
  const dmgMul = 1 + 0.35 * (level - 1);
  const rangeMul = 1 + 0.12 * (level - 1);
  const rateMul = Math.max(0.55, 1 - 0.1 * (level - 1));
  return {
    damage: base.damage * dmgMul,
    range: base.range * rangeMul,
    rate: base.rate * rateMul,
    splash: base.splash,
    slow: base.slow,
  };
}

// ------------------------------------------------------------------
// Enemy definitions
// ------------------------------------------------------------------
const ENEMY_TYPES = {
  normal: { hp: 40, speed: 62, reward: 8, radius: 11, color: "#4caf50" },
  fast: { hp: 24, speed: 112, reward: 10, radius: 9, color: "#e0d02b" },
  tank: { hp: 130, speed: 36, reward: 18, radius: 14, color: "#8a4b2b" },
  boss: { hp: 900, speed: 34, reward: 150, radius: 20, color: "#d63b3b" },
};

function waveComposition(wave) {
  const list = [];
  const isBossWave = wave % 5 === 0;
  const normalCount = 5 + Math.floor(wave * 1.4);
  const fastCount = wave >= 4 ? Math.floor(wave * 0.8) : 0;
  const tankCount = wave >= 7 ? Math.floor((wave - 5) * 0.6) : 0;

  for (let i = 0; i < normalCount; i++) list.push("normal");
  for (let i = 0; i < fastCount; i++) list.push("fast");
  for (let i = 0; i < tankCount; i++) list.push("tank");

  // Shuffle for variety, then optionally append a boss at the very end.
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  if (isBossWave) list.push("boss");
  return list;
}

// ------------------------------------------------------------------
// Game state
// ------------------------------------------------------------------
const state = {
  gold: 150,
  lives: 20,
  wave: 0,
  score: 0,
  towers: [],
  enemies: [],
  projectiles: [],
  particles: [],
  selectedShopType: null,
  selectedTower: null,
  hoverCell: null,
  waveInProgress: false,
  spawnQueue: [],
  spawnTimer: 0,
  speedMul: 1,
  paused: false,
  gameOver: false,
  victory: false,
  lastTime: 0,
};

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const goldEl = document.getElementById("gold");
const livesEl = document.getElementById("lives");
const waveEl = document.getElementById("wave");
const waveMaxEl = document.getElementById("waveMax");
const scoreEl = document.getElementById("score");
const startWaveBtn = document.getElementById("startWaveBtn");
const speedBtn = document.getElementById("speedBtn");
const pauseBtn = document.getElementById("pauseBtn");
const towerShopEl = document.getElementById("towerShop");
const selectionInfoEl = document.getElementById("selectionInfo");
const messageBoxEl = document.getElementById("messageBox");

waveMaxEl.textContent = WAVE_MAX;

function showMessage(text, kind) {
  messageBoxEl.textContent = text;
  messageBoxEl.className = "message-box" + (kind ? " " + kind : "");
  messageBoxEl.hidden = false;
  clearTimeout(showMessage._t);
  showMessage._t = setTimeout(() => {
    messageBoxEl.hidden = true;
  }, 2600);
}

// ------------------------------------------------------------------
// Shop UI
// ------------------------------------------------------------------
function renderShop() {
  towerShopEl.innerHTML = "";
  Object.values(TOWER_TYPES).forEach((t) => {
    const card = document.createElement("div");
    card.className = "tower-card";
    if (state.selectedShopType === t.id) card.classList.add("selected");
    if (state.gold < t.cost) card.classList.add("disabled");
    card.innerHTML = `
      <div class="tower-icon" style="background:${t.color}33;border:1px solid ${t.color}">${t.icon}</div>
      <div class="tower-meta">
        <div class="tower-name">${t.name}</div>
        <div class="tower-cost">💰${t.cost}｜${t.desc}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      if (state.gold < t.cost) {
        showMessage("ゴールドが足りません", "danger");
        return;
      }
      state.selectedTower = null;
      state.selectedShopType = state.selectedShopType === t.id ? null : t.id;
      renderShop();
      renderSelection();
    });
    towerShopEl.appendChild(card);
  });
}

function renderSelection() {
  const tower = state.selectedTower;
  if (!tower) {
    selectionInfoEl.innerHTML = state.selectedShopType
      ? `<p class="hint">建設したいマスをクリックしてください</p>`
      : `<p class="hint">タイルまたはタワーをクリックして選択</p>`;
    return;
  }
  const def = TOWER_TYPES[tower.type];
  const stats = statsForLevel(tower.type, tower.level);
  const canUpgrade = tower.level < MAX_LEVEL;
  const upCost = canUpgrade ? upgradeCost(tower.type, tower.level) : null;
  const sellValue = Math.round(tower.invested * 0.6);

  selectionInfoEl.innerHTML = `
    <div class="row"><strong>${def.icon} ${def.name}</strong><span>Lv.${tower.level}</span></div>
    <div class="row"><span>攻撃力</span><span>${stats.damage.toFixed(0)}</span></div>
    <div class="row"><span>射程</span><span>${stats.range.toFixed(0)}</span></div>
    <div class="row"><span>攻撃間隔</span><span>${stats.rate.toFixed(2)}秒</span></div>
    <div class="actions">
      <button class="upgrade-btn" id="upgradeBtn" ${canUpgrade ? "" : "disabled"}>
        ${canUpgrade ? `強化 💰${upCost}` : "最大レベル"}
      </button>
      <button class="sell-btn" id="sellBtn">売却 +💰${sellValue}</button>
    </div>
  `;

  if (canUpgrade) {
    document.getElementById("upgradeBtn").addEventListener("click", () => {
      if (state.gold < upCost) {
        showMessage("ゴールドが足りません", "danger");
        return;
      }
      state.gold -= upCost;
      tower.invested += upCost;
      tower.level++;
      updateHud();
      renderShop();
      renderSelection();
      showMessage(`${def.name}をLv.${tower.level}に強化しました`, "success");
    });
  }
  document.getElementById("sellBtn").addEventListener("click", () => {
    state.gold += sellValue;
    state.towers = state.towers.filter((t) => t !== tower);
    state.selectedTower = null;
    updateHud();
    renderShop();
    renderSelection();
    showMessage(`${def.name}を売却しました`, "success");
  });
}

function updateHud() {
  goldEl.textContent = state.gold;
  livesEl.textContent = Math.max(0, state.lives);
  waveEl.textContent = state.wave;
  scoreEl.textContent = state.score;
  renderShop();
}

// ------------------------------------------------------------------
// Canvas interaction
// ------------------------------------------------------------------
function canvasPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (evt.clientX - rect.left) * scaleX,
    y: (evt.clientY - rect.top) * scaleY,
  };
}

canvas.addEventListener("mousemove", (evt) => {
  const { x, y } = canvasPos(evt);
  state.hoverCell = { col: Math.floor(x / TILE), row: Math.floor(y / TILE) };
});
canvas.addEventListener("mouseleave", () => {
  state.hoverCell = null;
});

canvas.addEventListener("click", (evt) => {
  if (state.gameOver || state.victory) return;
  const { x, y } = canvasPos(evt);
  const col = Math.floor(x / TILE);
  const row = Math.floor(y / TILE);

  // Clicking an existing tower selects it (for upgrade/sell).
  const existing = state.towers.find((t) => t.col === col && t.row === row);
  if (existing) {
    state.selectedShopType = null;
    state.selectedTower = existing;
    renderShop();
    renderSelection();
    return;
  }

  // Otherwise, try to place the currently selected shop tower.
  if (state.selectedShopType) {
    if (!isBuildable(col, row)) {
      showMessage("そこには建設できません（道の上です）", "danger");
      return;
    }
    const def = TOWER_TYPES[state.selectedShopType];
    if (state.gold < def.cost) {
      showMessage("ゴールドが足りません", "danger");
      return;
    }
    state.gold -= def.cost;
    const { x: px, y: py } = gridToPixel([col, row]);
    state.towers.push({
      type: def.id,
      col,
      row,
      x: px,
      y: py,
      level: 1,
      invested: def.cost,
      cooldown: 0,
    });
    state.selectedShopType = null;
    updateHud();
    renderSelection();
    showMessage(`${def.name}を建設しました`, "success");
    return;
  }

  state.selectedTower = null;
  renderSelection();
});

// ------------------------------------------------------------------
// Wave control
// ------------------------------------------------------------------
startWaveBtn.addEventListener("click", () => {
  if (state.waveInProgress || state.gameOver || state.victory) return;
  if (state.wave >= WAVE_MAX) return;
  state.wave++;
  state.spawnQueue = waveComposition(state.wave);
  state.spawnTimer = 0;
  state.waveInProgress = true;
  updateHud();
  startWaveBtn.disabled = true;
  showMessage(`ウェーブ ${state.wave} 開始！`, "success");
});

speedBtn.addEventListener("click", () => {
  state.speedMul = state.speedMul === 1 ? 2 : 1;
  speedBtn.textContent = state.speedMul === 1 ? "2倍速" : "1倍速";
  speedBtn.classList.toggle("active", state.speedMul === 2);
});

pauseBtn.addEventListener("click", () => {
  state.paused = !state.paused;
  pauseBtn.textContent = state.paused ? "再開" : "一時停止";
  pauseBtn.classList.toggle("active", state.paused);
});

// ------------------------------------------------------------------
// Enemy factory
// ------------------------------------------------------------------
function spawnEnemy(type) {
  const def = ENEMY_TYPES[type];
  const hpScale = 1 + (state.wave - 1) * 0.16;
  const p0 = PATH_PIXELS[0];
  state.enemies.push({
    type,
    x: p0.x,
    y: p0.y,
    wpIndex: 1,
    hp: def.hp * hpScale,
    maxHp: def.hp * hpScale,
    speed: def.speed,
    baseSpeed: def.speed,
    reward: def.reward,
    radius: def.radius,
    color: def.color,
    slowTimer: 0,
  });
}

// ------------------------------------------------------------------
// Update loop
// ------------------------------------------------------------------
function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function updateEnemies(dt) {
  for (let i = state.enemies.length - 1; i >= 0; i--) {
    const e = state.enemies[i];

    if (e.slowTimer > 0) {
      e.slowTimer -= dt;
      e.speed = e.baseSpeed * 0.5;
      if (e.slowTimer <= 0) e.speed = e.baseSpeed;
    }

    const target = PATH_PIXELS[e.wpIndex];
    if (!target) {
      // Reached the base.
      state.enemies.splice(i, 1);
      state.lives--;
      updateHud();
      if (state.lives <= 0 && !state.gameOver) {
        endGame(false);
      }
      continue;
    }
    const d = distance(e.x, e.y, target.x, target.y);
    const step = e.speed * dt;
    if (step >= d) {
      e.x = target.x;
      e.y = target.y;
      e.wpIndex++;
    } else {
      e.x += ((target.x - e.x) / d) * step;
      e.y += ((target.y - e.y) / d) * step;
    }

    if (e.hp <= 0) {
      state.gold += e.reward;
      state.score += e.reward * 2;
      spawnDeathParticles(e.x, e.y, e.color);
      state.enemies.splice(i, 1);
      updateHud();
    }
  }
}

function findTarget(tower, stats) {
  let best = null;
  let bestProgress = -1;
  for (const e of state.enemies) {
    const d = distance(tower.x, tower.y, e.x, e.y);
    if (d <= stats.range) {
      // Prefer the enemy furthest along the path.
      const progress = e.wpIndex + 1 / (1 + distance(e.x, e.y, (PATH_PIXELS[e.wpIndex] || e).x, (PATH_PIXELS[e.wpIndex] || e).y));
      if (progress > bestProgress) {
        bestProgress = progress;
        best = e;
      }
    }
  }
  return best;
}

function updateTowers(dt) {
  for (const t of state.towers) {
    const stats = statsForLevel(t.type, t.level);
    t.cooldown -= dt;
    if (t.cooldown > 0) continue;
    const target = findTarget(t, stats);
    if (!target) continue;
    t.cooldown = stats.rate;
    state.projectiles.push({
      x: t.x,
      y: t.y,
      target,
      speed: 420,
      damage: stats.damage,
      splash: stats.splash,
      slow: stats.slow,
      color: TOWER_TYPES[t.type].color,
    });
  }
}

function updateProjectiles(dt) {
  for (let i = state.projectiles.length - 1; i >= 0; i--) {
    const p = state.projectiles[i];
    if (!state.enemies.includes(p.target) || p.target.hp <= 0) {
      state.projectiles.splice(i, 1);
      continue;
    }
    const d = distance(p.x, p.y, p.target.x, p.target.y);
    const step = p.speed * dt;
    if (step >= d) {
      // Hit.
      if (p.splash > 0) {
        for (const e of state.enemies) {
          if (distance(e.x, e.y, p.target.x, p.target.y) <= p.splash) {
            e.hp -= p.damage;
          }
        }
        spawnDeathParticles(p.target.x, p.target.y, "#ffb347", true);
      } else {
        p.target.hp -= p.damage;
      }
      if (p.slow > 0) {
        p.target.slowTimer = 1.5;
      }
      state.projectiles.splice(i, 1);
    } else {
      p.x += ((p.target.x - p.x) / d) * step;
      p.y += ((p.target.y - p.y) / d) * step;
    }
  }
}

function spawnDeathParticles(x, y, color, big) {
  const n = big ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI * 2 * i) / n;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * (big ? 120 : 70),
      vy: Math.sin(angle) * (big ? 120 : 70),
      life: 0.4,
      color,
    });
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
}

function updateSpawning(dt) {
  if (!state.waveInProgress) return;
  state.spawnTimer -= dt;
  if (state.spawnTimer <= 0 && state.spawnQueue.length > 0) {
    spawnEnemy(state.spawnQueue.shift());
    state.spawnTimer = 0.7;
  }
  if (state.spawnQueue.length === 0 && state.enemies.length === 0) {
    state.waveInProgress = false;
    startWaveBtn.disabled = false;
    if (state.wave >= WAVE_MAX) {
      endGame(true);
    } else {
      state.gold += 15 + state.wave * 2;
      updateHud();
      showMessage(`ウェーブ ${state.wave} クリア！ボーナス獲得`, "success");
    }
  }
}

function endGame(won) {
  if (won) {
    state.victory = true;
    showOverlay("🎉 勝利！", `全${WAVE_MAX}ウェーブを防衛しました。スコア: ${state.score}`, "#2fae66");
  } else {
    state.gameOver = true;
    showOverlay("💀 ゲームオーバー", `ウェーブ ${state.wave} で拠点が陥落しました。スコア: ${state.score}`, "#cc4848");
  }
}

function showOverlay(title, subtitle, color) {
  const overlay = document.createElement("div");
  overlay.className = "game-over-overlay";
  overlay.innerHTML = `
    <h1 style="color:${color}">${title}</h1>
    <p>${subtitle}</p>
    <button id="restartBtn">もう一度プレイ</button>
  `;
  document.body.appendChild(overlay);
  document.getElementById("restartBtn").addEventListener("click", () => {
    location.reload();
  });
}

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function drawGrid() {
  ctx.fillStyle = "#223018";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Buildable tile grid lines
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * TILE, 0);
    ctx.lineTo(c * TILE, canvas.height);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * TILE);
    ctx.lineTo(canvas.width, r * TILE);
    ctx.stroke();
  }

  // Path
  ctx.fillStyle = "#8a7a54";
  PATH_CELLS.forEach((key) => {
    const [c, r] = key.split(",").map(Number);
    ctx.fillRect(c * TILE, r * TILE, TILE, TILE);
  });
  ctx.strokeStyle = "rgba(0,0,0,0.15)";
  PATH_CELLS.forEach((key) => {
    const [c, r] = key.split(",").map(Number);
    ctx.strokeRect(c * TILE, r * TILE, TILE, TILE);
  });
}

function drawHoverGhost() {
  if (!state.selectedShopType || !state.hoverCell) return;
  const { col, row } = state.hoverCell;
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return;
  const def = TOWER_TYPES[state.selectedShopType];
  const valid = isBuildable(col, row) && state.gold >= def.cost;
  const { x, y } = gridToPixel([col, row]);

  ctx.globalAlpha = 0.25;
  ctx.fillStyle = valid ? "#2fae66" : "#cc4848";
  ctx.fillRect(col * TILE, row * TILE, TILE, TILE);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = valid ? "rgba(47,174,102,0.6)" : "rgba(204,72,72,0.6)";
  ctx.beginPath();
  ctx.arc(x, y, def.range, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTowers() {
  for (const t of state.towers) {
    const def = TOWER_TYPES[t.type];
    if (state.selectedTower === t) {
      const stats = statsForLevel(t.type, t.level);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.beginPath();
      ctx.arc(t.x, t.y, stats.range, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = "#12161f";
    ctx.beginPath();
    ctx.arc(t.x, t.y, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = def.color;
    ctx.beginPath();
    ctx.arc(t.x, t.y, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = "14px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.icon, t.x, t.y + 1);

    if (t.level > 1) {
      ctx.font = "bold 9px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.fillText("L" + t.level, t.x, t.y - 18);
    }
  }
}

function drawEnemies() {
  for (const e of state.enemies) {
    ctx.fillStyle = e.color;
    ctx.beginPath();
    ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
    ctx.fill();
    if (e.slowTimer > 0) {
      ctx.strokeStyle = "#3ec9d6";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.radius + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
    // HP bar
    const w = e.radius * 2;
    const hpRatio = Math.max(0, e.hp / e.maxHp);
    ctx.fillStyle = "#000";
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w, 4);
    ctx.fillStyle = hpRatio > 0.5 ? "#2fae66" : hpRatio > 0.25 ? "#e0d02b" : "#cc4848";
    ctx.fillRect(e.x - w / 2, e.y - e.radius - 8, w * hpRatio, 4);
  }
}

function drawProjectiles() {
  for (const p of state.projectiles) {
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParticles() {
  for (const p of state.particles) {
    ctx.globalAlpha = Math.max(0, p.life / 0.4);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

function render() {
  drawGrid();
  drawHoverGhost();
  drawTowers();
  drawProjectiles();
  drawEnemies();
  drawParticles();
}

// ------------------------------------------------------------------
// Main loop
// ------------------------------------------------------------------
function loop(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  let dt = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;
  dt = Math.min(dt, 0.05); // avoid huge jumps on tab switch

  if (!state.paused && !state.gameOver && !state.victory) {
    dt *= state.speedMul;
    updateSpawning(dt);
    updateTowers(dt);
    updateProjectiles(dt);
    updateEnemies(dt);
    updateParticles(dt);
  }

  render();
  requestAnimationFrame(loop);
}

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
updateHud();
renderShop();
renderSelection();
requestAnimationFrame(loop);
