const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// SE設定
const audioPath = 'audio/';
const se = {
  ballShoot: new Audio(`${audioPath}se/se_ball_shoot.wav`),
  ballLand: new Audio(`${audioPath}se/se_ball_land.wav`),
  bombExplode: new Audio(`${audioPath}se/se_bomb_explode.wav`),
  rainbowLand: new Audio(`${audioPath}se/se_rainbow_land.wav`),
  rainbowSet: new Audio(`${audioPath}se/se_rainbow_set.wav`),
  blockFall: new Audio(`${audioPath}se/se_block_fall.wav`),
  gameOver: new Audio(`${audioPath}se/se_game_over.mp3`),
  stageClear: new Audio(`${audioPath}se/se_stage_clear.wav`)
};

let audioUnlocked = false;
function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  Object.values(se).forEach(sound => {
    sound.play().then(() => {
      sound.pause();
      sound.currentTime = 0;
    }).catch(() => {});
  });
}

function playSE(sound) {
  try {
    if (sound) {
      sound.currentTime = 0;
      let p = sound.play();
      if (p !== undefined) p.catch(() => {});
    }
  } catch(e) {}
}

const bgmList = [
  `${audioPath}bgm/bgm_play_01.mp3`,
  `${audioPath}bgm/bgm_play_03.mp3`,
  `${audioPath}bgm/bgm_play_04.mp3`
];
let currentBGM = null;

function playRandomBGM() {
  stopBGM();
  try {
    const randomIndex = Math.floor(Math.random() * bgmList.length);
    currentBGM = new Audio(bgmList[randomIndex]);
    currentBGM.loop = true;
    let p = currentBGM.play();
    if (p !== undefined) p.catch(() => {});
  } catch(e) {}
}

function stopBGM() {
  try {
    if (currentBGM) {
      currentBGM.pause();
      currentBGM.currentTime = 0;
      currentBGM = null;
    }
  } catch(e) {}
}

// ゲーム基本定数
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#f14dda'];
const UNBREAKABLE_COLOR = '#888888';
const SPECIAL_RAINBOW = '#rainbow';
const TOP_MARGIN = 70;

let grid = [];
let gameMode = 'battle';
let targetWins = 1;
let myWins = 0;
let opponentWins = 0;

let battleRole = '';
let roomCode = '';
let gameState = 'title';
let battleTurnState = 'waiting';

let myJankenChoice = '';
let opponentJankenChoice = '';
let jankenResultMsg = '';
let currentTurnPlayer = '';

const TURN_TIME_LIMIT = 10;
let turnRemainingTime = TURN_TIME_LIMIT;
let turnTimerInterval = null;

let shooterX = 200;
let shooterY = canvas.height - 70;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;

let bulletData = getRandomShooterBubble();
let nextBubble = getRandomShooterBubble();

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let pullX = 0;
let pullY = 0;
const MAX_PULL_DISTANCE = 120;
const MIN_SPEED = 8;
const MAX_SPEED = 24;

let isMoving = false;
let flyingOjamaList = [];

let peer = null;
let conn = null;
const PEER_PREFIX = 'pb-game-room-2026-v7-';

function showScreen(screenId) {
  document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
  if (screenId === '') return;
  let target = document.getElementById(screenId);
  if (target) {
    target.style.display = 'flex';
    if (screenId === 'screen-title') {
      gameState = 'title';
      stopBGM();
      stopTurnTimer();
    }
  }
}

function goToRoleSelect() {
  unlockAudio();
  showScreen('screen-role-select');
}

function startTurnTimer() {
  stopTurnTimer();
  turnRemainingTime = TURN_TIME_LIMIT;
  turnTimerInterval = setInterval(() => {
    if (gameState === 'playing' && gameMode === 'battle') {
      if (battleTurnState === 'my_turn') {
        turnRemainingTime--;
        if (turnRemainingTime <= 0) {
          stopTurnTimer();
          forceTimeoutTurnEnd();
        }
      }
    }
  }, 1000);
}

