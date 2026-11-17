// 霓虹蛇 Neon Serpent — p5.js
// 三種模式、連擊計分、限時金蘋果、減速與穿身道具、平滑移動、全球排行榜

// ================= 設定 =================
const COLS = 20;
const ROWS = 20;

const MODES = {
  classic: { label: '經典', desc: '撞到牆或自己就結束。', wrap: false, maze: false },
  wrap: { label: '穿牆', desc: '從一邊出去會從另一邊回來，只怕撞到自己。', wrap: true, maze: false },
  maze: { label: '迷宮', desc: '場上有固定障礙物，路線更考驗反應。', wrap: false, maze: true },
};

const ITEMS = {
  apple: { pts: 1, grow: true, color: [255, 82, 102] },
  gold: { pts: 5, grow: true, color: [255, 205, 60], ttl: 6000 },
  ice: { pts: 0, grow: false, color: [90, 220, 255], ttl: 8000, effect: 'slow', dur: 5000, label: '減速' },
  ghost: { pts: 0, grow: false, color: [190, 130, 255], ttl: 8000, effect: 'ghost', dur: 5000, label: '穿身' },
};

const COMBO_WINDOW = 3000; // 毫秒內再吃到就累積連擊
const COMBO_MAX = 5;
const BASE_INTERVAL = 130; // 每步毫秒
const MIN_INTERVAL = 62;
const SPEEDUP = 2;
const SLOW_FACTOR = 1.6;
const GOLD_CHANCE = 0.14;
const POWER_CHANCE = 0.12;

const KEY_DIRS = {
  ArrowUp: { x: 0, y: -1 }, w: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 }, s: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 }, a: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 }, d: { x: 1, y: 0 },
};

// ================= 狀態 =================
let cell = 20;
let phase = 'menu'; // menu | countdown | playing | paused | dying | over
let mode = 'classic';
let G = null;
let boardLayer = null;
let particles = [];
let floaters = [];
let shake = 0;
let flash = 0;
let countdownEnd = 0;
let lastCountdownBeep = 0;
let muted = false;
let audioCtx = null;
let hudCache = {};
const ui = {};

// ================= 本機儲存 =================
function store(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, value);
  } catch (e) {
    return null;
  }
}
const bestKey = m => 'serpent-best-' + m;
const getBest = m => Number(store(bestKey(m))) || 0;

// ================= p5 =================
function setup() {
  const c = createCanvas(COLS * cell, ROWS * cell);
  c.parent('stage');
  c.elt.setAttribute('aria-label', '遊戲畫面');
  textFont('ui-monospace, Menlo, monospace');
  muted = store('serpent-muted') === '1';
  mode = MODES[store('serpent-mode')] ? store('serpent-mode') : 'classic';
  bindUI();
  fitCanvas();
  selectMode(mode);
  showMenu();
  initNetwork();
}

function windowResized() {
  fitCanvas();
}

function fitCanvas() {
  const maxW = Math.min(window.innerWidth - 32, 568);
  const reserved = 190; // 頂部列 + HUD + 提示
  const maxH = Math.max(240, window.innerHeight - reserved);
  cell = Math.max(12, Math.floor(Math.min(maxW / COLS, maxH / ROWS)));
  resizeCanvas(COLS * cell, ROWS * cell);
  document.getElementById('app').style.maxWidth = COLS * cell + 32 + 'px';
  buildBoardLayer();
}

function draw() {
  update();

  push();
  if (shake > 0.4) {
    translate(random(-shake, shake), random(-shake, shake));
    shake *= 0.86;
  } else {
    shake = 0;
  }
  image(boardLayer, 0, 0);
  if (G) {
    drawItems();
    drawSnake();
  }
  drawParticles();
  drawFloaters();
  pop();

  if (flash > 0) {
    noStroke();
    fill(255, 255, 255, flash * 110);
    rect(0, 0, width, height);
    flash = Math.max(0, flash - 0.07);
  }
  if (phase === 'countdown') drawCountdown();
  if (phase === 'paused') drawCenterText('暫停', '按空白鍵或點一下繼續');

  if (G && (phase === 'playing' || phase === 'paused' || phase === 'countdown')) updateLiveHUD();
}

