/**
 * StudyQuest 小瑪莉 - HTML5 Game
 * 
 * 真正的拉霸玩法：
 * - 7×7 網格，中間 5×5 永遠是黑色隱藏格
 * - 只有外圈 36 格會亮燈、旋轉、最終停下
 * - 旋轉時：路徑沿外圈循環前進，一次亮一格
 * - 停下時：依序一個一個停在最終符號
 */

// ── Config ──────────────────────────────────────────────────────
const GRID_SIZE = 7;
const INITIAL_COINS = 10;
const COIN_TO_GOLD = 1;

const SYMBOLS = ['🍊', '🍎', '🍋', '🍉', '🔔', '⭐', '77', 'BAR'];
const RATES = { '🍊': 5, '🍎': 5, '🍋': 15, '🍉': 20, '🔔': 20, '⭐': 30, '77': 40, 'BAR': 100 };

// 外圈 36 格的位置（按順時針順序）
// 定義外圈格子的行列座標
const OUTER_CELLS = [
  // Top row: (0,0) to (0,6)
  [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
  // Right column: (1,6) to (5,6) [skip (0,6) already done]
  [1,6],[2,6],[3,6],[4,6],[5,6],
  // Bottom row: (6,5) to (6,0) [skip (6,6) already done from right column]
  [6,5],[6,4],[6,3],[6,2],[6,1],[6,0],
  // Left column: (5,0) to (1,0) [skip (0,0) already done]
  [5,0],[4,0],[3,0],[2,0],[1,0],
];

// ONCEMORE 位置（在外圈上）
const ONCEMORE_CELLS = [[3,0], [3,6]];
// 88 是特殊格（只有一個在 row3 col3 的對角）
// BAR 最高獎勵

// ── State ──────────────────────────────────────────────────────
let grid = [];           // 7x7 grid
let coins = INITIAL_COINS;
let bet = 1;
let isSpinning = false;
let currentWin = 0;

// 外圈目前"亮燈"的位置索引（0-35）
let litIndex = -1;
// 每個外圈格子的最終符號
let outerFinalSymbols = []; // 36 elements
// 每個外圈格子的目前顯示符號（用於旋轉動畫）
let outerDisplaySymbols = []; // 36 elements
// 外圈是否已經"停止"（已停在最終符號）
let outerStopped = []; // 36 booleans

// ── DOM ─────────────────────────────────────────────────────────
const $grid = document.getElementById('grid');
const $coinsVal = document.getElementById('coins-val');
const $winVal = document.getElementById('win-val');
const $msg = document.getElementById('message');
const $spinBtn = document.getElementById('btn-spin');
const $claimBtn = document.getElementById('btn-claim');
const $scorePopup = document.getElementById('score-popup');
const $resultCoins = document.getElementById('result-coins');
const $resultGold = document.getElementById('result-gold');

// ── Telegram SDK ────────────────────────────────────────────────
const tg = window.Telegram?.GameAPI;
const isTelegram = !!tg;

// ── Init ────────────────────────────────────────────────────────
function initGrid() {
  grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    grid[r] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      grid[r][c] = null;
    }
  }

  // 填外圈（36格）
  for (let c = 0; c < GRID_SIZE; c++) {
    grid[0][c] = randomSymbol();
    grid[6][c] = randomSymbol();
  }
  for (let r = 1; r < 6; r++) {
    grid[r][0] = randomSymbol();
    grid[r][6] = randomSymbol();
  }

  // ONCEMORE
  grid[3][0] = 'ONCEMORE';
  grid[3][6] = 'ONCEMORE';

  // 中間 5×5 維持 null（黑色）
}

function randomSymbol() {
  const weights = [20, 20, 10, 8, 8, 6, 4, 4];
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return SYMBOLS[i];
  }
  return SYMBOLS[0];
}

function isOuterCell(r, c) {
  return r === 0 || r === 6 || c === 0 || c === 6;
}

function isOncemoreCell(r, c) {
  return (r === 3 && c === 0) || (r === 3 && c === 6);
}

function renderGrid() {
  $grid.innerHTML = '';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `cell-${r}-${c}`;

      if (isOuterCell(r, c)) {
        // 外圈格子
        const idx = OUTER_CELLS.findIndex(([rr, cc]) => rr === r && cc === c);
        cell.classList.add('outer');

        const dot = document.createElement('div');
        dot.className = 'led-dot';
        cell.appendChild(dot);

        const inner = document.createElement('div');
        inner.className = 'cell-text';
        inner.id = `symbol-${idx}`;
        cell.appendChild(inner);

        const val = grid[r][c];
        if (val === 'ONCEMORE') {
          inner.innerHTML = 'ONCE<br>MORE';
          cell.classList.add('once-more');
          dot.style.background = '#ff4444';
          dot.style.boxShadow = '0 0 5px #ff4444';
        } else {
          inner.textContent = val;
        }
      } else {
        // 中間 5×5 — 永遠黑色
        cell.classList.add('inner-dark');
        const inner = document.createElement('div');
        inner.className = 'cell-text';
        inner.textContent = '';
        cell.appendChild(inner);
      }

      $grid.appendChild(cell);
    }
  }
}