function stopTurnTimer() {
  if (turnTimerInterval) {
    clearInterval(turnTimerInterval);
    turnTimerInterval = null;
  }
}

function forceTimeoutTurnEnd() {
  isMoving = false;
  spawnBullet();
  if (conn && conn.open) {
    conn.send({ type: 'sync_turn_action', ojamaAmount: 0, didClear: false, activeItemsUsed: [] });
  }
  switchTurnToOpponent();
}

function getRandomGridCell() {
  let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
  let isMystery = Math.random() < 0.11;
  return { color: color, isOjama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
  let isMystery = Math.random() < 0.11;
  if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW, isOjama: false, isMystery: false };
  return {
    color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
    isOjama: false,
    isMystery: isMystery
  };
}

function initGridForStage() {
  grid = [];
  flyingOjamaList = [];

  for (let r = 0; r < ROWS; r++) {
    let row = [];
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) row.push(null);
    grid.push(row);
  }

  let fillRows = 3;
  for (let r = 0; r < fillRows; r++) {
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) {
      if (Math.random() < 0.7) {
        grid[r][c] = getRandomGridCell();
      }
    }
  }
}

function setupRole(role) {
  battleRole = role;
  closeNetwork();
  if (role === 'host') {
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    showScreen('screen-host-wait');
    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on('connection', (c) => {
      conn = c;
      setupConnectionListeners();
    });
    peer.on('error', () => {
      alert('ルーム作成に失敗しました。再試行してください。');
      showScreen('screen-role-select');
    });
  } else {
    showScreen('screen-guest-join');
    document.getElementById('status-message').innerText = '';
  }
}

function joinRoom() {
  let code = document.getElementById('input-room-code').value;
  if (code.length !== 4) {
    document.getElementById('status-message').innerText = '4桁のコードを入力してください';
    return;
  }
  roomCode = code;
  document.getElementById('status-message').innerText = '接続中...';
  closeNetwork();
  peer = new Peer();
  peer.on('open', () => {
    conn = peer.connect(PEER_PREFIX + roomCode);
    setupConnectionListeners();
  });
  peer.on('error', () => {
    document.getElementById('status-message').innerText = '接続に失敗しました';
  });
}

function setupConnectionListeners() {
  conn.on('open', () => {
    if (battleRole === 'guest') {
      document.getElementById('status-message').innerText = '接続成功！ホストの設定を待っています...';
    }
  });

  conn.on('data', (data) => {
    if (data.type === 'set_first_player') {
      currentTurnPlayer = data.turnPlayer;
      closeJankenOverlay();
      startBattleRoundLoop();
      return;
    }

    if (battleRole === 'guest') {
      if (data.type === 'show_rules') {
        targetWins = data.targetWins;
        displayBattleRulesDesc();
      } else if (data.type === 'ready_start') {
        executeBattleStart();
      } else if (data.type === 'start_janken') {
        openJankenScreen();
      } else if (data.type === 'sync_janken_result') {
        opponentJankenChoice = data.choice;
        checkJankenFinish();
      } else if (data.type === 'sync_turn_action') {
        executeOpponentAction(data);
      } else if (data.type === 'sync_round_end') {
        myWins = data.opponentWins;
        opponentWins = data.myWins;
        let guestWinner = (data.winner === 'YOU') ? 'OPPONENT' : 'YOU';
        checkBattleSetEnd(guestWinner);
      } else if (data.type === 'rematch') {
        myWins = 0;
        opponentWins = 0;
        startNextRound();
      }
    } else {
      if (data.type === 'sync_janken_result') {
        opponentJankenChoice = data.choice;
        checkJankenFinish();
      } else if (data.type === 'sync_turn_action') {
        executeOpponentAction(data);
      } else if (data.type === 'guest_game_over') {
        handleHostRoundDecide('YOU');
      } else if (data.type === 'rematch') {
        myWins = 0;
        opponentWins = 0;
        if (conn && conn.open) conn.send({ type: 'rematch' });
        startNextRound();
      }
    }
  });

  conn.on('close', () => {
    if (gameState === 'playing') {
      alert('通信が切断されました');
      showScreen('screen-title');
    }
  });
}

