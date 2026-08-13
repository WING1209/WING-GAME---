// ==========================================
// 1. 初期設定・グローバル変数
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];

// PeerJS 通信用
let peer = null;
let connections = []; // ホスト用
let hostConn = null;  // ゲスト用
const PEER_PREFIX = 'wing-game-multi-2026-';

// ゲーム状態管理
let gameState = 'title'; // title, lobby, roulette, ready, playing
let isHost = false;
let maxPlayers = 2;
let roomID = '';
let myPlayerId = '';
let myName = '';
let winCondition = 1; // 1または2勝
let ojamaRate = 1;     // 1倍, 2倍, 3倍

// プレイヤー一覧 [{ id, name, wins, isReady, order }]
let playersList = [];
let currentTurnIndex = 0;

// バトル・ステート
let grid = [];
let myOjamaStock = 0;
let activeOshitsukeTarget = null; // おしつけ対象プレイヤーID
let oshitsukeTurnsLeft = 0;
let isBougyoActive = false;      // 防御フラグ
let isForcedLaunch = false;      // 強制発射フラグ

// 物理・バブル計算用
let bulletX = 200, bulletY = 590;
let bulletVX = 0, bulletVY = 0;
let isMoving = false;
let bulletColor = BASE_COLORS[0];

// SEサウンド定義
const se = {
  shoot: new Audio('audio/se/se_ball_shoot.wav'),
  explode: new Audio('audio/se/se_bomb_explode.wav')
};
function playSE(sound) {
  try { sound.currentTime = 0; sound.play().catch(()=>{}); } catch(e){}
}

// ==========================================
// 2. 画面遷移＆メニュー制御
// ==========================================
function showScreen(id) {
  document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
  if (id) {
    const el = document.getElementById(id);
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
    alert('ゲームを終了します。');
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
    broadcastLobbyState();
  });
}

function joinRoomByCode() {
  const code = document.getElementById('input-room-id').value;
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
    document.getElementById('guest-status-msg').innerText = '部屋が見つかりません';
  });
}

function setupConnListeners(conn) {
  conn.on('open', () => {
    if (!isHost) showScreen('screen-lobby');
  });

  conn.on('data', (data) => {
    handleNetworkData(data);
  });

  conn.on('close', () => {
    alert('通信が切断されました');
    location.reload();
  });
}

// ==========================================
// 3. ネットワーク同期 & ロビー・名前登録
// ==========================================
function submitPlayerName() {
  const nameInput = document.getElementById('input-player-name').value.trim();
  if (!nameInput) return;
  myName = nameInput.substring(0, 6);

  document.getElementById('btn-submit-name').disabled = true;
  document.getElementById('input-player-name').disabled = true;

  sendData({ type: 'submit_name', id: myPlayerId, name: myName });
}

function broadcastLobbyState() {
  if (!isHost) return;
  const state = {
    type: 'lobby_state',
    players: playersList,
    maxPlayers: maxPlayers
  };
  connections.forEach(c => c.send(state));
  updateLobbyStatus();
}

function sendData(data) {
  if (isHost) {
    connections.forEach(c => c.send(data));
    handleNetworkData(data);
  } else if (hostConn && hostConn.open) {
    hostConn.send(data);
  }
}

function handleNetworkData(data) {
  switch (data.type) {
    case 'submit_name':
      if (isHost) {
        if (!playersList.some(p => p.id === data.id)) {
          playersList.push({ id: data.id, name: data.name, wins: 0, isReady: false });
        }
        broadcastLobbyState();
        if (playersList.length === maxPlayers) {
          setTimeout(startRoulettePhase, 1000);
        }
      }
      break;

    case 'lobby_state':
      playersList = data.players;
      updateLobbyStatus();
      break;

    case 'start_roulette':
      runRouletteSequence(data.assignedOrder);
      break;

    case 'player_ready_sync':
      playersList = data.players;
      checkAllReady();
      break;

    case 'game_start_signal':
      triggerBigAnnounce('ゲームスタート！', () => {
        initGameRound();
      });
      break;

    case 'action_turn_end':
      processTurnEnd(data);
      break;

    case 'apply_item':
      applyItemEffect(data);
      break;
  }
}

function updateLobbyStatus() {
  document.getElementById('lobby-status').innerText = 
    `参加人数: ${playersList.length} / ${maxPlayers} 人`;
}

// ==========================================
// 4. 打順ルーレット＆スタート演出
// ==========================================
let myAssignedOrder = 0;
let modalStep = 0;

function startRoulettePhase() {
  if (!isHost) return;
  // 順位シャッフル (重複なし)
  let orders = Array.from({length: maxPlayers}, (_, i) => i + 1);
  orders.sort(() => Math.random() - 0.5);

  const assigned = {};
  playersList.forEach((p, idx) => {
    p.order = orders[idx];
    assigned[p.id] = p.order;
  });

  // 順番昇順に並べ替え
  playersList.sort((a,b) => a.order - b.order);

  sendData({ type: 'start_roulette', assignedOrder: assigned });
}

function runRouletteSequence(assignedMap) {
  myAssignedOrder = assignedMap[myPlayerId];
  gameState = 'roulette';
  
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
    // 停止時
    body.innerText = `あなたは ${myAssignedOrder} 番です`;
    btn.innerText = '準備完了';
    modalStep = 2;
  } else if (modalStep === 2) {
    document.getElementById('center-modal').style.display = 'none';
    sendData({ type: 'player_ready', id: myPlayerId });
    if (isHost) {
      const p = playersList.find(x => x.id === myPlayerId);
      if (p) p.isReady = true;
      checkAllReady();
    }
  }
}

