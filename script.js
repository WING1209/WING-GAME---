// ==========================================
// 1. グローバル定数・変数定義
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PEER_PREFIX = 'bomber-game-v2026-room-';

const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';

let gameState = 'title';
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let myPlayerId = 0;
let maxPlayers = 2;
let targetWins = 1;
let ojamaMultiplier = 1;

let peer = null;
let guestConn = null;
let hostConnections = [];

let players = []; 
let readyCount = 0;

let rouletteState = 'idle';
let myOrderNum = 0;
let rouletteInterval = null;

let battleTurnState = 'waiting'; 
let currentTurnPlayerId = 0;
let grid = [];

let shooterX = 180;
let shooterY = 570;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;
let bulletData = null;
let nextBubble = null;
let isMoving = false;
const MAX_SPEED = 18;

// ==========================================
// 2. 画面制御 & 通信
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
    if (screenId) {
        let el = document.getElementById(screenId);
        if (el) el.style.display = 'flex';
    }
}

function selectMainMenu(choice) {
    closeNetwork();
    if (choice === 'host') {
        battleRole = 'host';
        showScreen('screen-host-config');
    } else if (choice === 'guest') {
        battleRole = 'guest';
        document.getElementById('guest-status-msg').innerText = '';
        showScreen('screen-guest-join');
    }
}

function closeNetwork() {
    if (guestConn) { try { guestConn.close(); } catch(e){} guestConn = null; }
    hostConnections.forEach(c => { try { c.close(); } catch(e){} });
    hostConnections = [];
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
}

function confirmHostSettings() {
    maxPlayers = parseInt(document.getElementById('select-max-players').value);
    targetWins = parseInt(document.getElementById('select-target-wins').value);
    ojamaMultiplier = parseInt(document.getElementById('select-ojama-mult').value);

    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('host-wait-status').innerText = "サーバー接続中...";
    showScreen('screen-host-wait');

    peer = new Peer(PEER_PREFIX + roomCode);
    players = [{ id: 0, name: '', order: 0, wins: 0 }];
    myPlayerId = 0;

    peer.on('open', () => updateHostWaitStatus());

    peer.on('connection', (conn) => {
        let assignedId = players.length;
        if (assignedId >= maxPlayers) { conn.close(); return; }

        hostConnections.push(conn);
        players.push({ id: assignedId, name: '', order: 0, wins: 0 });

        conn.on('open', () => {
            conn.send({ type: 'init_guest', playerId: assignedId, maxPlayers: maxPlayers, ojamaMult: ojamaMultiplier, players: players });
            updateHostWaitStatus();
            if (players.length === maxPlayers) {
                broadcastHost({ type: 'start_name_input', players: players });
                showScreen('screen-name-input');
            }
        });

        conn.on('data', (data) => handleHostReceiveData(assignedId, data));
    });
}

function updateHostWaitStatus() {
    let el = document.getElementById('host-wait-status');
    if (el) el.innerText = `参加者待機中... (${players.length}/${maxPlayers})`;
}

function joinRoom() {
    let code = document.getElementById('input-room-code').value.trim();
    let statusMsg = document.getElementById('guest-status-msg');

    if (code.length !== 4) { statusMsg.innerText = "4桁の数字を入力してください"; return; }
    roomCode = code;
    statusMsg.innerText = "接続中...";

    peer = new Peer();
    peer.on('open', () => {
        guestConn = peer.connect(PEER_PREFIX + roomCode);
        guestConn.on('open', () => { statusMsg.innerText = "接続成功！ホストの操作を待っています..."; });
        guestConn.on('data', handleGuestReceiveData);
    });
}

function broadcastHost(data) {
    hostConnections.forEach(c => { if (c && c.open) c.send(data); });
}

function handleHostReceiveData(fromId, data) {
    if (data.type === 'submit_name') {
        let p = players.find(item => item.id === fromId);
        if (p) p.name = data.name;
        broadcastHost({ type: 'sync_players', players: players });
        checkAllNamesSubmitted();
    } else if (data.type === 'ready_start') {
        readyCount++;
        if (readyCount === maxPlayers) {
            broadcastHost({ type: 'game_start_signal', players: players });
            launchGameStartNotice();
        }
    }
}

