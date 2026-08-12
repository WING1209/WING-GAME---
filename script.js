const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- 🔊 サウンド（SE & BGM）設定 ---
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
 sound.play().then(() => { sound.pause(); sound.currentTime = 0; }).catch(() => {});
 });
}

function playSE(sound) {
 try {
 if (sound) { sound.currentTime = 0; let p = sound.play(); if (p !== undefined) p.catch(() => {}); }
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
 if (currentBGM) { currentBGM.pause(); currentBGM.currentTime = 0; currentBGM = null; }
 } catch(e) {}
}

// --- 🎮 ゲーム基本パラメータ ---
const ROWS = 15; 
const COLS = 8; 
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const UNBREAKABLE_COLOR = '#fff';
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let currentStage = 1;
let gameMode = 'single'; 
let battleType = 'お邪魔対戦'; 
let targetWins = 1;

// --- 👥 マルチプレイ管理変数 ---
let targetPlayerCount = 2; // 2~5名
let myName = "プレイヤー";
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let peer = null;
let connections = []; // 全員との通信リスト (ホスト・ゲスト共通)
let playerList = []; // [{ id, name, peerId }]
let turnOrder = []; // プレイヤーIDの配列（順番）
let currentTurnIndex = 0;
let myPlayerId = '';

// --- 🎁 アイテム＆特殊状態（おしつけ）---
// アイテム: 0:ボム, 1:虹, 2:全消し, 3:バリア, 4:おしつけ
let itemStockCounts = [0, 0, 0, 0, 0]; 
let activeItems = []; 
let oshitsukeTargetId = null; // おしつけ対象のID
let oshitsukeTurnsLeft = 0;   // 残りターン数（2周分 = 参加人数 * 2）

let gameState = 'title';
let battleTurnState = 'waiting'; 
const TURN_TIME_LIMIT = 10;
let turnRemainingTime = TURN_TIME_LIMIT;
let turnTimerInterval = null;

let shooterX = 200; 
let shooterY = canvas.height - 70;
let bulletX = shooterX, bulletY = shooterY;
let bulletVX = 0, bulletVY = 0;
let bulletData = null, nextBubble = null;
let isMoving = false;
let fallingBubbles = [], flashingBubbles = [], particles = [], flyingOjamaList = [];

let myClearedBubbleCount = 0;
const PEER_PREFIX = 'pb-game-room-2026-v8-';

// --- UI制御スクリーンスイッチ ---
function showScreen(screenId) {
 document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
 if (screenId === '') return;
 let target = document.getElementById(screenId);
 if (target) target.style.display = 'flex';
}

function goToHowToPlay() {
 unlockAudio();
 showScreen('screen-how-to-play');
}

// --- ⚙️ ルール＆フロー構築 ---
function selectPlayerCount(count) {
 targetPlayerCount = count;
 if (count === 2) {
 showScreen('screen-battle-mode-select');
 } else {
 battleType = 'お邪魔対戦';
 showScreen('screen-rule-wins-select');
 }
}

function setHostBattleType(type) {
 battleType = type;
 document.getElementById('btn-mode-ta').className = type === 'タイムアタック' ? 'menu-btn sub' : 'menu-btn gray';
 document.getElementById('btn-mode-ojama').className = type === 'お邪魔対戦' ? 'menu-btn sub' : 'menu-btn gray';
}

function setHostTargetWins(wins) {
 targetWins = wins;
 document.getElementById('btn-win-1').className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
 document.getElementById('btn-win-2').className = wins === 2 ? 'menu-btn gray' : 'menu-btn';
}

function proceedToNameInput() {
 showScreen('screen-name-input');
}

function confirmPlayerName() {
 let nameInput = document.getElementById('input-player-name').value.trim();
 myName = nameInput !== "" ? nameInput : ("プレイヤー" + Math.floor(Math.random() * 100));
 showScreen('screen-role-select');
}

// --- 🌐 PeerJS 接続制御 ---
function setupRole(role) {
 battleRole = role;
 closeNetwork();
 myPlayerId = 'p_' + Math.random().toString(36).substr(2, 9);
 
 if (role === 'host') {
 roomCode = Math.floor(1000 + Math.random() * 9000).toString();
 document.getElementById('display-room-code').innerText = roomCode;
 playerList = [{ id: myPlayerId, name: myName, peerId: PEER_PREFIX + roomCode + '-host' }];
 updateHostPlayerListUI();
 showScreen('screen-host-wait');
 
 peer = new Peer(PEER_PREFIX + roomCode + '-host');
 peer.on('connection', (conn) => {
 conn.on('open', () => {
 connections.push(conn);
 conn.on('data', (data) => handleHostReceiveData(conn, data));
 });
 });
 } else {
 showScreen('screen-guest-join');
 }
}

