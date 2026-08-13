// ==========================================
// 1. 初期化とグローバル変数
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];

// 通信管理 (PeerJS)
let peer = null;
let connections = []; // ホストが保持する通信リスト
let hostConn = null;  // ゲストが保持するホスト接続
const PEER_PREFIX = 'wing-game-v2026-room-';

// ステート管理
let gameState = 'title';
let isHost = false;
let maxPlayers = 2;
let roomID = '';
let myPlayerId = '';
let myName = 'プレイヤー';
let winCondition = 1;
let ojamaRate = 1;

// プレイヤー管理 [{ id, name, order, isReady }]
let playersList = [];
let currentTurnIndex = 0;

// バトルデータ
let grid = [];
let myOjamaStock = 0;
let activeOshitsukeTarget = null;
let oshitsukeTurnsLeft = 0;
let isBougyoActive = false;
let isForcedLaunch = false;

// 発射関連
let isMoving = false;

// SE定義
const se = {
  shoot: new Audio('audio/se/se_ball_shoot.wav'),
  explode: new Audio('audio/se/se_bomb_explode.wav')
};
function playSE(sound) {
  try { sound.currentTime = 0; sound.play().catch(() => {}); } catch (e) {}
}

// ==========================================
// 2. 画面切り替え & ロビー処理
// ==========================================
function showScreen(screenId) {
  document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
  if (screenId) {
    const el = document.getElementById(screenId);
    if (el) el.style.display = 'flex';
  }
}

function selectMainMenu(choice) {
  if (choice === 'host') {
    isHost = true;
    showScreen('screen-host-players');
  } else if (choice === 'guest') {
    isHost = false;
    showScreen('screen-guest-join');
  } else if (choice === 'exit') {
    alert('ゲームを終了します');
    location.reload();
  }
}

function confirmPlayerCount() {
  maxPlayers = parseInt(document.getElementById('select-player-count').value, 10);
  roomID = Math.floor(1000 + Math.random() * 9000).toString();
  document.getElementById('display-room-id').innerText = roomID;
  showScreen('screen-host-rules');
}

function startHostWaiting() {
  winCondition = parseInt(document.getElementById('select-win-condition').value, 10);
  ojamaRate = parseInt(document.getElementById('select-ojama-rate').value, 10);

  myPlayerId = 'host_' + Math.random().toString(36).substr(2, 5);
  peer = new Peer(PEER_PREFIX + roomID);

  peer.on('open', () => {
    showScreen('screen-lobby');
    updateLobbyStatus();
  });

  peer.on('connection', (conn) => {
    if (connections.length + 1 >= maxPlayers) {
      conn.close();
      return;
    }
    connections.push(conn);
    setupConnListeners(conn);
  });
}

function joinRoomByCode() {
  const code = document.getElementById('input-room-id').value.trim();
  if (code.length !== 4) {
    document.getElementById('guest-status-msg').innerText = '4桁のIDを入力してください';
    return;
  }
  roomID = code;
  myPlayerId = 'guest_' + Math.random().toString(36).substr(2, 5);
  peer = new Peer();

  peer.on('open', () => {
    hostConn = peer.connect(PEER_PREFIX + roomID);
    setupConnListeners(hostConn);
  });

  peer.on('error', () => {
    document.getElementById('guest-status-msg').innerText = '接続に失敗しました';
  });
}

function setupConnListeners(conn) {
  conn.on('open', () => {
    if (!isHost) showScreen('screen-lobby');
  });

  conn.on('data', (data) => {
    handleNetworkData(data);
  });
}

function sendData(data) {
  if (isHost) {
    connections.forEach(c => c.send(data));
    handleNetworkData(data);
  } else if (hostConn && hostConn.open) {
    hostConn.send(data);
  }
}

// ==========================================
// 3. 名前設定＆ルーレット同期
// ==========================================
function submitPlayerName() {
  const inputEl = document.getElementById('input-player-name');
  const nameVal = inputEl.value.trim();
  if (!nameVal) return;
  myName = nameVal.substring(0, 6);

  document.getElementById('btn-submit-name').disabled = true;
  inputEl.disabled = true;

  sendData({ type: 'submit_name', id: myPlayerId, name: myName });
}

function updateLobbyStatus() {
  document.getElementById('lobby-status').innerText = 
    `現在の参加者: ${playersList.length} / ${maxPlayers} 人`;
}

function handleNetworkData(data) {
  switch (data.type) {
    case 'submit_name':
      if (isHost) {
        if (!playersList.some(p => p.id === data.id)) {
          playersList.push({ id: data.id, name: data.name, isReady: false });
        }
        sendData({ type: 'lobby_sync', players: playersList });

        // 全員の名前が揃った場合ルーレットへ
        if (playersList.length === maxPlayers) {
          setTimeout(initRoulettePhase, 800);
        }
      }
      break;

    case 'lobby_sync':
      playersList = data.players;
      updateLobbyStatus();
      break;

    case 'start_roulette':
      playersList = data.players;
      runRouletteUI();
      break;

    case 'player_ready_sync':
      playersList = data.players;
      if (isHost && playersList.every(p => p.isReady)) {
        sendData({ type: 'game_start_signal' });
      }
      break;

    case 'game_start_signal':
      showScreen('');
      triggerBigAnnounce('ゲームスタート！', () => {
        initGameRound();
      });
      break;

    case 'action_turn_end':
      processTurnEnd(data);
      break;
  }
}

// ==========================================
// 4. ルーレット＆スタート演出
// ==========================================
let modalStep = 0;
let myOrderNum = 0;