// ================= 遊戲流程 =================
function newGame() {
  const cy = Math.floor(ROWS / 2);
  G = {
    snake: [{ x: 9, y: cy }, { x: 8, y: cy }, { x: 7, y: cy }],
    prev: null,
    dir: { x: 1, y: 0 },
    queue: [],
    walls: MODES[mode].maze ? buildMaze() : new Set(),
    items: [],
    score: 0,
    eaten: 0,
    combo: 0,
    lastEat: -Infinity,
    interval: BASE_INTERVAL,
    time: 0,
    lastStep: 0,
    effects: { slow: 0, ghost: 0 },
    best: getBest(mode),
    submitted: false,
    won: false,
  };
  G.prev = G.snake.map(s => ({ ...s }));
  spawn('apple');
  particles = [];
  floaters = [];
  hudCache = {};
  buildBoardLayer();
}

function startGame() {
  ensureAudio();
  newGame();
  hide(ui.menu);
  hide(ui.over);
  phase = 'countdown';
  countdownEnd = millis() + 1800;
  lastCountdownBeep = 0;
  updateHUD();
}

function update() {
  if (phase === 'countdown') {
    const left = Math.ceil((countdownEnd - millis()) / 600);
    if (left !== lastCountdownBeep && left > 0) {
      lastCountdownBeep = left;
      sfx('tick');
    }
    if (millis() >= countdownEnd) {
      phase = 'playing';
      G.lastStep = G.time;
      sfx('go');
    }
  }

  if (phase === 'playing') {
    G.time += Math.min(deltaTime, 100);
    let guard = 0;
    while (phase === 'playing' && G.time - G.lastStep >= curInterval() && guard++ < 4) {
      G.lastStep += curInterval();
      step();
    }
    const before = G.items.length;
    G.items = G.items.filter(it => !ITEMS[it.type].ttl || G.time < it.born + ITEMS[it.type].ttl);
    if (G.items.length !== before && !G.items.some(i => i.type === 'apple')) spawn('apple');
  }

  if (phase === 'dying' && millis() - G.endedAt > 950) showOver();
}

function curInterval() {
  return G.interval * (G.time < G.effects.slow ? SLOW_FACTOR : 1);
}

function step() {
  if (G.queue.length) G.dir = G.queue.shift();
  const cfg = MODES[mode];
  const head = G.snake[0];
  let nx = head.x + G.dir.x;
  let ny = head.y + G.dir.y;

  if (cfg.wrap) {
    nx = (nx + COLS) % COLS;
    ny = (ny + ROWS) % ROWS;
  } else if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) {
    return die();
  }
  if (G.walls.has(nx + ',' + ny)) return die();

  const idx = G.items.findIndex(it => it.x === nx && it.y === ny);
  const item = idx >= 0 ? G.items[idx] : null;
  const grows = Boolean(item && ITEMS[item.type].grow);
  // 沒有變長時尾巴會讓出位置，所以撞自己不算最後一節
  const body = grows ? G.snake : G.snake.slice(0, -1);
  const ghost = G.time < G.effects.ghost;
  if (!ghost && body.some(s => s.x === nx && s.y === ny)) return die();

  G.prev = G.snake.map(s => ({ ...s }));
  G.snake.unshift({ x: nx, y: ny });
  if (!grows) G.snake.pop();

  if (item) {
    G.items.splice(idx, 1);
    eat(item);
  }
}