function joinRoom() {
 let code = document.getElementById('input-room-code').value;
 if (code.length !== 4) {
 document.getElementById('status-message').innerText = '4桁の数字を入力してください';
 return;
 }
 roomCode = code;
 document.getElementById('status-message').innerText = '接続中...';
 
 peer = new Peer();
 peer.on('open', (id) => {
 let conn = peer.connect(PEER_PREFIX + roomCode + '-host');
 conn.on('open', () => {
 connections = [conn];
 conn.send({ type: 'join_request', id: myPlayerId, name: myName });
 showScreen('screen-guest-wait');
 });
 conn.on('data', (data) => handleGuestReceiveData(data));
 conn.on('close', () => { alert('ホストとの接続が切断されました'); returnToTitle(); });
 });
 peer.on('error', () => {
 document.getElementById('status-message').innerText = '部屋が見つかりませんでした';
 });
}

function handleHostReceiveData(conn, data) {
 if (data.type === 'join_request') {
 if (playerList.length < targetPlayerCount) {
 playerList.push({ id: data.id, name: data.name, peerId: conn.peer });
 broadcastData({ type: 'player_list_update', playerList: playerList, targetPlayerCount: targetPlayerCount });
 updateHostPlayerListUI();
 }
 } else {
 // ゲストからのゲーム内アクションを他全員にブロードキャスト
 broadcastData(data, conn);
 handleGameActionData(data);
 }
}

function handleGuestReceiveData(data) {
 if (data.type === 'player_list_update') {
 playerList = data.playerList;
 updateGuestPlayerListUI();
 } else if (data.type === 'start_order_phase') {
 startOrderPhase(data);
 } else {
 handleGameActionData(data);
 }
}

function broadcastData(data, excludeConn = null) {
 connections.forEach(c => {
 if (c.open && c !== excludeConn) c.send(data);
 });
}

function updateHostPlayerListUI() {
 let el = document.getElementById('host-player-list');
 el.innerHTML = '<b>参加メンバー (' + playerList.length + '/' + targetPlayerCount + '):</b><br>';
 playerList.forEach((p, i) => {
 el.innerHTML += `<div class="player-item">${i+1}. ${p.name} ${p.id === myPlayerId ? '(あなた)' : ''}</div>`;
 });
 let btn = document.getElementById('btn-host-start');
 if (playerList.length === targetPlayerCount) btn.style.display = 'block';
 else btn.style.display = 'none';
}

function updateGuestPlayerListUI() {
 let el = document.getElementById('guest-player-list');
 el.innerHTML = '<b>参加メンバー (' + playerList.length + '/' + targetPlayerCount + '):</b><br>';
 playerList.forEach((p, i) => {
 el.innerHTML += `<div class="player-item">${i+1}. ${p.name} ${p.id === myPlayerId ? '(あなた)' : ''}</div>`;
 });
}

function confirmHostRoomStart() {
 let data = {
 type: 'start_order_phase',
 targetPlayerCount: targetPlayerCount,
 battleType: battleType,
 targetWins: targetWins,
 playerList: playerList
 };
 broadcastData(data);
 startOrderPhase(data);
}

// --- 🎲 順番決め（じゃんけん or あみだくじ） ---
function startOrderPhase(data) {
 gameMode = 'battle';
 if (targetPlayerCount === 2) {
 openJankenScreen();
 } else {
 startAmidaPhase();
 }
}

// あみだくじのロジックと描画
let amidaLines = [];
function startAmidaPhase() {
 showScreen('screen-amida');
 let cvs = document.getElementById('amida-canvas');
 let actx = cvs.getContext('2d');
 actx.clearRect(0, 0, cvs.width, cvs.height);
 
 let num = playerList.length;
 let spacing = cvs.width / (num + 1);
 
 // あみだ線のランダム生成（ホストのみ生成して同期、または同一シードで計算）
 if (battleRole === 'host') {
 amidaLines = [];
 for (let i = 0; i < 10; i++) {
 let col = Math.floor(Math.random() * (num - 1));
 let y = 40 + Math.random() * (cvs.height - 80);
 amidaLines.push({ col: col, y: y });
 }
 broadcastData({ type: 'sync_amida', lines: amidaLines });
 }
 
 drawAmidaStructure(actx, num, spacing);
 
 if (battleRole === 'host') {
 document.getElementById('btn-amida-start').style.display = 'block';
 document.getElementById('amida-status').innerText = 'スタートボタンを押してください';
 } else {
 document.getElementById('btn-amida-start').style.display = 'none';
 document.getElementById('amida-status').innerText = 'ホストがスタートするのを待っています...';
 }
}