function setHostTargetWins(wins) {
  targetWins = wins;
  document.getElementById('btn-win-1').className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
  document.getElementById('btn-win-2').className = wins === 2 ? 'menu-btn' : 'menu-btn gray';
}

function confirmHostBattleSettings() {
  if (conn && conn.open) {
    conn.send({
      type: 'show_rules',
      targetWins: targetWins
    });
  }
  displayBattleRulesDesc();
}

function displayBattleRulesDesc() {
  let desc = `<b>【お邪魔バブル対戦ルール】</b><br><br>
  ・バブルをまとめて消してお邪魔バブルを送ろう！<br>
  ・デッドラインを超えた方の負け！<br>
  ・勝利必要本数: <b>${targetWins}勝</b>`;
  document.getElementById('rules-text-content').innerHTML = desc;
  showScreen('screen-battle-rules-desc');
}

function readyToStartBattle() {
  if (battleRole === 'host') {
    executeBattleStart();
    if (conn && conn.open) conn.send({ type: 'ready_start' });
  }
}

function executeBattleStart() {
  gameMode = 'battle';
  gameState = 'playing';
  myWins = 0;
  opponentWins = 0;
  initGridForStage();
  spawnBullet();
  playRandomBGM();
  startJankenPhase();
}

function closeNetwork() {
  if (conn) {
    try { conn.close(); } catch(e) {}
    conn = null;
  }
  if (peer) {
    try {
      peer.disconnect();
      peer.destroy();
    } catch(e) {}
    peer = null;
  }
}

function startNextRound() {
  initGridForStage();
  spawnBullet();
  gameState = 'playing';
  playRandomBGM();
  startJankenPhase();
}

function startJankenPhase() {
  battleTurnState = 'janken';
  myJankenChoice = '';
  opponentJankenChoice = '';
  jankenResultMsg = '';

  let container = document.getElementById('janken-overlay');
  if (!container) createJankenOverlayDOM();

  document.getElementById('janken-status-msg').innerText = jankenResultMsg;
  document.getElementById('janken-choice-buttons').style.display = 'flex';
  document.getElementById('janken-role-select').style.display = 'none';
  document.getElementById('janken-overlay').style.display = 'flex';

  if (battleRole === 'host' && conn && conn.open) {
    conn.send({ type: 'start_janken' });
  }
}

function openJankenScreen() {
  battleTurnState = 'janken';
  myJankenChoice = '';
  opponentJankenChoice = '';
  jankenResultMsg = '';
  document.getElementById('janken-status-msg').innerText = jankenResultMsg;
  document.getElementById('janken-choice-buttons').style.display = 'flex';
  document.getElementById('janken-role-select').style.display = 'none';
  document.getElementById('janken-overlay').style.display = 'flex';
}