function eat(item) {
  const def = ITEMS[item.type];
  const px = (item.x + 0.5) * cell;
  const py = (item.y + 0.5) * cell;

  if (def.grow) {
    G.combo = G.time - G.lastEat <= COMBO_WINDOW ? Math.min(G.combo + 1, COMBO_MAX) : 1;
    G.lastEat = G.time;
    const gain = def.pts * G.combo;
    G.score += gain;
    G.eaten++;
    G.interval = Math.max(MIN_INTERVAL, G.interval - SPEEDUP);
    floater(px, py, G.combo > 1 ? `+${gain}  x${G.combo}` : `+${gain}`, def.color);
    burst(px, py, def.color, item.type === 'gold' ? 26 : 12);
    sfx(item.type === 'gold' ? 'gold' : 'eat', G.combo);

    if (item.type === 'apple') {
      if (!spawn('apple')) return die(true);
      if (!G.items.some(i => i.type === 'gold') && random() < GOLD_CHANCE) spawn('gold');
      const hasPower = G.items.some(i => ITEMS[i.type].effect);
      if (!hasPower && G.eaten >= 3 && random() < POWER_CHANCE) spawn(random(['ice', 'ghost']));
    }
  } else {
    G.effects[def.effect] = G.time + def.dur;
    floater(px, py, def.label + '！', def.color);
    burst(px, py, def.color, 20);
    sfx('power');
  }
  updateHUD();
}

function spawn(type) {
  const taken = new Set(G.walls);
  G.snake.forEach(s => taken.add(s.x + ',' + s.y));
  G.items.forEach(i => taken.add(i.x + ',' + i.y));
  // 不要生在蛇頭正前方兩格，避免「憑空吃到」
  const h = G.snake[0];
  for (let k = 1; k <= 2; k++) taken.add(h.x + G.dir.x * k + ',' + (h.y + G.dir.y * k));

  const free = [];
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if (!taken.has(x + ',' + y)) free.push({ x, y });
    }
  }
  if (!free.length) return false;
  const p = random(free);
  G.items.push({ type, x: p.x, y: p.y, born: G.time });
  return true;
}

function die(won = false) {
  phase = 'dying';
  G.won = won;
  G.endedAt = millis();
  G.queue = [];
  if (won) {
    flash = 1;
    sfx('win');
  } else {
    shake = cell * 0.6;
    flash = 0.8;
    sfx('die');
    G.snake.forEach((s, i) => {
      if (i % 2 === 0) burst((s.x + 0.5) * cell, (s.y + 0.5) * cell, [80, 255, 170], 4);
    });
  }
  if (G.score > G.best) store(bestKey(mode), String(G.score));
  updateHUD();
}

function togglePause() {
  if (phase === 'playing') {
    phase = 'paused';
    ui.btnPause.textContent = '▶';
  } else if (phase === 'paused') {
    phase = 'playing';
    ui.btnPause.textContent = '⏸';
  }
}

function queueDir(d) {
  if (phase !== 'playing' && phase !== 'countdown') return;
  const last = G.queue.length ? G.queue[G.queue.length - 1] : G.dir;
  const reverse = d.x === -last.x && d.y === -last.y;
  const same = d.x === last.x && d.y === last.y;
  if (!reverse && !same && G.queue.length < 3) G.queue.push(d);
}

function buildMaze() {
  const w = new Set();
  const add = (x, y) => w.add(x + ',' + y);
  for (let x = 4; x <= 8; x++) { add(x, 4); add(x, 15); }
  for (let x = 11; x <= 15; x++) { add(x, 4); add(x, 15); }
  for (let y = 5; y <= 7; y++) { add(4, y); add(15, y); }
  for (let y = 12; y <= 14; y++) { add(4, y); add(15, y); }
  for (let y = 7; y <= 8; y++) add(10, y);
  for (let y = 12; y <= 13; y++) add(10, y);
  return w;
}