function handleGuestReceiveData(data) {
    if (data.type === 'init_guest') {
        myPlayerId = data.playerId;
        maxPlayers = data.maxPlayers;
        if (data.players) players = data.players;
    } else if (data.type === 'start_name_input') {
        if (data.players) players = data.players;
        showScreen('screen-name-input');
    } else if (data.type === 'start_roulette') {
        players = data.players;
        showScreen('screen-roulette');
        startRouletteAnimation();
    } else if (data.type === 'game_start_signal') {
        if (data.players) players = data.players;
        launchGameStartNotice();
    }
}

// ==========================================
// 3. ルーレット・スタート進行
// ==========================================
function submitPlayerName() {
    let inputName = document.getElementById('input-player-name').value.trim();
    if (!inputName) inputName = "P" + (myPlayerId + 1);

    let myP = players.find(p => p.id === myPlayerId);
    if (myP) myP.name = inputName;

    document.getElementById('name-wait-msg').innerText = "他のプレイヤーの入力を待っています...";

    if (battleRole === 'host') {
        checkAllNamesSubmitted();
    } else if (guestConn && guestConn.open) {
        guestConn.send({ type: 'submit_name', name: inputName });
    }
}

function checkAllNamesSubmitted() {
    if (players.length < maxPlayers) return;
    if (players.every(p => p.name && p.name.trim() !== '')) {
        let orders = Array.from({length: maxPlayers}, (_, i) => i + 1).sort(() => Math.random() - 0.5);
        players.forEach((p, idx) => p.order = orders[idx]);

        broadcastHost({ type: 'start_roulette', players: players });
        showScreen('screen-roulette');
        startRouletteAnimation();
    }
}

function startRouletteAnimation() {
    rouletteState = 'running';
    let disp = document.getElementById('roulette-display');
    let count = 1;
    rouletteInterval = setInterval(() => {
        disp.innerText = count;
        count = (count % maxPlayers) + 1;
    }, 80);
}

function handleRouletteTap() {
    let btn = document.getElementById('btn-roulette-action');
    if (rouletteState === 'running') {
        clearInterval(rouletteInterval);
        rouletteState = 'stopped';
        let myP = players.find(p => p.id === myPlayerId);
        myOrderNum = myP ? myP.order : 1;
        document.getElementById('roulette-display').innerText = "停止！";
        document.getElementById('my-order-result').innerText = `あなたは ${myOrderNum} 番手です`;
        btn.innerText = "ゲーム開始準備";
    } else if (rouletteState === 'stopped') {
        rouletteState = 'ready_wait';
        btn.innerText = "準備完了！";
        if (battleRole === 'host') {
            readyCount++;
            if (readyCount === maxPlayers) {
                broadcastHost({ type: 'game_start_signal', players: players });
                launchGameStartNotice();
            }
        } else if (guestConn && guestConn.open) {
            guestConn.send({ type: 'ready_start' });
        }
    }
}

function launchGameStartNotice() {
    showScreen(''); // オーバーレイ画面を完全に隠す
    document.getElementById('game-ui').style.display = 'block';
    gameState = 'playing';

    // フィールドと弾の生成
    initGridForBattle();
    bulletData = null;
    spawnBullet();

    let firstPlayer = players.find(p => p && p.order === 1);
    currentTurnPlayerId = firstPlayer ? firstPlayer.id : 0;
    battleTurnState = (myPlayerId === currentTurnPlayerId) ? 'my_turn' : 'opponent_turn';

    let notice = document.createElement('div');
    notice.style.cssText = "position:absolute; top:40%; left:50%; transform:translate(-50%, -50%); font-size:32px; font-weight:900; color:#ffcc00; text-shadow:0 0 10px #000; z-index:200; pointer-events:none;";
    notice.innerText = "ゲームスタート！";
    document.getElementById('game-container').appendChild(notice);

    setTimeout(() => notice.remove(), 2000);
}

// ==========================================
// 4. パズルゲームエンジン & 描画処理
// ==========================================
function getRandomGridCell() {
    return { color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)], isMystery: Math.random() < 0.11 };
}