function createJankenOverlayDOM() {
  let overlay = document.createElement('div');
  overlay.id = 'janken-overlay';
  overlay.className = 'overlay-screen';
  overlay.style.cssText = "display: none; position:fixed; top:0; left:0; width: 100%; height:100%; background:rgba(0,0,0,0.85); z-index:1000; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
  overlay.innerHTML = `
    <div style="background: #222; padding:30px; border-radius:10px; text-align:center; width: 320px; border:2px solid #ffcc00;">
      <h2 style="color:#ffcc00; margin-bottom:15px;">ジャンケンポン！</h2>
      <p id="janken-status-msg" style="margin-bottom:20px; font-size:14px;"></p>
      <div id="janken-choice-buttons" style="display:flex; justify-content:center; gap:12px; margin-bottom:20px;">
        <button id="btn-janken-rock" class="menu-btn sub" style="width:75px; height:60px; font-size:20px;">✊</button>
        <button id="btn-janken-scissors" class="menu-btn sub" style="width:75px; height:60px; font-size:20px;">✌️</button>
        <button id="btn-janken-paper" class="menu-btn sub" style="width:75px; height:60px; font-size:20px;">✋</button>
      </div>
      <div id="janken-role-select" style="display: none; flex-direction:column; gap: 10px;">
        <p id="janken-winner-desc" style="color:#4dff4d; font-weight:bold; font-size:15px;"></p>
        <button id="btn-role-first" class="menu-btn">先攻（自分から）</button>
        <button id="btn-role-second" class="menu-btn sub">後攻（相手から）</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  ['touchstart', 'click'].forEach(evt => {
    document.getElementById('btn-janken-rock').addEventListener(evt, (e) => { e.preventDefault(); chooseJanken('rock'); }, { passive: false });
    document.getElementById('btn-janken-scissors').addEventListener(evt, (e) => { e.preventDefault(); chooseJanken('scissors'); }, { passive: false });
    document.getElementById('btn-janken-paper').addEventListener(evt, (e) => { e.preventDefault(); chooseJanken('paper'); }, { passive: false });
    document.getElementById('btn-role-first').addEventListener(evt, (e) => { e.preventDefault(); selectFirstOrSecond('first'); }, { passive: false });
    document.getElementById('btn-role-second').addEventListener(evt, (e) => { e.preventDefault(); selectFirstOrSecond('second'); }, { passive: false });
  });
}

function chooseJanken(choice) {
  if (myJankenChoice !== '') return;
  myJankenChoice = choice;
  let names = { 'rock': '✊', 'scissors': '✌️', 'paper': '✋' };
  let statusMsgEl = document.getElementById('janken-status-msg');
  let buttonsEl = document.getElementById('janken-choice-buttons');
  if (statusMsgEl) statusMsgEl.innerText = `あなた: ${names[choice]}\n相手の選択を待っています...`;
  if (buttonsEl) buttonsEl.style.display = 'none';

  if (conn && conn.open) {
    conn.send({ type: 'sync_janken_result', choice: choice });
  }
  checkJankenFinish();
}

function checkJankenFinish() {
  let roleSelectEl = document.getElementById('janken-role-select');
  let statusMsgEl = document.getElementById('janken-status-msg');
  let buttonsEl = document.getElementById('janken-choice-buttons');

  if (myJankenChoice !== '' && opponentJankenChoice !== '') {
    if (myJankenChoice === opponentJankenChoice) {
      if (statusMsgEl) statusMsgEl.innerText = "あいこ！もう一度選択してください。";
      myJankenChoice = '';
      opponentJankenChoice = '';
      setTimeout(() => {
        if (buttonsEl) buttonsEl.style.display = 'flex';
      }, 800);
      return;
    }

    let iWon = (
      (myJankenChoice === 'rock' && opponentJankenChoice === 'scissors') ||
      (myJankenChoice === 'scissors' && opponentJankenChoice === 'paper') ||
      (myJankenChoice === 'paper' && opponentJankenChoice === 'rock')
    );

    if (iWon) {
      if (statusMsgEl) statusMsgEl.innerText = "ジャンケンに勝ちました！順序を選んでください。";
      if (roleSelectEl) roleSelectEl.style.display = 'flex';
    } else {
      if (statusMsgEl) statusMsgEl.innerText = "ジャンケンに負けました。相手の選択を待っています...";
    }
  }
}

function selectFirstOrSecond(choice) {
  let turnPlayer = (choice === 'first') ? battleRole : ((battleRole === 'host') ? 'guest' : 'host');
  currentTurnPlayer = turnPlayer;
  if (conn && conn.open) {
    conn.send({ type: 'set_first_player', turnPlayer: turnPlayer });
  }
  closeJankenOverlay();
  startBattleRoundLoop();
}

function closeJankenOverlay() {
  let el = document.getElementById('janken-overlay');
  if (el) el.style.display = 'none';
}

function startBattleRoundLoop() {
  showScreen('');
  if (currentTurnPlayer === battleRole) {
    battleTurnState = 'my_turn';
    startTurnTimer();
  } else {
    battleTurnState = 'opponent_turn';
  }
}

function switchTurnToOpponent() {
  stopTurnTimer();
  battleTurnState = 'opponent_turn';
}

function executeOpponentAction(data) {
  let actualOjama = data.ojamaAmount;
  if (actualOjama > 0) {
    launchOjamaProjectilesFromBottom(actualOjama);
  } else {
    battleTurnState = 'my_turn';
    startTurnTimer();
  }
}

function launchOjamaProjectilesFromBottom(count) {
  for (let i = 0; i < count; i++) {
    flyingOjamaList.push({
      x: Math.random() * (canvas.width - 40) + 20,
      y: canvas.height + 20,
      targetY: TOP_MARGIN + Math.random() * 100,
      speed: 8 + Math.random() * 4
    });
  }
}

function spawnBullet() {
  bulletData = nextBubble;
  nextBubble = getRandomShooterBubble();
  bulletX = shooterX;
  bulletY = shooterY;
  bulletVX = 0;
  bulletVY = 0;
  isMoving = false;
}

// 入力判定ハンドラ
canvas.addEventListener('mousedown', handlePointerDown);
canvas.addEventListener('mousemove', handlePointerMove);
canvas.addEventListener('mouseup', handlePointerUp);
canvas.addEventListener('touchstart', (e) => { handlePointerDown(e.touches[0]); });
canvas.addEventListener('touchmove', (e) => { handlePointerMove(e.touches[0]); });
canvas.addEventListener('touchend', handlePointerUp);

function handlePointerDown(e) {
  if (gameState !== 'playing' || isMoving || battleTurnState !== 'my_turn') return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (y > shooterY - 40) {
    isDragging = true;
    dragStartX = x;
    dragStartY = y;
    pullX = 0;
    pullY = 0;
  }
}

function handlePointerMove(e) {
  if (!isDragging) return;
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  pullX = x - dragStartX;
  pullY = y - dragStartY;

  let dist = Math.hypot(pullX, pullY);
  if (dist > MAX_PULL_DISTANCE) {
    pullX = (pullX / dist) * MAX_PULL_DISTANCE;
    pullY = (pullY / dist) * MAX_PULL_DISTANCE;
  }
}

function handlePointerUp() {
  if (!isDragging) return;
  isDragging = false;

  let dist = Math.hypot(pullX, pullY);
  if (dist > 20 && pullY > 0) {
    let speed = MIN_SPEED + (dist / MAX_PULL_DISTANCE) * (MAX_SPEED - MIN_SPEED);
    let angle = Math.atan2(-pullY, -pullX);
    bulletVX = Math.cos(angle) * speed;
    bulletVY = Math.sin(angle) * speed;
    isMoving = true;
    playSE(se.ballShoot);
  }
  pullX = 0;
  pullY = 0;
}

// メインゲームループ
function gameLoop() {
  update();
  render();
  requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);

function update() {
  if (gameState !== 'playing') return;

  if (isMoving) {
    bulletX += bulletVX;
    bulletY += bulletVY;

    if (bulletX - RADIUS <= 0 || bulletX + RADIUS >= canvas.width) {
      bulletVX *= -1;
      bulletX = Math.max(RADIUS, Math.min(canvas.width - RADIUS, bulletX));
    }

    if (bulletY - RADIUS <= TOP_MARGIN || checkCollisionWithGrid(bulletX, bulletY)) {
      snapToGrid(bulletX, bulletY);
    }
  }

  for (let i = flyingOjamaList.length - 1; i >= 0; i--) {
    let oj = flyingOjamaList[i];
    oj.y -= oj.speed;
    if (oj.y <= oj.targetY) {
      addOjamaToGrid();
      flyingOjamaList.splice(i, 1);
      if (flyingOjamaList.length === 0) {
        battleTurnState = 'my_turn';
        startTurnTimer();
      }
    }
  }
}

function checkCollisionWithGrid(bx, by) {
  for (let r = 0; r < ROWS; r++) {
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) {
      if (grid[r][c] !== null) {
        let pos = getGridCellCenter(r, c);
        let dist = Math.hypot(bx - pos.x, by - pos.y);
        if (dist < DIAMETER - 4) return true;
      }
    }
  }
  return false;
}

function getGridCellCenter(r, c) {
  let isEven = (r % 2 === 0);
  let x = isEven ? (c * DIAMETER + RADIUS) : (c * DIAMETER + RADIUS * 2);
  let y = TOP_MARGIN + r * ROW_HEIGHT + RADIUS;
  return { x: x, y: y };
}

function snapToGrid(bx, by) {
  isMoving = false;
  let bestR = 0, bestC = 0, minDist = Infinity;

  for (let r = 0; r < ROWS; r++) {
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) {
      if (grid[r][c] === null) {
        let pos = getGridCellCenter(r, c);
        let dist = Math.hypot(bx - pos.x, by - pos.y);
        if (dist < minDist) {
          minDist = dist;
          bestR = r;
          bestC = c;
        }
      }
    }
  }

  grid[bestR][bestC] = { color: bulletData.color, isOjama: bulletData.isOjama, isMystery: bulletData.isMystery };
  playSE(se.ballLand);

  let cleared = processMatches(bestR, bestC);
  let ojamaToSend = cleared > 3 ? cleared - 2 : 0;

  if (conn && conn.open) {
    conn.send({
      type: 'sync_turn_action',
      ojamaAmount: ojamaToSend,
      didClear: cleared > 0,
      activeItemsUsed: []
    });
  }

  if (checkGameOverCondition()) {
    playSE(se.gameOver);
    if (battleRole === 'guest' && conn && conn.open) {
      conn.send({ type: 'guest_game_over' });
    } else if (battleRole === 'host') {
      handleHostRoundDecide('OPPONENT');
    }
    return;
  }

  spawnBullet();
  switchTurnToOpponent();
}

function processMatches(r, c) {
  let targetColor = grid[r][c].color;
  let matches = [];
  let visited = new Set();

  function dfs(currR, currC) {
    let key = `${currR},${currC}`;
    if (visited.has(key)) return;
    visited.add(key);
    matches.push({ r: currR, c: currC });

    let neighbors = getNeighbors(currR, currC);
    for (let n of neighbors) {
      if (grid[n.r][n.c] !== null && grid[n.r][n.c].color === targetColor) {
        dfs(n.r, n.c);
      }
    }
  }

  dfs(r, c);

  if (matches.length >= 3) {
    for (let m of matches) {
      grid[m.r][m.c] = null;
    }
    dropFloatingBubbles();
    return matches.length;
  }
  return 0;
}

function getNeighbors(r, c) {
  let neighbors = [];
  let isEven = (r % 2 === 0);
  let offsets = isEven ? [
    { r: r - 1, c: c - 1 }, { r: r - 1, c: c },
    { r: r, c: c - 1 }, { r: r, c: c + 1 },
    { r: r + 1, c: c - 1 }, { r: r + 1, c: c }
  ] : [
    { r: r - 1, c: c }, { r: r - 1, c: c + 1 },
    { r: r, c: c - 1 }, { r: r, c: c + 1 },
    { r: r + 1, c: c }, { r: r + 1, c: c + 1 }
  ];

  for (let off of offsets) {
    if (off.r >= 0 && off.r < ROWS) {
      let colsInRow = (off.r % 2 === 0) ? COLS : COLS - 1;
      if (off.c >= 0 && off.c < colsInRow) {
        neighbors.push(off);
      }
    }
  }
  return neighbors;
}

function dropFloatingBubbles() {
  let connected = new Set();
  function dfs(r, c) {
    let key = `${r},${c}`;
    if (connected.has(key)) return;
    connected.add(key);
    let neighbors = getNeighbors(r, c);
    for (let n of neighbors) {
      if (grid[n.r][n.c] !== null) dfs(n.r, n.c);
    }
  }

  for (let c = 0; c < COLS; c++) {
    if (grid[0][c] !== null) dfs(0, c);
  }

  for (let r = 0; r < ROWS; r++) {
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) {
      if (grid[r][c] !== null && !connected.has(`${r},${c}`)) {
        grid[r][c] = null;
      }
    }
  }
}

function addOjamaToGrid() {
  for (let c = 0; c < COLS; c++) {
    if (grid[0][c] === null) {
      grid[0][c] = { color: '#888888', isOjama: true, isMystery: false };
      break;
    }
  }
}

function checkGameOverCondition() {
  let lastRowCols = ((ROWS - 1) % 2 === 0) ? COLS : COLS - 1;
  for (let c = 0; c < lastRowCols; c++) {
    if (grid[ROWS - 1][c] !== null) return true;
  }
  return false;
}

function handleHostRoundDecide(winnerRole) {
  if (winnerRole === 'YOU') myWins++;
  else opponentWins++;

  if (conn && conn.open) {
    conn.send({ type: 'sync_round_end', winner: winnerRole, myWins: myWins, opponentWins: opponentWins });
  }
  checkBattleSetEnd(winnerRole === 'YOU' ? 'YOU' : 'OPPONENT');
}

function checkBattleSetEnd(roundWinner) {
  if (myWins >= targetWins || opponentWins >= targetWins) {
    let finalMsg = myWins >= targetWins ? "🎉 あなたの勝利！" : "💀 相手の勝利...";
    alert(finalMsg);
    showScreen('screen-title');
  } else {
    alert(`ラウンド終了！ Winner: ${roundWinner === 'YOU' ? 'あなた' : '相手'}`);
    startNextRound();
  }
}

// Canvas描画処理
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // グリッド描画
  for (let r = 0; r < ROWS; r++) {
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < colsInRow; c++) {
      if (grid[r][c] !== null) {
        let pos = getGridCellCenter(r, c);
        drawBubble(pos.x, pos.y, RADIUS, grid[r][c].color);
      }
    }
  }

  // 弾描画
  drawBubble(bulletX, bulletY, RADIUS, bulletData.color);

  // NEXTバブル表示
  ctx.fillStyle = '#fff';
  ctx.font = '12px sans-serif';
  ctx.fillText('NEXT', 30, canvas.height - 80);
  drawBubble(45, canvas.height - 45, RADIUS * 0.8, nextBubble.color);

  // 引っ張りガイドライン
  if (isDragging) {
    ctx.strokeStyle = 'rgba(255, 204, 0, 0.6)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(shooterX, shooterY);
    ctx.lineTo(shooterX - pullX, shooterY - pullY);
    ctx.stroke();
  }

  // ターン状態表示
  if (gameState === 'playing') {
    ctx.fillStyle = battleTurnState === 'my_turn' ? '#4dff4d' : '#ff4d4d';
    ctx.font = 'bold 16px sans-serif';
    let turnMsg = battleTurnState === 'my_turn' ? `あなたのターン (${turnRemainingTime}s)` : '相手のターン中...';
    ctx.fillText(turnMsg, 130, 40);
  }
}

// 質感を持たせた美しい球体描画
function drawBubble(x, y, radius, colorHex) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);

  if (colorHex === SPECIAL_RAINBOW) {
    let grad = ctx.createRadialGradient(x - radius/3, y - radius/3, radius/10, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, '#ff0000');
    grad.addColorStop(0.6, '#00ff00');
    grad.addColorStop(1, '#0000ff');
    ctx.fillStyle = grad;
  } else {
    let grad = ctx.createRadialGradient(x - radius/3, y - radius/3, radius/8, x, y, radius);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.3, colorHex);
    grad.addColorStop(1, adjustColor(colorHex, -40));
    ctx.fillStyle = grad;
  }

  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function adjustColor(color, amount) {
  if (color.startsWith('#') && color.length === 7) {
    let num = parseInt(color.slice(1), 16);
    let r = Math.max(0, Math.min(255, (num >> 16) + amount));
    let g = Math.max(0, Math.min(255, ((num >> 8) & 0x00FF) + amount));
    let b = Math.max(0, Math.min(255, (num & 0x0000FF) + amount));
    return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
  }
  return color;
}
