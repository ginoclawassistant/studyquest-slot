/**
 * StudyQuest 小瑪莉 - HTML5 Game
 * Telegram Game API compatible
 * 
 * Game flow:
 * 1. User arrives via Telegram sendGame
 * 2. Telegram SDK: window.Telegram.GameAPI.available()
 * 3. User clicks SPIN
 * 4. Each cell cycles rapidly then lands on final symbol
 * 5. Score calculated from paylines + multipliers
 * 6. sendData(score) back to Telegram → Bot receives callback with score
 */

// ── Config ──────────────────────────────────────────────────────
const GRID_SIZE = 7;
const INITIAL_COINS = 10; // 10 slot coins per play (from answering all correctly)
const COIN_TO_GOLD = 1;   // 10 slot coins → 1 StudyQuest gold

// Symbol table
const SYMBOLS = ['🍊', '🍎', '🍋', '🍉', '🔔', '⭐', '77', 'BAR'];
const RATES = { '🍊': 5, '🍎': 5, '🍋': 15, '🍉': 20, '🔔': 20, '⭐': 30, '77': 40, 'BAR': 100 };

// Fixed cells: positions that are always visible (border of 7x7)
const FIXED_CELLS = [
  // Row 0 (top border, cols 0-6)
  [0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],
  // Row 6 (bottom border, cols 0-6)
  [6,0],[6,1],[6,2],[6,3],[6,4],[6,5],[6,4],
  // Col 0 (left border, rows 1-5)
  [1,0],[2,0],[3,0],[4,0],[5,0],
  // Col 6 (right border, rows 1-5)
  [1,6],[2,6],[3,6],[4,6],[5,6],
];

// ONCEMORE positions (always visible, special)
const ONCEMORE_CELLS = [[3,0], [3,6]];

// Multiplier cells: always visible, have X multiplier
const MULTIPLIER_CELLS = [
  [0,2,50],[0,4,25],
  [1,0,2],[1,6,2],
  [4,0,2],[5,6,2],[6,3,2],[6,4,2],[1,4,2],[5,3,2],
];

// ── State ──────────────────────────────────────────────────────
let grid = [];           // 7x7, null = hidden, object = visible
let coins = INITIAL_COINS;
let bet = 1;
let isSpinning = false;
let revealedCells = new Set(); // "r_c" strings
let revealedOrder = [];       // [[r,c], ...] in order of reveal
let currentWin = 0;

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

if (isTelegram) {
  document.getElementById('header-title').textContent = '🎰 StudyQuest 小瑪莉';
}

// ── Init ────────────────────────────────────────────────────────
function initGrid() {
  grid = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    grid[r] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      grid[r][c] = null;
    }
  }

  // Fill fixed border cells
  for (let c = 0; c < GRID_SIZE; c++) {
    grid[0][c] = randomSymbol();
    grid[6][c] = randomSymbol();
  }
  for (let r = 1; r < 6; r++) {
    grid[r][0] = randomSymbol();
    grid[r][6] = randomSymbol();
  }

  // ONCEMORE cells
  grid[3][0] = 'ONCEMORE';
  grid[3][6] = 'ONCEMORE';

  // Multiplier cells
  for (const [r, c, mult] of MULTIPLIER_CELLS) {
    if (!grid[r][c]) {
      grid[r][c] = { symbol: randomSymbol(), multiplier: mult };
    }
  }
}

function randomSymbol() {
  // Weighted: lower symbols more common
  const weights = [20, 20, 10, 8, 8, 6, 4, 4]; // 🍊🍎🍋🍉🔔⭐77BAR
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return SYMBOLS[i];
  }
  return SYMBOLS[0];
}

function renderGrid() {
  $grid.innerHTML = '';
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.id = `cell-${r}-${c}`;

      const key = `${r}_${c}`;
      const isRevealed = revealedCells.has(key);
      const value = grid[r][c];

      if (!isRevealed) {
        cell.classList.add('hidden');
        // Show a spinning placeholder for hidden cells
        const inner = document.createElement('div');
        inner.className = 'cell-text spinning-symbol';
        inner.textContent = '🍋';
        cell.appendChild(inner);
      } else {
        cell.classList.add('revealed');

        const dot = document.createElement('div');
        dot.className = 'led-dot';
        cell.appendChild(dot);

        const inner = document.createElement('div');
        inner.className = 'cell-text';
        cell.appendChild(inner);

        if (value === 'ONCEMORE') {
          inner.innerHTML = 'ONCE<br>MORE';
          cell.classList.add('once-more');
          const extra = document.createElement('div');
          extra.className = 'cell-extra';
          cell.appendChild(extra);
        } else if (value && typeof value === 'object' && value.multiplier) {
          inner.textContent = value.symbol;
          const extra = document.createElement('div');
          extra.className = 'cell-extra';
          extra.textContent = `×${value.multiplier}`;
          cell.appendChild(extra);
        } else {
          inner.textContent = value;
        }
      }

      $grid.appendChild(cell);
    }
  }
}