function checkAllReady() {
  if (!isHost) return;
  if (playersList.every(p => p.isReady)) {
    sendData({ type: 'game_start_signal' });
  }
}

function triggerBigAnnounce(text, callback) {
  const el = document.getElementById('big-announce');
  el.innerText = text;
  el.style.display = 'block';
  setTimeout(() => {
    el.style.display = 'none';
    if (callback) callback();
  }, 1800);
}

// ==========================================
// 5. ゲームメインロジック & GUI制御
// ==========================================
function initGameRound() {
  gameState = 'playing';
  currentTurnIndex = 0;
  initGrid();
  
  document.getElementById('right-gui-panel').style.display = 'flex';
  document.getElementById('gui-my-name').innerText = myName;

  updateTurnUI();
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

function updateTurnUI() {
  const activePlayer = playersList[currentTurnIndex];
  const isMyTurn = (activePlayer.id === myPlayerId);

  // 自分のターンかつ発射フラグがある場合
  if (isMyTurn && isForcedLaunch) {
    isForcedLaunch = false;
    setTimeout(forcedAutoLaunch, 800);
  }
}

// 強制ランダム発射 (発射アイテム被弾時)
function forcedAutoLaunch() {
  if (isMoving) return;
  const angle = (Math.random() * 120 + 30) * Math.PI / 180;
  const speed = 12;
  bulletVX = Math.cos(angle) * speed;
  bulletVY = -Math.abs(Math.sin(angle) * speed);
  isMoving = true;
  playSE(se.shoot);
}

// ==========================================
// 6. 新規アイテムシステム (1:おしつけ, 2:発射, 3:防御)
// ==========================================
function useItemOshitsuke() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  const target = promptPlayerSelect('おしつけ相手を選択してください:');
  if (!target) return;

  activeOshitsukeTarget = target.id;
  oshitsukeTurnsLeft = playersList.length * 2; // 2周分
  alert(`${target.name} へおしつけを設定しました（2ターン有効）`);
}

function useItemHassha() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  const target = promptPlayerSelect('強制発射させる相手を選択してください:');
  if (!target) return;

  sendData({ type: 'apply_item', item: 'hassha', targetId: target.id });
  alert(`${target.name} に強制発射を仕掛けました！`);
}

function useItemBougyo() {
  if (playersList[currentTurnIndex].id !== myPlayerId) return;
  isBougyoActive = true;
  alert('防御を発動！1ターンの間お邪魔玉が半減します。');
}

function promptPlayerSelect(msg) {
  const candidates = playersList.filter(p => p.id !== myPlayerId);
  let text = msg + '\n';
  candidates.forEach((c, idx) => { text += `${idx + 1}: ${c.name}\n`; });
  const choice = prompt(text);
  const num = parseInt(choice, 10);
  if (isNaN(num) || num < 1 || num > candidates.length) return null;
  return candidates[num - 1];
}

function applyItemEffect(data) {
  if (data.item === 'hassha' && data.targetId === myPlayerId) {
    isForcedLaunch = true;
  }
}

// ==========================================
// 7. ターン進行 ＆ お邪魔玉計算
// ==========================================
function processTurnEnd(actionData) {
  // お邪魔玉計算 (消去数 × 倍率)
  let clearedCount = actionData.clearedCount || 0;
  let generatedOjama = clearedCount * ojamaRate;

  if (generatedOjama > 0) {
    // おしつけ効果判定
    let destId = actionData.senderId;
    if (oshitsukeTurnsLeft > 0 && activeOshitsukeTarget) {
      destId = activeOshitsukeTarget;
    }

    if (destId === myPlayerId) {
      if (isBougyoActive) {
        generatedOjama = Math.floor(generatedOjama / 2);
      }
      myOjamaStock += generatedOjama;
    }
  }

  // ターン減算処理
  if (oshitsukeTurnsLeft > 0) oshitsukeTurnsLeft--;
  isBougyoActive = false;

  // 次ターンへシフト
  currentTurnIndex = (currentTurnIndex + 1) % playersList.length;
  updateTurnUI();
}

// ==========================================
// 8. 描画ループ (スマートフォンアスペクト比維持)
// ==========================================
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // グッド/バブル背景描画
  for (let r = 0; r < ROWS; r++) {
    let cols = (r % 2 === 0) ? COLS : COLS - 1;
    let xOffset = (r % 2 === 0) ? 25 : 50;
    for (let c = 0; c < cols; c++) {
      let b = grid[r] ? grid[r][c] : null;
      if (b) {
        ctx.beginPath();
        ctx.arc(xOffset + c * 48, 40 + r * 38, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = b.color;
        ctx.fill();
        ctx.closePath();
      }
    }
  }

  // ターンインジケータ
  if (gameState === 'playing') {
    const activeP = playersList[currentTurnIndex];
    ctx.fillStyle = '#ffcc00';
    ctx.font = '16px sans-serif';
    ctx.fillText(`TURN: ${activeP ? activeP.name : ''}`, 15, 25);
  }

  requestAnimationFrame(render);
}

// 起動
render();
