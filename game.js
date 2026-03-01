// もどきムズムズ v2.1
// v2機能を維持したまま、テーマ切替（🌌宇宙エネルギー玉）を追加
(() => {
  'use strict';

  const CONFIG = {
    cols: 8,
    rows: 11,

    types: 6,
    timeLimitSec: 60,
    minChain: 3,

    cellPad: 4,
    wobble: 0.08,
    sparkle: 12,

    bombEveryN: 2,
    bombChance: 0.65,
    bombRadius: 1,
    bombScore: 180,

    feverNeed: 100,
    feverGainPerPop: 7,
    feverSeconds: 8.0,
    feverMult: 2.0,

    comboMultStep: 0.15,
    comboMultCap: 3.00,
  };

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  let currentDpr = 1;
  let cssCanvasW = 520;
  let cssCanvasH = 760;

  const elScore = document.getElementById('score');
  const elHiscore = document.getElementById('hiscore');
  const elCombo = document.getElementById('combo');
  const elMult  = document.getElementById('mult');
  const elTime  = document.getElementById('time');
  const elFeverFill = document.getElementById('feverFill');

  const btnStart = document.getElementById('btnStart');
  const btnPause = document.getElementById('btnPause');
  const btnReset = document.getElementById('btnReset');
  const btnAnim  = document.getElementById('btnAnim');
  const btnSound = document.getElementById('btnSound');

  const themeSelect = document.getElementById('themeSelect');

  // ---- localStorage keys ----
  const LS_HISCORE = 'modoki_muzumuz_hiscore_v1';
  const LS_THEME   = 'modoki_muzumuz_theme_v1';

  function loadNumber(key, defV){
    const v = Number(localStorage.getItem(key) ?? String(defV));
    return Number.isFinite(v) ? v : defV;
  }
  function saveNumber(key, v){
    localStorage.setItem(key, String(Math.max(0, Math.floor(v))));
  }
  function loadText(key, defV){
    const v = (localStorage.getItem(key) ?? defV);
    return (typeof v === 'string' && v.length) ? v : defV;
  }
  function saveText(key, v){
    localStorage.setItem(key, String(v));
  }

  let hiscore = loadNumber(LS_HISCORE, 0);
  elHiscore.textContent = String(hiscore);

  // ---- Theme ----
  const THEMES = {
    default: {
      name: '通常',
      palette: [
        {fill:'#ff6b88', stroke:'rgba(255,255,255,.75)', eye:'#1a0b10'},
        {fill:'#7cf6d3', stroke:'rgba(255,255,255,.75)', eye:'#07201a'},
        {fill:'#8aa6ff', stroke:'rgba(255,255,255,.75)', eye:'#0a1024'},
        {fill:'#ffd86b', stroke:'rgba(255,255,255,.75)', eye:'#241a07'},
        {fill:'#c58bff', stroke:'rgba(255,255,255,.75)', eye:'#1b0a24'},
        {fill:'#7fe1ff', stroke:'rgba(255,255,255,.75)', eye:'#071a24'},
      ],
      glow: false
    },
    space: {
      name: '宇宙エネルギー玉',
      palette: [
        {fill:'#00f0ff', stroke:'rgba(255,255,255,.55)', eye:'#071a24'},
        {fill:'#ff00f7', stroke:'rgba(255,255,255,.55)', eye:'#24071f'},
        {fill:'#00ff88', stroke:'rgba(255,255,255,.55)', eye:'#072014'},
        {fill:'#ffaa00', stroke:'rgba(255,255,255,.55)', eye:'#241807'},
        {fill:'#ffffff', stroke:'rgba(255,255,255,.45)', eye:'#0a1024'},
        {fill:'#ff0044', stroke:'rgba(255,255,255,.55)', eye:'#24070f'},
      ],
      glow: true
    }
  };

  let currentTheme = loadText(LS_THEME, 'default');
  if (!THEMES[currentTheme]) currentTheme = 'default';
  themeSelect.value = currentTheme;

  themeSelect.addEventListener('change', (e) => {
    const v = e.target.value;
    if (THEMES[v]){
      currentTheme = v;
      saveText(LS_THEME, currentTheme);
    }
  });

  // ---- State ----
  let cellW, cellH, radius;
  let board = []; // {k:'n'|'b', t, y, vy, pop, id}
  let running = false;
  let paused = false;

  let score = 0;
  let combo = 0;
  let timeLeft = CONFIG.timeLimitSec;

  let feverGauge = 0;
  let feverLeft = 0;

  let pointerDown = false;
  let chain = [];
  let chainType = -1;

  let particles = [];
  let floatTexts = [];

  let animOn = true;
  let soundOn = true;

  let popEvents = 0;
  let uid = 1;

  // ---- Audio ----
  let audioCtx = null;
  function ensureAudio(){
    if (!soundOn) return null;
    if (!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioCtx;
  }
  function beep(freq, dur, type='sine', vol=0.05){
    if (!soundOn) return;
    const ac = ensureAudio();
    if (!ac) return;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function sfxPop(n){
    const f = 520 + Math.min(12, n) * 28;
    beep(f, 0.07, 'triangle', 0.045);
  }
  function sfxBomb(){
    beep(180, 0.12, 'sawtooth', 0.06);
    setTimeout(()=>beep(120, 0.10, 'sawtooth', 0.05), 40);
  }
  function sfxFeverOn(){
    beep(660, 0.10, 'square', 0.05);
    setTimeout(()=>beep(880, 0.10, 'square', 0.05), 90);
  }
  function sfxFeverOff(){
    beep(440, 0.10, 'triangle', 0.05);
    setTimeout(()=>beep(330, 0.12, 'triangle', 0.05), 90);
  }

  // ---- Utils ----
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, bInclusive) => Math.floor(rand(a, bInclusive + 1));
  const cellIndex = (c, r) => r * CONFIG.cols + c;

  function fitCanvasToViewport(){
    // スマホ優先：画面内に盤面が必ず収まるようにcanvasをリサイズ（比率維持）
    const wrap = document.getElementById('canvasWrap') || canvas.parentElement;
    const topbar = document.querySelector('.topbar');
    const topH = topbar ? topbar.getBoundingClientRect().height : 0;

    const padding = 20; // stage padding + safety
    const vh = window.innerHeight; // iOSの動的UIを考慮した実高さ
    const availH = Math.max(240, Math.floor(vh - topH - padding - 70)); // 70=details分の余裕（閉じてても安全側）
    const rect = wrap.getBoundingClientRect();
    const availW = Math.max(260, Math.floor(rect.width));

    const aspect = CONFIG.rows / CONFIG.cols; // height / width
    let w = availW;
    let h = Math.floor(w * aspect);
    if (h > availH){
      h = availH;
      w = Math.floor(h / aspect);
    }

    cssCanvasW = w;
    cssCanvasH = h;

    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    currentDpr = dpr;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // 以降の描画はCSSピクセル座標で行い、内部でdpr倍される
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    resizeMetrics();
  }


  function resizeMetrics(){
    const w = cssCanvasW;
    const h = cssCanvasH;
    cellW = w / CONFIG.cols;
    cellH = h / CONFIG.rows;
    radius = Math.min(cellW, cellH) * 0.46;
  }

  function mkPiece(type){
    return { k:'n', t: type, y: 0, vy: 0, pop: 0, id: uid++ };
  }
  function mkBomb(){
    return { k:'b', t: 0, y: 0, vy: 0, pop: 0, id: uid++ };
  }
  function randomType(){
    return randi(0, CONFIG.types - 1);
  }

  function cellCenter(c, r){
    return { x: (c + 0.5) * cellW, y: (r + 0.5) * cellH };
  }

  function initBoard(){
    board = new Array(CONFIG.cols * CONFIG.rows);
    for (let r=0; r<CONFIG.rows; r++){
      for (let c=0; c<CONFIG.cols; c++){
        const p = mkPiece(randomType());
        p.y = animOn ? -rand(20, 240) : 0;
        p.vy = animOn ? rand(0, 2) : 0;
        board[cellIndex(c,r)] = p;
      }
    }
    particles = [];
    floatTexts = [];
    chain = [];
    chainType = -1;
    feverGauge = 0;
    feverLeft = 0;
    elFeverFill.style.width = '0%';
    popEvents = 0;
  }

  function comboMultiplier(){
    const m = 1 + Math.max(0, combo - 1) * CONFIG.comboMultStep;
    return Math.min(CONFIG.comboMultCap, m);
  }
  function feverMultiplier(){
    return (feverLeft > 0) ? CONFIG.feverMult : 1.0;
  }
  function totalMultiplier(){
    return comboMultiplier() * feverMultiplier();
  }
  function setMultiplierUI(){
    elMult.textContent = `x${totalMultiplier().toFixed(2)}`;
  }

  function resetGame(){
    score = 0;
    combo = 0;
    timeLeft = CONFIG.timeLimitSec;
    elScore.textContent = String(score);
    elCombo.textContent = String(combo);
    elTime.textContent = timeLeft.toFixed(1);
    setMultiplierUI();
    initBoard();
  }

  function startGame(){
    fitCanvasToViewport();
    resetGame();
    running = true;
    paused = false;
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnPause.textContent = '一時停止';
    ensureAudio();
  }

  function setPaused(v){
    if (!running) return;
    paused = v;
    btnPause.textContent = paused ? '再開' : '一時停止';
  }

  function endGame(){
    running = false;
    paused = false;
    btnStart.disabled = false;
    btnPause.disabled = true;
    chain = [];
    chainType = -1;

    if (score > hiscore){
      hiscore = score;
      elHiscore.textContent = String(hiscore);
      saveNumber(LS_HISCORE, hiscore);
      floatTexts.push({x: canvas.width*0.5, y: canvas.height*0.30, text:'NEW HISCORE!', life: 1.3});
      beep(988, 0.12, 'square', 0.06);
    }
  }

  // ---- Toggles ----
  function updateToggleButtons(){
    btnAnim.textContent  = `アニメ: ${animOn ? 'ON' : 'OFF'}`;
    btnSound.textContent = `効果音: ${soundOn ? 'ON' : 'OFF'}`;
  }
  function toggleAnim(){ animOn = !animOn; updateToggleButtons(); }
  function toggleSound(){ soundOn = !soundOn; updateToggleButtons(); if (soundOn) ensureAudio(); }

  btnAnim.addEventListener('click', toggleAnim);
  btnSound.addEventListener('click', toggleSound);

  // ---- Input ----
  function getPointerPos(evt){
    const rect = canvas.getBoundingClientRect();
    const x = (evt.clientX - rect.left);
    const y = (evt.clientY - rect.top);
    return {x, y};
  }

  function hitCell(x, y){
    const c = clamp(Math.floor(x / cellW), 0, CONFIG.cols - 1);
    const r = clamp(Math.floor(y / cellH), 0, CONFIG.rows - 1);
    return {c, r};
  }

  function isNeighbor(a, b){
    const dc = Math.abs(a.c - b.c);
    const dr = Math.abs(a.r - b.r);
    return (dc <= 1 && dr <= 1) && !(dc === 0 && dr === 0);
  }
  function sameCell(a, b){ return a.c === b.c && a.r === b.r; }

  function isBombCell(cell){
    const p = board[cellIndex(cell.c, cell.r)];
    return !!p && p.k === 'b';
  }

  function tryAddToChain(cell){
    const idx = cellIndex(cell.c, cell.r);
    const p = board[idx];
    if (!p) return;
    if (p.k === 'b') return;

    if (chain.length === 0){
      chain.push(cell);
      chainType = p.t;
      return;
    }

    if (p.t !== chainType) return;

    const last = chain[chain.length - 1];

    if (chain.length >= 2){
      const prev = chain[chain.length - 2];
      if (sameCell(cell, prev)){
        chain.pop();
        return;
      }
    }

    for (let i=0; i<chain.length; i++){
      if (sameCell(cell, chain[i])) return;
    }

    if (isNeighbor(cell, last)){
      chain.push(cell);
    }
  }

  function pointerStart(evt){
    if (!running || paused) return;
    pointerDown = true;
    chain = [];
    chainType = -1;

    const {x,y} = getPointerPos(evt);
    const cell = hitCell(x,y);
    if (isBombCell(cell)) return;
    tryAddToChain(cell);
  }

  function pointerMove(evt){
    if (!pointerDown || !running || paused) return;
    const {x,y} = getPointerPos(evt);
    tryAddToChain(hitCell(x,y));
  }

  function pointerEnd(evt){
    if (!pointerDown) return;
    pointerDown = false;
    if (!running || paused) return;

    const {x,y} = getPointerPos(evt);
    const cell = hitCell(x,y);

    if (chain.length === 0 && isBombCell(cell)){
      detonateBombAt(cell.c, cell.r);
      return;
    }

    if (chain.length >= CONFIG.minChain){
      popChain(chain);
    } else {
      combo = 0;
      elCombo.textContent = String(combo);
      setMultiplierUI();
    }
    chain = [];
    chainType = -1;
  }

  canvas.addEventListener('pointerdown', (e) => { canvas.setPointerCapture(e.pointerId); pointerStart(e); });
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerEnd);
  canvas.addEventListener('pointercancel', pointerEnd);
  canvas.addEventListener('pointerleave', pointerEnd);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space'){ e.preventDefault(); setPaused(!paused); }
    if (e.key.toLowerCase() === 'r'){ resetGame(); }
    if (e.key.toLowerCase() === 'a'){ toggleAnim(); }
    if (e.key.toLowerCase() === 's'){ toggleSound(); }
  });

  btnStart.addEventListener('click', startGame);
  btnPause.addEventListener('click', () => setPaused(!paused));
  btnReset.addEventListener('click', resetGame);

  // ---- Fever ----
  function addFever(nPopped){
    feverGauge += nPopped * CONFIG.feverGainPerPop;
    if (feverGauge >= CONFIG.feverNeed){
      feverGauge -= CONFIG.feverNeed;
      feverLeft = CONFIG.feverSeconds;
      sfxFeverOn();
      floatTexts.push({x: canvas.width*0.5, y: canvas.height*0.18, text:'FEVER!', life: 1.0});
    }
    elFeverFill.style.width = `${clamp((feverGauge / CONFIG.feverNeed) * 100, 0, 100)}%`;
  }

  // ---- Bomb ----
  function maybeSpawnBomb(preferredCells){
    popEvents++;
    if (popEvents % CONFIG.bombEveryN !== 0) return;
    if (Math.random() > CONFIG.bombChance) return;

    let pick = null;
    if (preferredCells && preferredCells.length){
      pick = preferredCells[randi(0, preferredCells.length - 1)];
    } else {
      pick = {c: randi(0, CONFIG.cols-1), r: randi(0, CONFIG.rows-1)};
    }
    const idx = cellIndex(pick.c, pick.r);
    if (!board[idx]) return;
    if (board[idx].k === 'b') return;

    const b = mkBomb();
    b.t = randi(0, CONFIG.types - 1);
    b.y = animOn ? -rand(30, 140) : 0;
    b.vy = animOn ? rand(0, 2) : 0;
    board[idx] = b;

    floatTexts.push({x: cellCenter(pick.c,pick.r).x, y: cellCenter(pick.c,pick.r).y - 10, text:'BOMB!', life: 0.9});
    beep(260, 0.06, 'square', 0.04);
  }

  function detonateBombAt(c, r){
    const idx0 = cellIndex(c,r);
    const b = board[idx0];
    if (!b || b.k !== 'b') return;

    sfxBomb();

    const cells = [];
    for (let rr = r - CONFIG.bombRadius; rr <= r + CONFIG.bombRadius; rr++){
      for (let cc = c - CONFIG.bombRadius; cc <= c + CONFIG.bombRadius; cc++){
        if (cc < 0 || cc >= CONFIG.cols || rr < 0 || rr >= CONFIG.rows) continue;
        const idx = cellIndex(cc, rr);
        const p = board[idx];
        if (!p) continue;
        p.pop = 1;
        cells.push({c:cc, r:rr});
      }
    }

    combo += 1;
    const gained = Math.floor((CONFIG.bombScore + cells.length * 45) * totalMultiplier());
    score += gained;
    elScore.textContent = String(score);
    elCombo.textContent = String(combo);
    setMultiplierUI();
    floatTexts.push({x: cellCenter(c,r).x, y: cellCenter(c,r).y, text:`+${gained}`, life: 0.9});

    addFever(cells.length);

    for (const cell of cells){
      const center = cellCenter(cell.c, cell.r);
      for (let i=0; i<CONFIG.sparkle; i++){
        particles.push({
          x: center.x + rand(-10, 10),
          y: center.y + rand(-10, 10),
          vx: rand(-3.6, 3.6),
          vy: rand(-5.4, -1.0),
          life: rand(0.35, 0.75)
        });
      }
    }

    setTimeout(() => {
      removePopped();
      collapseAndRefill();
      maybeSpawnBomb(null);
    }, 70);
  }

  // ---- Pop ----
  function popChain(cells){
    for (const cell of cells){
      const idx = cellIndex(cell.c, cell.r);
      const p = board[idx];
      if (p) p.pop = 1;
    }

    combo += 1;
    const base = cells.length * cells.length * 10;
    const gained = Math.floor(base * totalMultiplier());
    score += gained;

    elScore.textContent = String(score);
    elCombo.textContent = String(combo);
    setMultiplierUI();

    const last = cells[cells.length-1];
    floatTexts.push({x: cellCenter(last.c, last.r).x, y: cellCenter(last.c, last.r).y, text:`+${gained}`, life: 0.8});
    sfxPop(cells.length);

    addFever(cells.length);

    for (const cell of cells){
      const center = cellCenter(cell.c, cell.r);
      for (let i=0; i<CONFIG.sparkle; i++){
        particles.push({
          x: center.x + rand(-8, 8),
          y: center.y + rand(-8, 8),
          vx: rand(-3.0, 3.0),
          vy: rand(-4.6, -0.8),
          life: rand(0.30, 0.60)
        });
      }
    }

    setTimeout(() => {
      removePopped();
      collapseAndRefill();
      maybeSpawnBomb(cells);
    }, 60);
  }

  function removePopped(){
    for (let r=0; r<CONFIG.rows; r++){
      for (let c=0; c<CONFIG.cols; c++){
        const idx = cellIndex(c,r);
        const p = board[idx];
        if (p && p.pop){
          board[idx] = null;
        }
      }
    }
  }

  function collapseAndRefill(){
    for (let c=0; c<CONFIG.cols; c++){
      const col = [];
      for (let r=CONFIG.rows-1; r>=0; r--){
        const idx = cellIndex(c,r);
        const p = board[idx];
        if (p) col.push(p);
      }
      let writeR = CONFIG.rows - 1;
      for (let i=0; i<col.length; i++){
        board[cellIndex(c, writeR)] = col[i];
        writeR--;
      }
      while (writeR >= 0){
        const p = mkPiece(randomType());
        p.y = animOn ? -rand(60, 260) : 0;
        p.vy = animOn ? rand(0, 2) : 0;
        board[cellIndex(c, writeR)] = p;
        writeR--;
      }
    }
  }

  // ---- Drawing ----
  function getPal(typeIdx){
    const pal = THEMES[currentTheme]?.palette ?? THEMES.default.palette;
    return pal[typeIdx % pal.length];
  }
  function isGlowTheme(){
    return !!THEMES[currentTheme]?.glow;
  }

  function drawNormalPiece(c, r, p, t){
    const pal = getPal(p.t);
    const center = cellCenter(c, r);

    const drawY = center.y + (animOn ? p.y : 0);
    const wob = animOn ? Math.sin(t * 0.01 + (c*17 + r*7)) * CONFIG.wobble : 0;
    const rr = radius * (1 + wob);
    const popK = (p.pop && animOn) ? 0.78 : 1.0;

    ctx.save();
    ctx.translate(center.x, drawY);

    // shadow under
    ctx.beginPath();
    ctx.ellipse(0, rr*0.82, rr*0.72, rr*0.32, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fill();

    // body fill
    ctx.beginPath();
    ctx.arc(0, 0, rr * popK, 0, Math.PI*2);

    if (isGlowTheme()){
      const g = ctx.createRadialGradient(-rr*0.18, -rr*0.20, rr*0.06, 0, 0, rr*1.08);
      g.addColorStop(0, 'rgba(255,255,255,.95)');
      g.addColorStop(0.22, 'rgba(255,255,255,.45)');
      g.addColorStop(1, pal.fill);
      ctx.fillStyle = g;
      ctx.shadowColor = pal.fill;
      ctx.shadowBlur = 18;
    } else {
      ctx.fillStyle = pal.fill;
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = 3;
    ctx.strokeStyle = pal.stroke;
    ctx.stroke();

    // highlight
    ctx.beginPath();
    ctx.arc(-rr*0.22, -rr*0.25, rr*0.20, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill();

    // face (keep it: original simple face)
    ctx.fillStyle = pal.eye;
    const eyeY = -rr*0.10;
    const eyeX = rr*0.20;
    ctx.beginPath();
    ctx.arc(-eyeX, eyeY, rr*0.085, 0, Math.PI*2);
    ctx.arc( eyeX, eyeY, rr*0.085, 0, Math.PI*2);
    ctx.fill();

    ctx.strokeStyle = pal.eye;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    const mood = p.t % 3;
    if (mood === 0){
      ctx.arc(0, rr*0.10, rr*0.16, 0, Math.PI);
    } else if (mood === 1){
      ctx.moveTo(-rr*0.14, rr*0.18);
      ctx.quadraticCurveTo(0, rr*0.26, rr*0.14, rr*0.18);
    } else {
      ctx.moveTo(-rr*0.12, rr*0.18);
      ctx.lineTo(rr*0.12, rr*0.18);
    }
    ctx.stroke();

    ctx.restore();
  }

  function drawBomb(c, r, p, t){
    const center = cellCenter(c, r);
    const drawY = center.y + (animOn ? p.y : 0);
    const wob = animOn ? Math.sin(t * 0.012 + (c*11 + r*19)) * 0.04 : 0;
    const rr = radius * 0.98 * (1 + wob);

    ctx.save();
    ctx.translate(center.x, drawY);

    ctx.beginPath();
    ctx.ellipse(0, rr*0.82, rr*0.70, rr*0.30, 0, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI*2);
    ctx.fillStyle = 'rgba(10,12,18,.95)';
    ctx.fill();

    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,.35)';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rr*0.10, -rr*0.85);
    ctx.quadraticCurveTo(rr*0.35, -rr*1.10, rr*0.10, -rr*1.25);
    ctx.stroke();

    ctx.font = '800 22px ui-sans-serif, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('💣', 0, 2);

    ctx.restore();
  }

  function drawChain(){
    if (chain.length <= 0) return;
    const pal = getPal(chainType);

    ctx.save();
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.beginPath();
    for (let i=0; i<chain.length; i++){
      const a = chain[i];
      const center = cellCenter(a.c, a.r);
      const p = board[cellIndex(a.c, a.r)];
      const y = center.y + (p && animOn ? p.y : 0);
      if (i === 0) ctx.moveTo(center.x, y);
      else ctx.lineTo(center.x, y);
    }
    ctx.stroke();

    ctx.lineWidth = 7;
    ctx.strokeStyle = pal.fill;
    ctx.stroke();
    ctx.restore();
  }

  function drawParticles(dt){
    for (let i=particles.length-1; i>=0; i--){
      const pt = particles[i];
      pt.life -= dt;
      pt.vy += 18 * dt;
      pt.x += pt.vx * 60 * dt;
      pt.y += pt.vy * 60 * dt;
      if (pt.life <= 0){
        particles.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = clamp(pt.life * 1.8, 0, 1);
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 2.6, 0, Math.PI*2);
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      ctx.fill();
      ctx.restore();
    }
  }

  function drawFloatTexts(dt){
    for (let i=floatTexts.length-1; i>=0; i--){
      const ft = floatTexts[i];
      ft.life -= dt;
      ft.y -= 22 * dt;
      if (ft.life <= 0){
        floatTexts.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = clamp(ft.life * 1.8, 0, 1);
      ctx.font = '800 22px ui-sans-serif, system-ui';
      ctx.fillStyle = 'rgba(255,255,255,.92)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ft.text, ft.x, ft.y);
      ctx.restore();
    }
  }

  function overlayCard(title, body){
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    const w = canvas.width * 0.82;
    const h = canvas.height * 0.24;
    const x = (canvas.width - w) / 2;
    const y = (canvas.height - h) / 2;

    const rr = 18;
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();

    ctx.fillStyle = 'rgba(18,26,51,.92)';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.14)';
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,.92)';
    ctx.font = '800 28px ui-sans-serif, system-ui';
    ctx.fillText(title, x + 22, y + 56);

    ctx.fillStyle = 'rgba(255,255,255,.70)';
    ctx.font = '14px ui-sans-serif, system-ui';
    let line = '';
    let yy = y + 86;
    for (const ch of body.split('')){
      const test = line + ch;
      if (ctx.measureText(test).width > (w - 44) && line){
        ctx.fillText(line, x + 22, yy);
        line = ch;
        yy += 20;
      } else {
        line = test;
      }
    }
    ctx.fillText(line, x + 22, yy);

    ctx.restore();
  }

  function drawOverlay(){
    if (!running){
      overlayCard('スタートで開始', '制限時間は60秒想定です。テーマも切り替えられます。');
      return;
    }
    if (paused){
      overlayCard('一時停止中', 'スペースキー or ボタンで再開できます。');
      return;
    }
    if (running && timeLeft <= 0){
      overlayCard('終了', 'おつかれさまでした。スタートで再挑戦できます。');
    }
  }

  // ---- Loop ----
  let lastTs = 0;
  function update(dt, t){
    if (!running || paused) return;

    const timeRate = (feverLeft > 0) ? 0.85 : 1.0;
    timeLeft = Math.max(0, timeLeft - dt * timeRate);
    elTime.textContent = timeLeft.toFixed(1);

    if (feverLeft > 0){
      feverLeft = Math.max(0, feverLeft - dt);
      if (feverLeft === 0) sfxFeverOff();
    }
    setMultiplierUI();

    if (timeLeft <= 0){
      endGame();
      return;
    }

    for (let r=0; r<CONFIG.rows; r++){
      for (let c=0; c<CONFIG.cols; c++){
        const p = board[cellIndex(c,r)];
        if (!p) continue;

        if (!animOn){
          p.y = 0;
          p.vy = 0;
          continue;
        }
        p.vy += 1.4;
        p.y += p.vy;
        if (p.y > 0){
          p.y *= 0.4;
          if (Math.abs(p.y) < 0.5) p.y = 0;
          p.vy *= 0.35;
        }
      }
    }
  }

  function render(dt, t){
    ctx.clearRect(0,0,canvas.width,canvas.height);

    if (feverLeft > 0){
      ctx.save();
      ctx.fillStyle = 'rgba(124,246,211,.08)';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.restore();
    }

    // grid
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    for (let c=1; c<CONFIG.cols; c++){
      ctx.beginPath();
      ctx.moveTo(c*cellW, 0);
      ctx.lineTo(c*cellW, canvas.height);
      ctx.stroke();
    }
    for (let r=1; r<CONFIG.rows; r++){
      ctx.beginPath();
      ctx.moveTo(0, r*cellH);
      ctx.lineTo(canvas.width, r*cellH);
      ctx.stroke();
    }
    ctx.restore();

    for (let r=0; r<CONFIG.rows; r++){
      for (let c=0; c<CONFIG.cols; c++){
        const p = board[cellIndex(c,r)];
        if (!p) continue;
        if (p.k === 'b') drawBomb(c, r, p, t);
        else drawNormalPiece(c, r, p, t);
      }
    }

    drawChain();
    drawParticles(dt);
    drawFloatTexts(dt);
    drawOverlay();
  }

  function loop(ts){
    if (!lastTs) lastTs = ts;
    const dt = clamp((ts - lastTs) / 1000, 0, 0.05);
    lastTs = ts;

    update(dt, ts);
    render(dt, ts);

    requestAnimationFrame(loop);
  }

  // ---- Init ----
  fitCanvasToViewport();
  resetGame();
  updateToggleButtons();
  requestAnimationFrame(loop);

  // 画面回転/アドレスバー変動/リサイズに追従
  window.addEventListener('resize', () => {
    window.clearTimeout(window.__mm_resizeT);
    window.__mm_resizeT = window.setTimeout(() => {
      fitCanvasToViewport();
    }, 120);
  });
  window.addEventListener('orientationchange', () => {
    window.setTimeout(() => fitCanvasToViewport(), 240);
  });

})();