function drawAmidaStructure(actx, num, spacing) {
 actx.strokeStyle = '#fff';
 actx.lineWidth = 3;
 actx.font = '12px sans-serif';
 actx.fillStyle = '#ffcc00';
 actx.textAlign = 'center';
 
 for (let i = 0; i < num; i++) {
 let x = spacing * (i + 1);
 actx.beginPath();
 actx.moveTo(x, 30);
 actx.lineTo(x, 270);
 actx.stroke();
 actx.fillText(playerList[i].name.substr(0, 4), x, 20);
 }
 
 amidaLines.forEach(l => {
 let x1 = spacing * (l.col + 1);
 let x2 = spacing * (l.col + 2);
 actx.beginPath();
 actx.moveTo(x1, l.y);
 actx.lineTo(x2, l.y);
 actx.stroke();
 });
}

function startAmidaDraw() {
 if (battleRole === 'host') {
 broadcastData({ type: 'run_amida' });
 runAmidaAnimation();
 }
}

function runAmidaAnimation() {
 document.getElementById('btn-amida-start').style.display = 'none';
 document.getElementById('amida-status').innerText = '順番を計算中...';
 
 // 順番結果を計算
 let num = playerList.length;
 let results = [];
 for (let i = 0; i < num; i++) {
 let currentCol = i;
 let currentY = 30;
 
 let sortedLines = [...amidaLines].sort((a,b) => a.y - b.y);
 sortedLines.forEach(l => {
 if (l.col === currentCol) {
 currentCol++;
 } else if (l.col === currentCol - 1) {
 currentCol--;
 }
 });
 results.push({ player: playerList[i], finalRank: currentCol });
 }
 
 // 結果順に並べ替え
 results.sort((a,b) => a.finalRank - b.finalRank);
 turnOrder = results.map(r => r.player.id);
 currentTurnIndex = 0;
 
 setTimeout(() => {
 showTurnAnnouncement();
 }, 1500);
}

function showTurnAnnouncement() {
 let myRank = turnOrder.indexOf(myPlayerId) + 1;
 showScreen(''); // 画面クリアしてゲームキャンバス表示
 
 let overlay = document.createElement('div');
 overlay.style.cssText = "position:absolute; top:40%; left:50%; transform:translate(-50%,-50%); font-size:48px; font-weight:900; color:#ffcc00; text-shadow:0 0 20px #000; z-index:300; pointer-events:none;";
 overlay.innerText = `${myRank} 番手`;
 document.body.appendChild(overlay);
 
 setTimeout(() => {
 document.body.removeChild(overlay);
 initBattleGame();
 }, 2500);
}

// --- ⚔️ 対戦実行＆「おしつけ」ロジック ---
function initBattleGame() {
 gameState = 'playing';
 initGridForStage(1);
 bulletData = getRandomShooterBubble();
 nextBubble = getRandomShooterBubble();
 playRandomBGM();
 
 if (turnOrder[currentTurnIndex] === myPlayerId) {
 battleTurnState = 'my_turn';
 startTurnTimer();
 } else {
 battleTurnState = 'opponent_turn';
 }
}

function handleGameActionData(data) {
 if (data.type === 'sync_amida') {
 amidaLines = data.lines;
 let cvs = document.getElementById('amida-canvas');
 drawAmidaStructure(cvs.getContext('2d'), playerList.length, cvs.width / (playerList.length + 1));
 } else if (data.type === 'run_amida') {
 runAmidaAnimation();
 } else if (data.type === 'turn_action') {
 // 誰かが玉を消した時のお邪魔受け取り処理
 if (data.senderId !== myPlayerId) {
 let ojamaAmount = data.ojamaAmount;
 
 // 「おしつけ」アイテム処理
 if (data.oshitsukeTargetId === myPlayerId) {
 // 他人から自分へおしつけられた追加お邪魔
 ojamaAmount += data.extraOjama || 0;
 }
 
 if (oshitsukeTurnsLeft > 0 && oshitsukeTargetId) {
 // 自分が「おしつけ」発動中の場合、自分へのお邪魔をターゲットに転送
 broadcastData({
 type: 'transfer_ojama',
 targetId: oshitsukeTargetId,
 amount: ojamaAmount
 });
 ojamaAmount = 0; // 自分へのダメージ無効化
 }
 
 if (ojamaAmount > 0) {
 launchOjamaProjectiles(ojamaAmount);
 }
 }
 switchNextTurn();
 }
}