// ================= 繪圖 =================
function buildBoardLayer() {
  if (boardLayer) boardLayer.remove();
  boardLayer = createGraphics(width, height);
  const g = boardLayer;
  g.background(11, 15, 23);
  g.noStroke();
  for (let x = 0; x < COLS; x++) {
    for (let y = 0; y < ROWS; y++) {
      if ((x + y) % 2 === 0) {
        g.fill(255, 255, 255, 6);
        g.rect(x * cell, y * cell, cell, cell);
      }
    }
  }
  g.fill(255, 255, 255, 22);
  for (let x = 1; x < COLS; x++) {
    for (let y = 1; y < ROWS; y++) g.circle(x * cell, y * cell, 2);
  }
  // 穿牆模式：邊框用虛線提示可以穿過
  if (MODES[mode].wrap) {
    g.drawingContext.setLineDash([cell * 0.3, cell * 0.3]);
    g.stroke(51, 194, 255, 90);
  } else {
    g.stroke(255, 82, 102, 70);
  }
  g.strokeWeight(3);
  g.noFill();
  g.rect(1.5, 1.5, width - 3, height - 3);
  g.drawingContext.setLineDash([]);

  if (G && G.walls.size) {
    g.noStroke();
    G.walls.forEach(k => {
      const [x, y] = k.split(',').map(Number);
      g.fill(46, 56, 80);
      g.rect(x * cell + 1, y * cell + 1, cell - 2, cell - 2, cell * 0.2);
      g.fill(255, 255, 255, 25);
      g.rect(x * cell + 3, y * cell + 2, cell - 6, cell * 0.22, cell * 0.1);
    });
  }
}

function drawItems() {
  const ctx = drawingContext;
  for (const it of G.items) {
    const def = ITEMS[it.type];
    const left = def.ttl ? it.born + def.ttl - G.time : Infinity;
    if (left < 2000 && Math.floor(G.time / 110) % 2 === 0) continue; // 快消失時閃爍
    const cx = (it.x + 0.5) * cell;
    const cy = (it.y + 0.5) * cell;
    const pulse = 1 + 0.07 * Math.sin(millis() / 140 + it.x);
    const [r, g, b] = def.color;

    ctx.shadowBlur = cell * 0.7;
    ctx.shadowColor = `rgb(${r},${g},${b})`;
    noStroke();
    fill(r, g, b);

    if (it.type === 'apple') {
      circle(cx, cy, cell * 0.62 * pulse);
      fill(255, 255, 255, 120);
      circle(cx - cell * 0.1, cy - cell * 0.1, cell * 0.14);
    } else if (it.type === 'gold') {
      star(cx, cy, cell * 0.2 * pulse, cell * 0.42 * pulse, 5);
      ctx.shadowBlur = 0;
      noFill();
      stroke(r, g, b, 160);
      strokeWeight(2);
      arc(cx, cy, cell * 1.05, cell * 1.05, -HALF_PI, -HALF_PI + TWO_PI * (left / def.ttl));
    } else if (it.type === 'ice') {
      push();
      translate(cx, cy);
      rotate(QUARTER_PI);
      rectMode(CENTER);
      rect(0, 0, cell * 0.46 * pulse, cell * 0.46 * pulse, 3);
      pop();
    } else if (it.type === 'ghost') {
      noFill();
      stroke(r, g, b);
      strokeWeight(cell * 0.13);
      circle(cx, cy, cell * 0.52 * pulse);
      noStroke();
      fill(r, g, b);
      circle(cx, cy, cell * 0.16);
    }
  }
  ctx.shadowBlur = 0;
}

function star(x, y, r1, r2, n) {
  beginShape();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? r2 : r1;
    const a = -HALF_PI + (i * PI) / n;
    vertex(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  endShape(CLOSE);
}

function snakePoints() {
  let t = 1;
  if (phase === 'playing' || phase === 'paused') {
    t = constrain((G.time - G.lastStep) / curInterval(), 0, 1);
  }
  return G.snake.map((b, i) => {
    const a = G.prev[Math.min(i, G.prev.length - 1)];
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 1) return { x: b.x, y: b.y }; // 穿牆那一步不補間
    return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
  });
}