function updateLEDs() {
  $coinsVal.textContent = String(coins).padStart(5, '0');
  $winVal.textContent = String(currentWin).padStart(5, '0');
}

// ── Spin ────────────────────────────────────────────────────────
async function spin() {
  if (isSpinning) return;
  if (coins < bet) {
    showMsg('金幣不足！', 'error');
    return;
  }

  coins -= bet;
  currentWin = 0;
  isSpinning = true;
  $spinBtn.disabled = true;
  showMsg('旋轉中…', '');

  // 重置外圈狀態
  outerFinalSymbols = [];
  outerDisplaySymbols = [];
  outerStopped = [];
  litIndex = -1;

  // 預先生成所有外圈格子的最終符號
  for (let i = 0; i < OUTER_CELLS.length; i++) {
    const [r, c] = OUTER_CELLS[i];
    const val = grid[r][c];
    outerFinalSymbols.push(val === 'ONCEMORE' ? 'ONCEMORE' : (typeof val === 'object' ? val.symbol : val));
    outerDisplaySymbols.push(SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)]);
    outerStopped.push(false);
  }

  // 清除所有外圈格子的高亮
  document.querySelectorAll('.cell.outer').forEach(el => {
    el.classList.remove('lit', 'hit', 'win-cell');
  });

  updateLEDs();

  // ── PHASE 1: 旋轉燈光沿外圈前進 ──
  // 模擬指針沿外圈走，先快速走好幾圈（建立期待感）
  const TOTAL_SPIN_STEPS = 60 + Math.floor(Math.random() * 30); // 60-90步
  const LIGHT_INTERVAL = Math.floor(TOTAL_SPIN_STEPS / 36); // 每格停留多少步

  for (let step = 0; step < TOTAL_SPIN_STEPS; step++) {
    // 清除上一個亮的
    if (litIndex >= 0) {
      const prev = document.getElementById(`symbol-${litIndex}`);
      if (prev) prev.textContent = outerDisplaySymbols[litIndex];
      const prevCell = OUTER_CELLS[litIndex];
      const prevEl = document.getElementById(`cell-${prevCell[0]}-${prevCell[1]}`);
      if (prevEl) prevEl.classList.remove('lit');
    }

    // 移動到下一格
    litIndex = step % 36;
    const [r, c] = OUTER_CELLS[litIndex];
    const el = document.getElementById(`cell-${r}-${c}`);

    if (el) {
      el.classList.add('lit');
      const sym = document.getElementById(`symbol-${litIndex}`);
      if (sym) sym.textContent = outerDisplaySymbols[litIndex];
    }

    // 速度：前60%很快，後40%越來越慢（ease-out）
    let delay;
    if (step < TOTAL_SPIN_STEPS * 0.6) {
      delay = 40;
    } else {
      const ratio = (step - TOTAL_SPIN_STEPS * 0.6) / (TOTAL_SPIN_STEPS * 0.4);
      delay = 40 + ratio * 120; // 40ms → 160ms
    }

    await delay(delay);
  }

  // 清除最後一個亮的
  if (litIndex >= 0) {
    const prevCell = OUTER_CELLS[litIndex];
    const prevEl = document.getElementById(`cell-${prevCell[0]}-${prevCell[1]}`);
    if (prevEl) prevEl.classList.remove('lit');
    litIndex = -1;
  }

  // ── PHASE 2: 一格一格停在最終符號 ──
  // 從某個位置開始順時針依序停止
  // 先決定"針停在哪一格"，那一格最後停
  const needleStopIndex = Math.floor(Math.random() * 36);
  const revealOrder = [];
  for (let i = 0; i < 36; i++) {
    revealOrder.push((needleStopIndex + 1 + i) % 36);
  }

  for (let i = 0; i < revealOrder.length; i++) {
    const idx = revealOrder[i];
    outerStopped[idx] = true;

    const [r, c] = OUTER_CELLS[idx];
    const el = document.getElementById(`cell-${r}-${c}`);
    if (!el) continue;

    // 停在最終符號
    el.classList.remove('lit');
    el.classList.add('hit');

    const sym = document.getElementById(`symbol-${idx}`);
    if (sym) {
      sym.textContent = outerFinalSymbols[idx];
      if (outerFinalSymbols[idx] === 'ONCEMORE') {
        sym.innerHTML = 'ONCE<br>MORE';
        el.classList.add('once-more');
        const dot = el.querySelector('.led-dot');
        if (dot) { dot.style.background = '#ff4444'; dot.style.boxShadow = '0 0 5px #ff4444'; }
      }
    }

    // 計算目前贏了多少
    const partial = calculateWinPartial();
    currentWin = partial;
    updateLEDs();

    // 如果遇到 ONCEMORE
    if (outerFinalSymbols[idx] === 'ONCEMORE') {
      await delay(300);
      showMsg('🎉 ONCE MORE! 再轉一次！', 'onemore');
      await delay(1000);
      // 全部清除，重新旋轉
      document.querySelectorAll('.cell.outer').forEach(e => {
        e.classList.remove('hit', 'lit', 'once-more');
      });
      await spin();
      return;
    }

    // 每格之間稍微停一下
    const stopDelay = i >= revealOrder.length - 3 ? 150 : 60;
    await delay(stopDelay);
  }

  // 全部停止，結算
  await delay(300);
  currentWin = calculateWinPartial();
  updateLEDs();

  if (currentWin > 0) {
    showMsg(`🎊 恭喜中獎！贏得 ${currentWin} 拉霸幣！`, 'big-win');
    highlightWinCells();
  } else {
    showMsg('沒有中獎，再接再厲！', '');
  }

  await delay(1500);
  isSpinning = false;
  $spinBtn.disabled = false;

  if (currentWin > 0) {
    $claimBtn.style.display = 'inline-block';
  }
}

