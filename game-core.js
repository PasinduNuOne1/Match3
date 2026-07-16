/*
  game-core.js
  ------------
  Pure game logic for the match-3 session. This file is identical for both
  UI conditions (minimal and complex) — it never touches the DOM. All
  rendering happens in app.js via the hooks passed to Game.init(). Keeping
  the mechanics in one shared module guarantees that UI-A and UI-B only
  differ in presentation, never in gameplay.
*/

const Game = (function () {
  const ROWS = 8;
  const COLS = 8;
  const TILE_TYPES = 6;
  const TOTAL_MOVES = 20; // fixed per session so score/time are comparable across participants
  const TILE_EMOJI = ["🍎", "🍋", "🍇", "🍊", "🍓", "🫐"];

  let state = null;
  let hooks = { onUpdate: () => {}, onCascade: () => {}, onGameEnd: () => {} };

  function findMatches(grid, rows, cols) {
    const matched = new Set();

    // Horizontal runs
    for (let r = 0; r < rows; r++) {
      let runStart = 0;
      for (let c = 1; c <= cols; c++) {
        const prevVal = grid[r * cols + (c - 1)];
        const curVal = c < cols ? grid[r * cols + c] : null;
        if (curVal !== prevVal || c === cols) {
          if (c - runStart >= 3) {
            for (let k = runStart; k < c; k++) matched.add(r * cols + k);
          }
          runStart = c;
        }
      }
    }

    // Vertical runs
    for (let c = 0; c < cols; c++) {
      let runStart = 0;
      for (let r = 1; r <= rows; r++) {
        const prevVal = grid[(r - 1) * cols + c];
        const curVal = r < rows ? grid[r * cols + c] : null;
        if (curVal !== prevVal || r === rows) {
          if (r - runStart >= 3) {
            for (let k = runStart; k < r; k++) matched.add(k * cols + c);
          }
          runStart = r;
        }
      }
    }

    return matched;
  }

  function applyGravityAndRefill(grid, rows, cols, tileTypes) {
    for (let c = 0; c < cols; c++) {
      let writeRow = rows - 1;
      for (let r = rows - 1; r >= 0; r--) {
        const idx = r * cols + c;
        if (grid[idx] !== null) {
          grid[writeRow * cols + c] = grid[idx];
          if (writeRow !== r) grid[idx] = null;
          writeRow--;
        }
      }
      for (let r = writeRow; r >= 0; r--) {
        grid[r * cols + c] = Math.floor(Math.random() * tileTypes);
      }
    }
  }

  function isAdjacent(a, b) {
    const ra = Math.floor(a / COLS), ca = a % COLS;
    const rb = Math.floor(b / COLS), cb = b % COLS;
    return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
  }

  function hasPossibleMove(grid, rows, cols) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (c < cols - 1) {
          const test = grid.slice();
          [test[idx], test[idx + 1]] = [test[idx + 1], test[idx]];
          if (findMatches(test, rows, cols).size > 0) return true;
        }
        if (r < rows - 1) {
          const idx2 = idx + cols;
          const test = grid.slice();
          [test[idx], test[idx2]] = [test[idx2], test[idx]];
          if (findMatches(test, rows, cols).size > 0) return true;
        }
      }
    }
    return false;
  }

  function createBoard(rows, cols, tileTypes) {
    let grid;
    do {
      grid = new Array(rows * cols).fill(null);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          let value;
          do {
            value = Math.floor(Math.random() * tileTypes);
          } while (
            (c >= 2 && grid[r * cols + c - 1] === value && grid[r * cols + c - 2] === value) ||
            (r >= 2 && grid[(r - 1) * cols + c] === value && grid[(r - 2) * cols + c] === value)
          );
          grid[r * cols + c] = value;
        }
      }
    } while (!hasPossibleMove(grid, rows, cols));
    return grid;
  }

  function resolveMatches(initialMatched) {
    let matched = initialMatched;
    let comboCount = 0;
    while (matched.size > 0) {
      comboCount++;
      const points = matched.size * 10 * comboCount; // chain reactions score progressively more
      state.score += points;
      matched.forEach((idx) => { state.grid[idx] = null; });
      applyGravityAndRefill(state.grid, ROWS, COLS, TILE_TYPES);
      matched = findMatches(state.grid, ROWS, COLS);
      hooks.onCascade({ comboCount, points, totalScore: state.score });
    }
    if (!hasPossibleMove(state.grid, ROWS, COLS)) {
      state.grid = createBoard(ROWS, COLS, TILE_TYPES);
    }
  }

  function init(customHooks) {
    hooks = Object.assign({ onUpdate: () => {}, onCascade: () => {}, onGameEnd: () => {} }, customHooks || {});
    state = {
      grid: createBoard(ROWS, COLS, TILE_TYPES),
      score: 0,
      movesLeft: TOTAL_MOVES,
      totalMoves: TOTAL_MOVES,
      errorCount: 0,
      selected: null,
      startTime: Date.now(),
      timePlayed: null,
      ended: false,
    };
    hooks.onUpdate(state);
    return state;
  }

  function attemptSwap(a, b) {
    if (!state || state.ended) return;
    if (!isAdjacent(a, b)) return;

    [state.grid[a], state.grid[b]] = [state.grid[b], state.grid[a]];
    const matched = findMatches(state.grid, ROWS, COLS);

    if (matched.size === 0) {
      // Invalid move: revert the swap and count it as an error.
      [state.grid[a], state.grid[b]] = [state.grid[b], state.grid[a]];
      state.errorCount++;
      hooks.onUpdate(state);
      return;
    }

    state.movesLeft--;
    resolveMatches(matched);
    hooks.onUpdate(state);

    if (state.movesLeft <= 0) {
      endGame();
    }
  }

  function endGame() {
    if (!state || state.ended) return;
    state.ended = true;
    state.timePlayed = Math.round((Date.now() - state.startTime) / 100) / 10; // seconds, 1 decimal
    hooks.onGameEnd(state);
  }

  return {
    init,
    attemptSwap,
    isAdjacent,
    getState: () => state,
    getDimensions: () => ({ rows: ROWS, cols: COLS }),
    getEmoji: (value) => TILE_EMOJI[value],
  };
})();