function drawSnake() {
  const pts = snakePoints();
  const n = pts.length;
  const ghost = G.time < G.effects.ghost;
  const dead = phase === 'dying' || phase === 'over';
  const alpha = ghost ? 120 : 255;
  const head = color(80, 255, 170, alpha);
  const tail = color(30, 140, 200, alpha);

  strokeCap(ROUND);
  strokeWeight(cell * 0.74);
  for (let i = n - 1; i >= 1; i--) {
    const a = pts[i];
    const b = pts[i - 1];
    const c = dead ? color(110, 120, 140, 200) : lerpColor(head, tail, i / Math.max(1, n - 1));
    stroke(c);
    if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= 1.01) {
      line((a.x + 0.5) * cell, (a.y + 0.5) * cell, (b.x + 0.5) * cell, (b.y + 0.5) * cell);
    } else {
      point((a.x + 0.5) * cell, (a.y + 0.5) * cell);
    }
  }

  // 頭
  const h = pts[0];
  const hx = (h.x + 0.5) * cell;
  const hy = (h.y + 0.5) * cell;
  noStroke();
  if (!dead) {
    drawingContext.shadowBlur = cell * 0.8;
    drawingContext.shadowColor = ghost ? 'rgba(190,130,255,0.9)' : 'rgba(80,255,170,0.9)';
  }
  fill(dead ? color(150, 160, 180) : head);
  circle(hx, hy, cell * 0.9);
  drawingContext.shadowBlur = 0;

  const d = G.dir;
  const px = -d.y;
  const py = d.x;
  for (const side of [-1, 1]) {
    const ex = hx + d.x * cell * 0.16 + px * cell * 0.2 * side;
    const ey = hy + d.y * cell * 0.16 + py * cell * 0.2 * side;
    fill(255);
    circle(ex, ey, cell * 0.26);
    fill(10, 14, 22);
    if (dead) {
      stroke(10, 14, 22);
      strokeWeight(2);
      const s = cell * 0.08;
      line(ex - s, ey - s, ex + s, ey + s);
      line(ex - s, ey + s, ex + s, ey - s);
      noStroke();
    } else {
      circle(ex + d.x * cell * 0.04, ey + d.y * cell * 0.04, cell * 0.13);
    }
  }
}

function burst(x, y, col, count) {
  for (let i = 0; i < count; i++) {
    const a = random(TWO_PI);
    const sp = random(1, 4.5) * (cell / 20);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, decay: random(0.02, 0.05), col, size: random(2, 5) * (cell / 20) });
  }
  if (particles.length > 400) particles.splice(0, particles.length - 400);
}

function drawParticles() {
  noStroke();
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.94;
    p.vy *= 0.94;
    p.life -= p.decay;
    fill(p.col[0], p.col[1], p.col[2], 255 * Math.max(0, p.life));
    circle(p.x, p.y, p.size);
  }
  particles = particles.filter(p => p.life > 0);
}

function floater(x, y, txt, col) {
  floaters.push({ x, y, txt, col, life: 1 });
}

function drawFloaters() {
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(Math.max(12, cell * 0.7));
  noStroke();
  for (const f of floaters) {
    f.y -= cell * 0.04;
    f.life -= 0.018;
    fill(f.col[0], f.col[1], f.col[2], 255 * Math.max(0, f.life));
    text(f.txt, f.x, f.y - cell * 0.5);
  }
  floaters = floaters.filter(f => f.life > 0);
}

function drawCountdown() {
  const left = Math.max(1, Math.ceil((countdownEnd - millis()) / 600));
  const frac = ((countdownEnd - millis()) % 600) / 600;
  noStroke();
  fill(0, 0, 0, 90);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(cell * (3 + frac * 1.5));
  fill(77, 255, 176, 120 + 135 * frac);
  text(left, width / 2, height / 2);
  textSize(Math.max(12, cell * 0.6));
  fill(230, 237, 247, 200);
  text(MODES[mode].label + '模式', width / 2, height / 2 + cell * 3);
}

function drawCenterText(title, sub) {
  noStroke();
  fill(0, 0, 0, 150);
  rect(0, 0, width, height);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  fill(255);
  textSize(cell * 1.6);
  text(title, width / 2, height / 2 - cell * 0.6);
  textStyle(NORMAL);
  textSize(Math.max(12, cell * 0.65));
  fill(200, 210, 225);
  text(sub, width / 2, height / 2 + cell * 1);
}