function getRandomShooterBubble() {
    if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW };
    return { color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)] };
}

function initGridForBattle() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }
    // 上部 5 行へ確実に初期ブロック（玉）を投入
    for (let r = 0; r < 5; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            grid[r][c] = getRandomGridCell();
        }
    }
}

function spawnBullet() {
    bulletData = bulletData ? nextBubble : getRandomShooterBubble();
    nextBubble = getRandomShooterBubble();

    shooterX = 180;
    shooterY = 570;
    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    isMoving = false;
}

// 発射タッチイベント
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

let touchStartX = 0, touchStartY = 0;

function handleTouchStart(e) {
    if (gameState !== 'playing' || isMoving) return;
    e.preventDefault();
    let touch = e.touches[0];
    let rect = canvas.getBoundingClientRect();
    touchStartX = touch.clientX - rect.left;
    touchStartY = touch.clientY - rect.top;
}

function handleTouchEnd(e) {
    if (gameState !== 'playing' || isMoving) return;
    e.preventDefault();
    let touch = e.changedTouches[0];
    let rect = canvas.getBoundingClientRect();
    let dx = touchStartX - (touch.clientX - rect.left);
    let dy = touchStartY - (touch.clientY - rect.top);

    if (dy > 20) {
        let angle = Math.atan2(dx, dy);
        bulletVX = Math.sin(angle) * MAX_SPEED;
        bulletVY = -Math.cos(angle) * MAX_SPEED;
        isMoving = true;
    }
}

function useItemOshitsuke() { alert("相手にお邪魔玉を送信しました！"); }
function useItemForceShoot() { alert("相手を強制発射させました！"); }
function useItemDefense() { alert("ガードを発動しました！"); }

// メイン描画ループ
function gameLoop() {
    // 画面クリア
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing') {
        // 1. 上部の玉グリッド描画
        for (let r = 0; r < ROWS; r++) {
            if (!grid[r]) continue;
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            let rowXOffset = (r % 2 === 0) ? RADIUS : RADIUS * 2;

            for (let c = 0; c < colsInRow; c++) {
                let cell = grid[r][c];
                if (cell) {
                    let cx = rowXOffset + c * DIAMETER;
                    let cy = RADIUS + r * ROW_HEIGHT;

                    ctx.beginPath();
                    ctx.arc(cx, cy, RADIUS - 1, 0, Math.PI * 2);
                    ctx.fillStyle = (cell.color === SPECIAL_RAINBOW) ? '#ffffff' : cell.color;
                    ctx.fill();
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        // 2. 移動中の玉処理
        if (isMoving && bulletData) {
            bulletX += bulletVX;
            bulletY += bulletVY;
            if (bulletX - RADIUS < 0 || bulletX + RADIUS > canvas.width) bulletVX = -bulletVX;
            if (bulletY - RADIUS < 0) {
                isMoving = false;
                spawnBullet();
            }
        }

        // 3. 発射台の玉を描画
        if (bulletData) {
            ctx.beginPath();
            ctx.arc(bulletX, bulletY, RADIUS - 1, 0, Math.PI * 2);
            ctx.fillStyle = (bulletData.color === SPECIAL_RAINBOW) ? '#ffffff' : bulletData.color;
            ctx.fill();
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // 4. 次の控え玉を描画
        if (nextBubble) {
            ctx.beginPath();
            ctx.arc(35, 605, RADIUS * 0.75, 0, Math.PI * 2);
            ctx.fillStyle = (nextBubble.color === SPECIAL_RAINBOW) ? '#ffffff' : nextBubble.color;
            ctx.fill();
            ctx.strokeStyle = '#888888';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // ターンガイドのテキスト
        ctx.fillStyle = (battleTurnState === 'my_turn') ? '#4dff4d' : '#ff4d4d';
        ctx.font = 'bold 14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((battleTurnState === 'my_turn') ? "YOUR TURN (上方向スワイプで発射)" : "WAITING...", 180, 630);
    }

    requestAnimationFrame(gameLoop);
}

// 起動時に描画ループを確実にスタート
requestAnimationFrame(gameLoop);