function updateLEDs() {
  $coinsVal.textContent = String(coins).padStart(5, '0');
  $winVal.textContent = String(currentWin).padStart(5, '0');
}

// ── Reveal logic (arcade style) ─────────────────────────────────
function buildRevealOrder() {
  revealedOrder = [];
  const rowOrder = [3, 2, 4, 1, 5, 0, 6];

  for (const r of rowOrder) {
    const cols = r % 2 === 0
      ? [0,6, 1,5, 2,4, 3]
      : [6,0, 5,1, 4,2, 3];

    for (const c of cols) {
      const key = `${r}_${c}`;
      if (isFixedCell(r, c)) continue;
      revealedOrder.push([r, c]);
    }
  }
}

function isFixedCell(r, c) {
  return r === 0 || r === 6 || c === 0 || c === 6;
}

function isSpecialCell(r, c) {
  const key = `${r}_${c}`;
  return key === '3_0' || key === '3_6';
}

function isMultiplierCell(r, c) {
  return MULTIPLIER_CELLS.some(([mr, mc]) => mr === r && mc === c);
}

// ── Spin logic ──────────────────────────────────────────────────

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

  // Reset hidden cells for new round
  revealedCells.clear();
  for (let r = 1; r < 6; r++) {
    for (let c = 1; c < 6; c++) {
      if (!isSpecialCell(r, c) && !isMultiplierCell(r, c)) {
        grid[r][c] = randomSymbol();
      } else if (isMultiplierCell(r, c)) {
        const mult = MULTIPLIER_CELLS.find(([mr, mc]) => mr === r && mc === c)[2];
        grid[r][c] = { symbol: randomSymbol(), multiplier: mult };
      } else {
        grid[r][c] = 'ONCEMORE';
      }
    }
  }

  buildRevealOrder();
  updateLEDs();

  // ── PHASE 1: Start ALL inner cells spinning (rapid cycling) ──
  // Pre-fill all inner cells with random spinning symbols
  for (let r = 1; r < 6; r++) {
    for (let c = 1; c < 6; c++) {
      const el = document.getElementById(`cell-${r}-${c}`);
      if (!el) continue;
      el.classList.remove('hidden');
      el.classList.add('spinning');

      // Set initial spinning symbol
      let inner = el.querySelector('.cell-text');
      if (!inner) {
        inner = document.createElement('div');
        inner.className = 'cell-text spinning-symbol';
        el.appendChild(inner);
      } else {
        inner.className = 'cell-text spinning-symbol';
      }
      inner.textContent = randomSymbol();
    }
  }

  // ── PHASE 2: Stop cells one by one in reveal order ──
  let onemoreTriggered = false;
  let spinAgain = false;

  for (let i = 0; i < revealedOrder.length; i++) {
    const [r, c] = revealedOrder[i];
    const key = `${r}_${c}`;
    const el = document.getElementById(`cell-${r}-${c}`);
    if (!el) continue;

    // Spin this cell for a while before stopping
    // More steps for cells revealed earlier in the order
    const spinSteps = Math.max(8, 20 - Math.floor(i * 0.5));
    const baseDelay = 60;

    for (let step = 0; step < spinSteps; step++) {
      const inner = el.querySelector('.cell-text');
      if (inner) inner.textContent = randomSymbol();
      // Ease out: delay increases as we approach the final step
      const easedDelay = baseDelay + Math.floor((step / spinSteps) * baseDelay * 3);
      await delay(easedDelay);

      // If this cell is ONCEMORE, stop early
      if (grid[r][c] === 'ONCEMORE') break;
    }

    // Final symbol - stop on the predetermined result
    revealedCells.add(key);
    el.classList.remove('spinning');
    el.classList.add('revealed');

    const inner = el.querySelector('.cell-text');
    if (!inner) {
      const innerNew = document.createElement('div');
      innerNew.className = 'cell-text';
      el.appendChild(innerNew);
    } else {
      inner.className = 'cell-text';
    }

    const val = grid[r][c];
    if (val === 'ONCEMORE') {
      inner.innerHTML = 'ONCE<br>MORE';
      el.classList.add('once-more');
      el.querySelector('.led-dot').style.background = '#ff4444';
      el.querySelector('.led-dot').style.boxShadow = '0 0 5px #ff4444';
    } else if (val && typeof val === 'object' && val.multiplier) {
      inner.textContent = val.symbol;
      let extra = el.querySelector('.cell-extra');
      if (!extra) {
        extra = document.createElement('div');
        extra.className = 'cell-extra';
        el.appendChild(extra);
      }
      extra.textContent = `×${val.multiplier}`;
    } else {
      inner.textContent = val;
    }

    el.classList.add('hit');

    // Calculate partial win after each reveal
    const partial = calculateWinPartial();
    updateLEDs();

    // Check for ONCEMORE
    if (val === 'ONCEMORE' && !onemoreTriggered) {
      onemoreTriggered = true;
      await delay(200);
      showMsg('🎉 ONCE MORE! 再轉一次！', 'onemore');
      await delay(800);
      spinAgain = true;
      break;
    }

    // Small pause between reveals (except after hit flash)
    if (i > 0) {
      const [pr, pc] = revealedOrder[i - 1];
      const prevEl = document.getElementById(`cell-${pr}-${pc}`);
      if (prevEl) prevEl.classList.remove('hit');
    }
  }

  // If didn't trigger ONCEMORE, calculate final win
  if (!onemoreTriggered) {
    await delay(300);
    const multiplier = calculateMultiplier();
    currentWin = calculateWinPartial() * multiplier;
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
  } else {
    // ONCEMORE triggered — spin again
    await delay(600);
    isSpinning = false;
    $spinBtn.disabled = false;
  }
}