// ================= 音效（Web Audio，不需要外部檔案）=================
function ensureAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) audioCtx = new AC();
}

function tone(freq, dur, type = 'square', vol = 0.05, slideTo = null, delay = 0) {
  if (muted || !audioCtx) return;
  const t0 = audioCtx.currentTime + delay;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function sfx(name, combo = 1) {
  switch (name) {
    case 'eat': tone(420 * Math.pow(1.122, combo - 1), 0.08, 'square', 0.045); break;
    case 'gold': [660, 880, 1175].forEach((f, i) => tone(f, 0.09, 'triangle', 0.06, null, i * 0.06)); break;
    case 'power': tone(300, 0.25, 'sawtooth', 0.04, 1200); break;
    case 'die': tone(260, 0.5, 'sawtooth', 0.06, 50); break;
    case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.07, null, i * 0.1)); break;
    case 'tick': tone(520, 0.07, 'square', 0.04); break;
    case 'go': tone(880, 0.14, 'square', 0.05); break;
  }
}

function toggleMute() {
  muted = !muted;
  store('serpent-muted', muted ? '1' : '0');
  ui.btnMute.textContent = muted ? '🔇' : '🔊';
}

// ================= 介面 =================
function $(id) {
  return document.getElementById(id);
}
function show(el) {
  el.classList.remove('hidden');
}
function hide(el) {
  el.classList.add('hidden');
}

function bindUI() {
  [
    'menu', 'menuForm', 'modeDesc', 'nameInput', 'btnMenuBoard',
    'over', 'overTitle', 'ovScore', 'ovLen', 'ovTime', 'ovMode', 'ovNewBest',
    'submitForm', 'overName', 'submitStatus', 'btnAgain', 'btnOverBoard', 'btnHome',
    'board', 'boardList', 'boardStatus', 'btnCloseBoard',
    'btnBoard', 'btnMute', 'btnPause', 'netBadge',
    'hudScore', 'hudLen', 'hudCombo', 'hudBest', 'hudFx', 'comboBar', 'stage',
  ].forEach(id => (ui[id] = $(id)));

  ui.nameInput.value = store('serpent-name') || '';
  ui.btnMute.textContent = muted ? '🔇' : '🔊';

  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => selectMode(b.dataset.mode)));
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => renderBoard(b.dataset.mode)));

  ui.menuForm.addEventListener('submit', e => {
    e.preventDefault();
    saveName(ui.nameInput.value);
    ui.nameInput.blur();
    startGame();
  });
  ui.submitForm.addEventListener('submit', e => {
    e.preventDefault();
    if (!cleanName(ui.overName.value)) {
      setStatus('請先輸入暱稱', 'bad');
      return;
    }
    saveName(ui.overName.value);
    ui.overName.blur();
    submitScore();
  });

  ui.btnMenuBoard.addEventListener('click', () => openBoard(mode));
  ui.btnOverBoard.addEventListener('click', () => openBoard(mode));
  ui.btnBoard.addEventListener('click', () => openBoard(mode));
  ui.btnCloseBoard.addEventListener('click', closeBoard);
  ui.board.addEventListener('click', e => {
    if (e.target === ui.board) closeBoard();
  });
  ui.btnAgain.addEventListener('click', startGame);
  ui.btnHome.addEventListener('click', showMenu);
  ui.btnMute.addEventListener('click', toggleMute);
  ui.btnPause.addEventListener('click', () => {
    ensureAudio();
    togglePause();
  });

  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && phase === 'playing') togglePause();
  });

  // 觸控滑動
  let start = null;
  ui.stage.addEventListener('pointerdown', e => {
    if (e.target.tagName !== 'CANVAS') return;
    start = { x: e.clientX, y: e.clientY };
  });
  ui.stage.addEventListener('pointerup', e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) {
      if (phase === 'paused') togglePause();
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) queueDir({ x: Math.sign(dx), y: 0 });
    else queueDir({ x: 0, y: Math.sign(dy) });
  });
  // 手指在畫面上移動時就判斷方向，反應更快
  ui.stage.addEventListener('pointermove', e => {
    if (!start || e.pointerType === 'mouse') return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) queueDir({ x: Math.sign(dx), y: 0 });
    else queueDir({ x: 0, y: Math.sign(dy) });
    start = { x: e.clientX, y: e.clientY };
  });
}