function initRoulettePhase() {
  // 打順の割り当て (1〜Max, 重複なし)
  let orders = Array.from({ length: maxPlayers }, (_, i) => i + 1);
  orders.sort(() => Math.random() - 0.5);

  playersList.forEach((p, idx) => {
    p.order = orders[idx];
  });

  // 打順順にソート
  playersList.sort((a, b) => a.order - b.order);

  sendData({ type: 'start_roulette', players: playersList });
}

function runRouletteUI() {
  const myP = playersList.find(p => p.id === myPlayerId);
  myOrderNum = myP ? myP.order : 1;

  const modal = document.getElementById('center-modal');
  const title = document.getElementById('modal-title');
  const body = document.getElementById('modal-body');
  const btn = document.getElementById('modal-btn');

  modal.style.display = 'block';
  title.innerText = '順位決定';
  body.innerText = 'ルーレットスタート！';
  btn.innerText = '停止';
  modalStep = 1;
}

function handleModalClick() {
  const body = document.getElementById('modal-body');
  const btn = document.getElementById('modal-btn');

  if (modalStep === 1) {
    body.innerText = `あなたは ${myOrderNum} 番です`;
    btn.innerText = '準備完了';
    modalStep = 2;
  } else if (modalStep === 2) {
    document.getElementById('center-modal').style.display = 'none';

    // 自分の準備OKを通知
    const myP = playersList.find(p => p.id === myPlayerId);
    if (myP) myP.isReady = true;

    sendData({ type: 'player_ready_sync', players: playersList });
  }
}

function triggerBigAnnounce(text, callback) {
  const el = document.getElementById('big-announce');
  el.innerText = text;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
    if (callback) callback();
  }, 1500);
}

// ==========================================
// 5. ゲーム開始＆GUI・新アイテム処理
// ==========================================
function initGameRound() {
  gameState = 'playing';
  currentTurnIndex = 0;
  initGrid();

  document.getElementById('right-gui-panel').style.display = 'flex';
  document.getElementById('gui-my-name').innerText = myName;

  updateTurnState();
}

function initGrid() {
  grid = [];
  for (let r = 0; r < ROWS; r++) {
    let row = [];
    let cols = (r % 2 === 0) ? COLS : COLS - 1;
    for (let c = 0; c < cols; c++) {
      row.push(r < 3 ? { color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)] } : null);
    }
    grid.push(row);
  }
}

function updateTurnState() {
  const activePlayer = playersList[currentTurnIndex];
  if (activePlayer.id === myPlayerId && isForcedLaunch) {
    isForcedLaunch = false;
    setTimeout(forcedLaunch, 600);
  }
}

function forcedLaunch() {
  if (isMoving) return;
  isMoving = true;
  playSE(se.shoot);
  // 発射後のターンエンド同期
  setTimeout(() => {
    isMoving = false;
    sendData({ type: 'action_turn_end', senderId: myPlayerId, clearedCount: 0 });
  }, 1000);
}

// GUIアイテムボタン
function useItemOshitsuke() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  const target = selectTargetPlayer('おしつけ対象を選択してください:');
  if (!target) return;

  activeOshitsukeTarget = target.id;
  oshitsukeTurnsLeft = playersList.length * 2;
  alert(`${target.name} へおしつけを設定しました（2ターン）`);
}

function useItemHassha() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  const target = selectTargetPlayer('強制発射対象を選択してください:');
  if (!target) return;

  target.isForced = true;
  alert(`${target.name} に強制発射をセットしました`);
}

function useItemBougyo() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  isBougyoActive = true;
  alert('1ターンの間、飛んでくるお邪魔玉を半減します！');
}

function selectTargetPlayer(msg) {
  const list = playersList.filter(p => p.id !== myPlayerId);
  let text = msg + '\n';
  list.forEach((p, i) => { text += `${i + 1}: ${p.name}\n`; });
  const input = prompt(text);
  const num = parseInt(input, 10);
  if (isNaN(num) || num < 1 || num > list.length) return null;
  return list[num - 1];
}

function processTurnEnd(data) {
  let clearedCount = data.clearedCount || 0;
  let ojamaAmount = clearedCount * ojamaRate;

  if (ojamaAmount > 0) {
    let targetId = data.senderId;
    if (oshitsukeTurnsLeft > 0 && activeOshitsukeTarget) {
      targetId = activeOshitsukeTarget;
    }

    if (targetId === myPlayerId) {
      if (isBougyoActive) {
        ojamaAmount = Math.floor(ojamaAmount / 2);
      }
      myOjamaStock += ojamaAmount;
    }
  }

  if (oshitsukeTurnsLeft > 0) oshitsukeTurnsLeft--;
  isBougyoActive = false;

  currentTurnIndex = (currentTurnIndex + 1) % playersList.length;
  updateTurnState();
}

// ==========================================
// 6. 描画ループ
// ==========================================
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 盤面描画
  for (let r = 0; r < ROWS; r++) {
    let cols = (r % 2 === 0) ? COLS : COLS - 1;
    let xOffset = (r % 2 === 0) ? 25 : 50;
    for (let c = 0; c < cols; c++) {
      let cell = grid[r] ? grid[r][c] : null;
      if (cell) {
        ctx.beginPath();
        ctx.arc(xOffset + c * 48, 40 + r * 38, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = cell.color;
        ctx.fill();
        ctx.closePath();
      }
    }
  }

  // ターンインジケータ
  if (gameState === 'playing' && playersList.length > 0) {
    const curP = playersList[currentTurnIndex];
    ctx.fillStyle = '#ffcc00';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`TURN: ${curP ? curP.name : ''}`, 15, 25);
  }

  requestAnimationFrame(render);
}

// 起動
render();