// ── Win calculation ──────────────────────────────────────────────
function calculateWinPartial() {
  let win = 0;

  // 把外圈final symbols轉成grid
  for (let i = 0; i < OUTER_CELLS.length; i++) {
    if (!outerStopped[i]) return 0; // 未全部停止，不計算
    const [r, c] = OUTER_CELLS[i];
    const sym = outerFinalSymbols[i];
    if (sym === 'ONCEMORE') return 0;
    grid[r][c] = sym;
  }

  // 檢查所有外圈橫行（7格一排，共7排）
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push(grid[r][c]);
    }
    win += checkLineWin(row);
  }

  // 檢查所有外圈直行
  for (let c = 0; c < GRID_SIZE; c++) {
    const col = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      col.push(grid[r][c]);
    }
    win += checkLineWin(col);
  }

  return win;
}

function checkLineWin(line) {
  // 必須全部相同且不是 ONCEMORE
  if (!line[0] || line[0] === 'ONCEMORE') return 0;
  if (!line.every(s => s === line[0])) return 0;
  const rate = RATES[line[0]] || 5;
  return rate * 5; // 7個相同 × 倍率
}

function highlightWinCells() {
  // 找出所有中獎的格子並高亮
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push(grid[r][c]);
    }
    if (row[0] && row[0] !== 'ONCEMORE' && row.every(s => s === row[0])) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const el = document.getElementById(`cell-${r}-${c}`);
        if (el) el.classList.add('win-cell');
      }
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────
function showMsg(text, cls) {
  $msg.textContent = text;
  $msg.className = 'message' + (cls ? ' ' + cls : '');
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Claim ───────────────────────────────────────────────────────
async function claimCoins() {
  if (currentWin <= 0) return;

  const slotCoins = currentWin;
  const goldCoins = Math.floor(slotCoins / 10);

  $resultCoins.textContent = `${slotCoins} 拉霸幣`;
  $resultGold.textContent = `${goldCoins} StudyQuest 金幣 ✨`;
  $scorePopup.classList.add('show');

  if (isTelegram) {
    try {
      tg.sendData(JSON.stringify({ coins: slotCoins, gold: goldCoins }));
      await delay(500);
    } catch (e) {
      console.warn('sendData failed:', e);
    }
  } else {
    await delay(3000);
    $scorePopup.classList.remove('show');
    resetGame();
  }
}

function resetGame() {
  coins = INITIAL_COINS;
  currentWin = 0;
  initGrid();
  renderGrid();
  updateLEDs();
  $claimBtn.style.display = 'none';
  showMsg('投入金幣，開始遊戲！', '');
}

// ── Events ─────────────────────────────────────────────────────
$spinBtn.addEventListener('click', spin);
$claimBtn.addEventListener('click', claimCoins);

document.getElementById('btn-ok').addEventListener('click', () => {
  $scorePopup.classList.remove('show');
  resetGame();
});

// ── Boot ───────────────────────────────────────────────────────
resetGame();