function onKey(e) {
  const t = e.target;
  if (t && t.matches && t.matches('input, textarea')) return;

  if (!ui.board.classList.contains('hidden')) {
    if (e.key === 'Escape') closeBoard();
    return;
  }

  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const d = KEY_DIRS[k];
  if (d) {
    if (phase === 'playing' || phase === 'countdown') {
      e.preventDefault();
      queueDir(d);
    } else if (k.startsWith('Arrow')) {
      e.preventDefault();
    }
    return;
  }

  const onButton = t && t.tagName === 'BUTTON';
  if (k === ' ' || k === 'p') {
    e.preventDefault();
    togglePause();
  } else if (k === 'Enter' && !onButton) {
    if (phase === 'menu' || phase === 'over') {
      e.preventDefault();
      if (phase === 'menu') saveName(ui.nameInput.value);
      startGame();
    }
  } else if (k === 'Escape') {
    if (phase === 'over' || phase === 'paused') showMenu();
  } else if (k === 'm') {
    toggleMute();
  } else if (k === 'l') {
    openBoard(mode);
  }
}

function selectMode(m) {
  mode = m;
  store('serpent-mode', m);
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === m)));
  ui.modeDesc.textContent = MODES[m].desc + '　個人最佳：' + getBest(m);
  if (phase === 'menu') {
    G = null;
    buildBoardLayer();
    updateHUD();
  }
}

function showMenu() {
  phase = 'menu';
  ui.btnPause.textContent = '⏸';
  hide(ui.over);
  show(ui.menu);
  selectMode(mode);
}

function cleanName(s) {
  return String(s || '')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, 12);
}
function saveName(s) {
  const n = cleanName(s);
  if (n) store('serpent-name', n);
  ui.nameInput.value = n || ui.nameInput.value;
  return n;
}

function showOver() {
  phase = 'over';
  const secs = G.time / 1000;
  ui.overTitle.textContent = G.won ? '完美通關！' : '遊戲結束';
  ui.ovScore.textContent = G.score;
  ui.ovLen.textContent = G.snake.length;
  ui.ovTime.textContent = secs < 60 ? secs.toFixed(1) + 's' : Math.floor(secs / 60) + 'm' + Math.floor(secs % 60) + 's';
  ui.ovMode.textContent = MODES[mode].label;
  ui.ovNewBest.hidden = !(G.score > G.best && G.score > 0);

  const name = cleanName(store('serpent-name'));
  ui.overName.value = name;
  ui.submitForm.hidden = true;
  setStatus('');
  show(ui.over);

  if (G.score <= 0) {
    setStatus('得 1 分以上才能上排行榜');
  } else if (name) {
    submitScore();
  } else {
    ui.submitForm.hidden = false;
    setStatus('輸入暱稱就能上傳成績');
  }
  updateHUD();
}

async function submitScore() {
  if (!G || G.submitted || G.score <= 0) return;
  const name = cleanName(store('serpent-name'));
  if (!name) return;
  G.submitted = true;
  const runMode = mode;
  ui.submitForm.hidden = true;
  setStatus('上傳成績中…');
  try {
    const r = await window.Leaderboard.submit(runMode, {
      name,
      score: G.score,
      length: G.snake.length,
      durationMs: G.time,
    });
    const where = r.online ? '全球' : '本機';
    if (r.improved) setStatus(`已上傳！${where}排名第 ${r.rank} 名`, 'good');
    else setStatus(`你的最佳成績 ${r.best} 分，${where}排名第 ${r.rank} 名`, 'good');
  } catch (e) {
    console.error(e);
    G.submitted = false;
    ui.submitForm.hidden = false;
    setStatus('上傳失敗：' + (e.code || e.message || '網路錯誤') + '，可以再試一次', 'bad');
  }
}

