/*
  app.js
  ------
  Handles everything game-core.js doesn't: the username screen, assigning
  the participant to a UI condition, rendering the two UI variants, and
  sending session data to Google Sheets before redirecting to the exit
  survey.
*/

// ---- Configuration -------------------------------------------------------

const WEBAPP_URL = "https://script.google.com/macros/s/AKfycbzmElShQEjYlW6zC53SqCrbvzyfGUVqRc-U40jcwDUOA92RCzoH_cMDH_Iz7Vd-iu7-Yg/exec";
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLSc2-jL51ym2ULbT3LTmIY8GJyIP6DEtHGvJ8CyG5SSPCsSsKg/viewform?usp=header";

// ---- Screen helpers --------------------------------------------------

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

// ---- UI condition assignment -----------------------------------------

// Always assign to minimal UI
async function assignUIType(username) {
  return "minimal";
}

// ---- Data submission ----------------------------------------------------

function buildPayload(username, uiType, state) {
  return {
    playerID: username,
    score: state.score,
    timePlayed: state.timePlayed,
    uiType: uiType,
    errorCount: state.errorCount,
  };
}

function sendSessionData(payload) {
  // text/plain avoids a CORS preflight request, which Apps Script web apps
  // do not handle; the Apps Script side still JSON.parses the body fine.
  return fetch(WEBAPP_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
}

// ---- UI templates ---------------------------------------------------

function renderMinimalUI() {
  document.getElementById("game-screen").innerHTML = `
    <div class="hud hud-minimal">
      <span class="hud-item">Score: <strong id="score-value">0</strong></span>
      <span class="hud-item">Moves: <strong id="moves-value">20</strong></span>
    </div>
    <div id="board" class="board board-minimal"></div>
  `;
}

function renderComplexUI() {
  document.getElementById("game-screen").innerHTML = `
    <div class="top-bar">
      <div class="logo">🍉 Fruit Match <span class="logo-accent">Deluxe</span></div>
      <button class="settings-icon" id="settings-btn" aria-label="Settings">⚙️</button>
    </div>
    <div class="ad-banner">✨ Sponsored: Unlock Fruit Match Deluxe Premium — Go Ad-Free! ✨</div>
    <div class="hud hud-complex">
      <div class="stat-card">
        <span class="stat-label">Score</span>
        <span id="score-value" class="stat-value">0</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Moves</span>
        <span id="moves-value" class="stat-value">20</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">Mistakes</span>
        <span id="error-value" class="stat-value">0</span>
      </div>
    </div>
    <div class="progress-bar-wrap"><div id="progress-bar" class="progress-bar"></div></div>
    <div id="board" class="board board-complex"></div>
    <div id="combo-toast" class="combo-toast"></div>

    <div id="settings-modal" class="settings-modal">
      <div class="settings-modal-card">
        <h3>Settings</h3>
        <label class="toggle-row"><span>Sound Effects</span><input type="checkbox" checked /></label>
        <label class="toggle-row"><span>Background Music</span><input type="checkbox" /></label>
        <label class="toggle-row"><span>Vibration</span><input type="checkbox" checked /></label>
        <button id="close-settings-btn">Close</button>
      </div>
    </div>
  `;

  document.getElementById("settings-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.add("open");
  });
  document.getElementById("close-settings-btn").addEventListener("click", () => {
    document.getElementById("settings-modal").classList.remove("open");
  });
}

// ---- Board rendering (shared markup, used by both conditions) -----------

function renderBoard(state, dims) {
  const board = document.getElementById("board");
  if (!board) return;
  board.style.gridTemplateColumns = `repeat(${dims.cols}, 1fr)`;
  board.innerHTML = "";
  state.grid.forEach((value, idx) => {
    const tile = document.createElement("div");
    tile.className = "tile";
    if (state.selected === idx) tile.classList.add("selected");
    tile.dataset.index = idx;
    tile.textContent = Game.getEmoji(value);
    tile.addEventListener("click", () => handleTileClick(idx));
    board.appendChild(tile);
  });
}

function handleTileClick(idx) {
  const state = Game.getState();
  if (!state || state.ended) return;

  if (state.selected === null) {
    state.selected = idx;
    renderBoard(state, Game.getDimensions());
    return;
  }
  if (state.selected === idx) {
    state.selected = null;
    renderBoard(state, Game.getDimensions());
    return;
  }
  if (!Game.isAdjacent(state.selected, idx)) {
    // Not adjacent: treat as picking a new tile, not a failed swap attempt.
    state.selected = idx;
    renderBoard(state, Game.getDimensions());
    return;
  }

  const prevSelected = state.selected;
  state.selected = null;
  Game.attemptSwap(prevSelected, idx);
}

// ---- Update hooks passed into Game.init() -------------------------------

function onUpdate(state) {
  renderBoard(state, Game.getDimensions());

  const scoreEl = document.getElementById("score-value");
  const movesEl = document.getElementById("moves-value");
  const errorEl = document.getElementById("error-value");
  const progressEl = document.getElementById("progress-bar");

  if (scoreEl) scoreEl.textContent = state.score;
  if (movesEl) movesEl.textContent = state.movesLeft;
  if (errorEl) errorEl.textContent = state.errorCount;
  if (progressEl) {
    const pct = ((state.totalMoves - state.movesLeft) / state.totalMoves) * 100;
    progressEl.style.width = `${pct}%`;
  }
}

function onCascade({ comboCount, points }) {
  const toast = document.getElementById("combo-toast");
  if (!toast) return; // minimal UI has no toast element, and that's fine
  toast.textContent = comboCount > 1 ? `Combo x${comboCount}! +${points}` : `+${points}`;
  toast.classList.remove("show");
  // Force reflow so the animation restarts on rapid consecutive combos.
  void toast.offsetWidth;
  toast.classList.add("show");
}

function onGameEnd(state, username, uiType) {
  showScreen("end-screen");
  document.getElementById("end-title").textContent = `Nice work, ${username}!`;
  document.getElementById("end-message").textContent = "Saving your results…";

  const payload = buildPayload(username, uiType, state);

  sendSessionData(payload)
    .catch((err) => console.error("Failed to log session data:", err))
    .finally(() => {
      window.location.href = FORM_URL;
    });
}

// ---- Game start -----------------------------------------------------

function startGame(username, uiType) {
  showScreen("game-screen");
  document.body.className = uiType === "complex" ? "ui-complex" : "ui-minimal";

  if (uiType === "complex") {
    renderComplexUI();
  } else {
    renderMinimalUI();
  }

  Game.init({
    onUpdate,
    onCascade,
    onGameEnd: (state) => onGameEnd(state, username, uiType),
  });
}

// ---- Username screen wiring ----------------------------------------

async function handleStart() {
  const input = document.getElementById("username-input");
  const errorEl = document.getElementById("username-error");
  const startBtn = document.getElementById("start-btn");
  const username = input.value.trim();

  if (!username) {
    errorEl.textContent = "Please enter a username.";
    return;
  }

  errorEl.textContent = "";
  startBtn.disabled = true;
  startBtn.textContent = "Loading…";

  const uiType = await assignUIType(username);
  startGame(username, uiType);
}

document.getElementById("start-btn").addEventListener("click", handleStart);
document.getElementById("username-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleStart();
});