// ── Win calculation ──────────────────────────────────────────────
function calculateWinPartial() {
  let win = 0;

  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const key = `${r}_${c}`;
      if (!revealedCells.has(key)) return 0;
      const val = grid[r][c];
      if (val === 'ONCEMORE') return 0;
      row.push(typeof val === 'object' ? val.symbol : val);
    }
    win += checkLineWin(row);
  }

  // Also check columns
  for (let c = 0; c < GRID_SIZE; c++) {
    const col = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const key = `${r}_${c}`;
      if (!revealedCells.has(key)) return 0;
      const val = grid[r][c];
      if (val === 'ONCEMORE') return 0;
      col.push(typeof val === 'object' ? val.symbol : val);
    }
    win += checkLineWin(col);
  }

  return win;
}

function checkLineWin(line) {
  // Count consecutive symbols from left
  let maxCount = 1;
  let current = line[0];
  let count = 1;

  for (let i = 1; i < line.length; i++) {
    if (line[i] === current) {
      count++;
      maxCount = Math.max(maxCount, count);
    } else {
      current = line[i];
      count = 1;
    }
  }

  if (maxCount < 3) return 0;

  // All symbols in line must be the same
  if (!line.every(s => s === line[0])) return 0;

  const sym = line[0];
  const rate = RATES[sym] || 5;
  return rate * (maxCount - 2);
}

function calculateMultiplier() {
  let mult = 1;
  for (const [r, c, m] of MULTIPLIER_CELLS) {
    if (revealedCells.has(`${r}_${c}`)) {
      mult *= m;
    }
  }
  return mult;
}

function highlightWinCells() {
  // Highlight winning lines
  const lines = [];

  // Rows
  for (let r = 0; r < GRID_SIZE; r++) {
    const row = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      const val = grid[r][c];
      row.push(typeof val === 'object' ? val.symbol : val);
    }
    if (row.every(s => s === row[0]) && row[0]) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const el = document.getElementById(`cell-${r}-${c}`);
        if (el) el.classList.add('win-cell');
      }
    }
  }

  // Columns
  for (let c = 0; c < GRID_SIZE; c++) {
    const col = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      const val = grid[r][c];
      col.push(typeof val === 'object' ? val.symbol : val);
    }
    if (col.every(s => s === col[0]) && col[0]) {
      for (let r = 0; r < GRID_SIZE; r++) {
        const el = document.getElementById(`cell-${r}-${c}`);
        if (el) el.classList.add('win-cell');
      }
    }
  }
}

// ── Message ─────────────────────────────────────────────────────
function showMsg(text, cls) {
  $msg.textContent = text;
  $msg.className = 'message' + (cls ? ' ' + cls : '');
}

// ── Delay helper ─────────────────────────────────────────────────
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Claim & Telegram integration ─────────────────────────────────
async function claimCoins() {
  if (currentWin <= 0) return;

  const slotCoins = currentWin;
  const goldCoins = Math.floor(slotCoins / 10);

  $resultCoins.textContent = `${slotCoins} 拉霸幣`;
  $resultGold.textContent = `${goldCoins} StudyQuest 金幣 ✨`;
  $scorePopup.classList.add('show');

  if (isTelegram) {
    try {
      tg.sendData(JSON.stringify({
        coins: slotCoins,
        gold: goldCoins
      }));
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
  revealedCells.clear();
  initGrid();
  revealedCells = new Set();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (isFixedCell(r, c) || isSpecialCell(r, c)) {
        revealedCells.add(`${r}_${c}`);
      }
    }
  }
  buildRevealOrder();
  renderGrid();
  updateLEDs();
  $claimBtn.style.display = 'none';
  showMsg('投入金幣，開始遊戲！', '');
}

// ── Event listeners ─────────────────────────────────────────────
$spinBtn.addEventListener('click', spin);
$claimBtn.addEventListener('click', claimCoins);

document.getElementById('btn-ok').addEventListener('click', () => {
  $scorePopup.classList.remove('show');
  resetGame();
});

// ── Start ──────────────────────────────────────────────────────
resetGame();