function setStatus(msg, kind = '') {
  ui.submitStatus.textContent = msg;
  ui.submitStatus.className = 'status ' + kind;
}

// ---------- HUD ----------
function setText(el, key, value) {
  if (hudCache[key] === value) return;
  hudCache[key] = value;
  el.textContent = value;
}

function updateHUD() {
  const score = G ? G.score : 0;
  setText(ui.hudScore, 'score', String(score));
  setText(ui.hudLen, 'len', String(G ? G.snake.length : 3));
  setText(ui.hudBest, 'best', String(Math.max(getBest(mode), score)));
  setText(ui.hudCombo, 'combo', 'x' + (G && G.combo ? G.combo : 1));
  if (!G) {
    ui.comboBar.style.width = '0%';
    setText(ui.hudFx, 'fx', '');
  }
}

function updateLiveHUD() {
  // 連擊條
  const since = G.time - G.lastEat;
  const pct = since <= COMBO_WINDOW ? 100 * (1 - since / COMBO_WINDOW) : 0;
  ui.comboBar.style.width = pct.toFixed(1) + '%';
  if (pct === 0 && G.combo > 1) {
    G.combo = 0;
    updateHUD();
  }
  // 效果倒數
  const fx = [];
  for (const [k, cls, label] of [['slow', 'slow', '減速'], ['ghost', 'ghost', '穿身']]) {
    const left = G.effects[k] - G.time;
    if (left > 0) fx.push(`<span class="${cls}">${label} ${(left / 1000).toFixed(1)}s</span>`);
  }
  const html = fx.join('');
  if (hudCache.fx !== html) {
    hudCache.fx = html;
    ui.hudFx.innerHTML = html;
  }
}

// ---------- 排行榜 ----------
function openBoard(m) {
  if (phase === 'playing') togglePause();
  show(ui.board);
  renderBoard(m);
}

function closeBoard() {
  hide(ui.board);
}

let boardReq = 0;
async function renderBoard(m) {
  const req = ++boardReq;
  document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
  ui.boardList.innerHTML = '';
  ui.boardStatus.className = 'status';
  ui.boardStatus.textContent = '載入中…';
  try {
    const rows = await window.Leaderboard.top(m, 20);
    if (req !== boardReq) return;
    ui.boardStatus.textContent = window.Leaderboard.online
      ? `${MODES[m].label}模式 · 前 20 名`
      : '尚未連上全球排行榜，這裡顯示的是這台裝置的成績';
    if (!rows.length) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = '還沒有人上榜，搶第一！';
      ui.boardList.appendChild(li);
      return;
    }
    rows.forEach((r, i) => {
      const li = document.createElement('li');
      if (r.mine && window.Leaderboard.online) li.classList.add('me');
      const rank = document.createElement('span');
      rank.className = 'r';
      rank.textContent = i + 1;
      const name = document.createElement('span');
      name.className = 'n';
      name.textContent = r.name;
      const meta = document.createElement('small');
      meta.textContent = `長度 ${r.length}`;
      name.appendChild(meta);
      const score = document.createElement('span');
      score.className = 's';
      score.textContent = r.score;
      li.append(rank, name, score);
      ui.boardList.appendChild(li);
    });
  } catch (e) {
    if (req !== boardReq) return;
    console.error(e);
    ui.boardStatus.className = 'status bad';
    ui.boardStatus.textContent = '排行榜載入失敗：' + (e.code || e.message);
  }
}

function initNetwork() {
  const LB = window.Leaderboard;
  if (!LB) return;
  LB.ready.then(ok => {
    if (ok) {
      ui.netBadge.textContent = '全球排行';
      ui.netBadge.className = 'badge online';
    } else {
      ui.netBadge.textContent = LB.configured ? '連線失敗 · 本機' : '本機模式';
      ui.netBadge.className = 'badge offline';
      ui.netBadge.title = LB.configured ? '無法連上 Firebase，請看主控台錯誤訊息' : '尚未設定 firebase-config.js';
    }
  });
}