function switchNextTurn() {
 // ターン経過でおしつけのターン消化
 if (oshitsukeTurnsLeft > 0) {
 oshitsukeTurnsLeft--;
 if (oshitsukeTurnsLeft === 0) oshitsukeTargetId = null;
 }
 
 currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
 if (turnOrder[currentTurnIndex] === myPlayerId) {
 battleTurnState = 'my_turn';
 startTurnTimer();
 } else {
 battleTurnState = 'opponent_turn';
 stopTurnTimer();
 }
}

// アイテム使用：おしつけ
function useOshitsukeItem() {
 if (itemStockCounts[4] <= 0) return;
 
 let modal = document.getElementById('modal-target-select');
 let container = document.getElementById('target-player-buttons');
 container.innerHTML = '';
 
 playerList.forEach(p => {
 if (p.id !== myPlayerId) {
 let btn = document.createElement('button');
 btn.className = 'menu-btn sub';
 btn.innerText = p.name;
 btn.onclick = () => {
 oshitsukeTargetId = p.id;
 oshitsukeTurnsLeft = playerList.length * 2; // 全員のターンが2周分終了するまで
 itemStockCounts[4]--;
 modal.style.display = 'none';
 alert(`${p.name} に「おしつけ」を発動しました！`);
 };
 container.appendChild(btn);
 }
 });
 modal.style.display = 'flex';
}

function closeNetwork() {
 connections.forEach(c => { try { c.close(); } catch(e) {} });
 connections = [];
 if (peer) { try { peer.disconnect(); peer.destroy(); } catch(e) {} peer = null; }
}

function returnToTitle() {
 closeNetwork();
 gameState = 'title';
 showScreen('screen-title');
}

// --- 以下、既存のバブル計算・物理演算・描画ループ（一部保持） ---
function initGridForStage(stage) {
 grid = [];
 fallingBubbles = [];
 flashingBubbles = [];
 flyingOjamaList = [];
 itemStockCounts = [0, 0, 0, 0, 0];
 activeItems = [];
 myClearedBubbleCount = 0;
 
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

function getRandomGridCell() {
 let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
 let isMystery = Math.random() < 0.11;
 return { color: color, isojama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
 return {
 color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
 isojama: false,
 isMystery: false
 };
}

function startSinglePlay() {
 closeNetwork();
 gameMode = 'single';
 gameState = 'playing';
 score = 0;
 currentStage = 1;
 initGridForStage(currentStage);
 bulletData = getRandomShooterBubble();
 nextBubble = getRandomShooterBubble();
 playRandomBGM();
 showScreen('');
}

function startTurnTimer() {
 stopTurnTimer();
 turnRemainingTime = TURN_TIME_LIMIT;
 turnTimerInterval = setInterval(() => {
 if (gameState === 'playing' && battleTurnState === 'my_turn') {
 turnRemainingTime--;
 if (turnRemainingTime <= 0) {
 stopTurnTimer();
 forceTimeoutTurnEnd();
 }
 }
 }, 1000);
}

function stopTurnTimer() {
 if (turnTimerInterval) { clearInterval(turnTimerInterval); turnTimerInterval = null; }
}

function forceTimeoutTurnEnd() {
 isMoving = false;
 switchNextTurn();
}

function launchOjamaProjectiles(amount) {
 // 画面上部からお邪魔玉を落下・グリッド追加する簡易演出
 for (let i = 0; i < amount; i++) {
 let r = Math.floor(Math.random() * 2);
 let c = Math.floor(Math.random() * COLS);
 if (!grid[r][c]) grid[r][c] = { color: '#888', isojama: true, isMystery: false };
 }
}

// 描画ループの呼び出し
function gameLoop() {
 ctx.clearRect(0, 0, canvas.width, canvas.height);
 if (gameState === 'playing') {
 // バブルやグリッドの描画処理
 }
 requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
