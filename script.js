// ==========================================
// 1. 初期設定・キャンバス定義
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PEER_PREFIX = 'bomber-game-v2026-room-';

// フィールド定数
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const UNBREAKABLE_COLOR = '#fff';
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

// ゲーム・対戦状態
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

let players = []; // { id, name, order, wins, oshitsukeTarget, forceShoot, isShield }
let readyCount = 0;

let rouletteState = 'idle';
let myOrderNum = 0;
let rouletteInterval = null;

// ターン・ゲーム盤面状態
let battleTurnState = 'waiting'; // 'my_turn', 'opponent_turn', etc.
let currentTurnPlayerId = 0;
let grid = [];
let myClearedBubbleCount = 0;

// 発射台・物理パラメータ
let shooterX = canvas.width / 2;
let shooterY = canvas.height - 70;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;
let bulletData = null;
let nextBubble = null;
let isMoving = false;
const MAX_SPEED = 18;

// ==========================================
// 2. 画面制御 & ネットワーク閉鎖
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
    } else if (choice === 'exit') {
        alert("ゲームを終了します");
    }
}

function closeNetwork() {
    if (guestConn) {
        try { guestConn.close(); } catch(e){}
        guestConn = null;
    }
    hostConnections.forEach(c => {
        try { c.close(); } catch(e){}
    });
    hostConnections = [];
    if (peer) {
        try { peer.destroy(); } catch(e){}
        peer = null;
    }
}

// ==========================================
// 3. PeerJS 通信処理
// ==========================================
function confirmHostSettings() {
    maxPlayers = parseInt(document.getElementById('select-max-players').value);
    targetWins = parseInt(document.getElementById('select-target-wins').value);
    ojamaMultiplier = parseInt(document.getElementById('select-ojama-mult').value);

    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('host-wait-status').innerText = "サーバーに接続中...";
    showScreen('screen-host-wait');

    peer = new Peer(PEER_PREFIX + roomCode);

    players = [{ id: 0, name: '', order: 0, wins: 0, oshitsukeTarget: null, forceShoot: false, isShield: false }];
    myPlayerId = 0;

    peer.on('open', () => {
        updateHostWaitStatus();
    });

    peer.on('connection', (conn) => {
        let assignedId = players.length;
        if (assignedId >= maxPlayers) {
            conn.close();
            return;
        }

        hostConnections.push(conn);
        players.push({ id: assignedId, name: '', order: 0, wins: 0, oshitsukeTarget: null, forceShoot: false, isShield: false });

        conn.on('open', () => {
            conn.send({ 
                type: 'init_guest', 
                playerId: assignedId, 
                maxPlayers: maxPlayers, 
                ojamaMult: ojamaMultiplier,
                players: players
            });
            updateHostWaitStatus();

            if (players.length === maxPlayers) {
                broadcastHost({ type: 'start_name_input', players: players });
                showScreen('screen-name-input');
            }
        });

        conn.on('data', (data) => handleHostReceiveData(assignedId, data));

        conn.on('close', () => {
            hostConnections = hostConnections.filter(c => c !== conn);
        });
    });

    peer.on('error', () => {
        alert("接続エラーが発生しました。再度お試しください。");
        showScreen('screen-title');
    });
}

function updateHostWaitStatus() {
    let el = document.getElementById('host-wait-status');
    if (el) el.innerText = `参加者を待っています... (${players.length}/${maxPlayers})`;
}

function joinRoom() {
    let codeInput = document.getElementById('input-room-code');
    let code = codeInput ? codeInput.value.trim() : '';
    let statusMsg = document.getElementById('guest-status-msg');

    if (code.length !== 4) {
        statusMsg.innerText = "4桁の数字を入力してください";
        return;
    }

    roomCode = code;
    statusMsg.innerText = "接続中...";

    peer = new Peer();

    peer.on('open', () => {
        guestConn = peer.connect(PEER_PREFIX + roomCode);

        guestConn.on('open', () => {
            statusMsg.innerText = "接続成功！ホストの操作を待っています...";
        });

        guestConn.on('data', handleGuestReceiveData);

        guestConn.on('error', () => {
            statusMsg.innerText = "接続エラーが発生しました";
        });

        guestConn.on('close', () => {
            alert("通信が切断されました");
            showScreen('screen-title');
        });
    });

    peer.on('error', () => {
        statusMsg.innerText = "部屋が見つかりません";
    });
}

function broadcastHost(data) {
    hostConnections.forEach(c => {
        if (c && c.open) c.send(data);
    });
}

// ==========================================
// 4. データ通信受信処理
// ==========================================
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
    } else if (data.type === 'action_use_item') {
        processItemEffect(fromId, data.itemType, data.targetId);
    }
}

function handleGuestReceiveData(data) {
    if (data.type === 'init_guest') {
        myPlayerId = data.playerId;
        maxPlayers = data.maxPlayers;
        ojamaMultiplier = data.ojamaMult;
        if (data.players) players = data.players;
    } else if (data.type === 'start_name_input') {
        if (data.players) players = data.players;
        showScreen('screen-name-input');
    } else if (data.type === 'sync_players') {
        if (data.players) players = data.players;
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
// 5. 名前入力・ルーレット・ゲーム開始
// ==========================================
function submitPlayerName() {
    let inputName = document.getElementById('input-player-name').value.trim();
    if (!inputName) inputName = "P" + (myPlayerId + 1);
    if (inputName.length > 6) inputName = inputName.substring(0, 6);

    document.getElementById('my-player-name').innerText = inputName;
    
    let myP = players.find(p => p.id === myPlayerId);
    if (myP) myP.name = inputName;

    document.getElementById('name-wait-msg').innerText = "他のプレイヤーの入力を待っています...";

    if (battleRole === 'host') {
        checkAllNamesSubmitted();
    } else {
        if (guestConn && guestConn.open) {
            guestConn.send({ type: 'submit_name', name: inputName });
        }
    }
}

function checkAllNamesSubmitted() {
    if (players.length < maxPlayers) return;

    let allFilled = players.every(p => p.name && p.name.trim() !== '');
    if (allFilled) {
        let orders = Array.from({length: maxPlayers}, (_, i) => i + 1);
        orders.sort(() => Math.random() - 0.5);

        players.forEach((p, idx) => p.order = orders[idx]);

        broadcastHost({ type: 'start_roulette', players: players });
        showScreen('screen-roulette');
        startRouletteAnimation();
    }
}

function startRouletteAnimation() {
    rouletteState = 'running';
    let disp = document.getElementById('roulette-display');
    let btn = document.getElementById('btn-roulette-action');
    btn.innerText = "タップしてストップ";

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
        document.getElementById('my-order-result').innerText = `あなたは ${myOrderNum} 番です`;

        btn.innerText = "ゲーム開始準備";
    } else if (rouletteState === 'stopped') {
        rouletteState = 'ready_wait';
        btn.innerText = "準備完了！(待機中)";
        btn.style.background = "#555";

        if (battleRole === 'host') {
            readyCount++;
            if (readyCount === maxPlayers) {
                broadcastHost({ type: 'game_start_signal', players: players });
                launchGameStartNotice();
            }
        } else {
            if (guestConn && guestConn.open) {
                guestConn.send({ type: 'ready_start' });
            }
        }
    }
}

function launchGameStartNotice() {
    showScreen('');
    gameState = 'playing';

    // ゲーム盤面および弾の初期化
    initGridForBattle();
    spawnBullet();

    // 順番が1番のプレイヤーのターンからスタート
    let firstPlayer = players.find(p => p.order === 1);
    currentTurnPlayerId = firstPlayer ? firstPlayer.id : 0;
    
    if (myPlayerId === currentTurnPlayerId) {
        battleTurnState = 'my_turn';
    } else {
        battleTurnState = 'opponent_turn';
    }

    let notice = document.createElement('div');
    notice.style.cssText = "position:fixed; top:40%; left:50%; transform:translate(-50%, -50%); font-size:36px; font-weight:900; color:#ffcc00; text-shadow:0 0 15px #000; z-index:1000; pointer-events:none;";
    notice.innerText = "ゲームスタート！";
    document.body.appendChild(notice);

    setTimeout(() => notice.remove(), 2000);
}

// ==========================================
// 6. グリッド初期化 & 弾の生成 (ゲーム基盤)
// ==========================================
function getRandomGridCell() {
    let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
    let isMystery = Math.random() < 0.11;
    return { color: color, isojama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
    if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW, isojama: false, isMystery: false };
    return {
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
        isojama: false,
        isMystery: false
    };
}

function initGridForBattle() {
    grid = [];
    myClearedBubbleCount = 0;

    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }

    // 上部4行に初期の玉を生成
    for (let r = 0; r < 4; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (Math.random() < 0.8) {
                grid[r][c] = getRandomGridCell();
            }
        }
    }
}

function spawnBullet() {
    if (!bulletData) {
        bulletData = getRandomShooterBubble();
    } else {
        bulletData = nextBubble;
    }
    nextBubble = getRandomShooterBubble();

    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    isMoving = false;
}

// ==========================================
// 7. 発射・タッチ操作イベント
// ==========================================
canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
canvas.addEventListener('touchend', handleTouchEnd, { passive: false });

let isDragging = false;
let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(e) {
    if (gameState !== 'playing' || battleTurnState !== 'my_turn' || isMoving) return;
    e.preventDefault();
    let touch = e.touches[0];
    let rect = canvas.getBoundingClientRect();
    touchStartX = touch.clientX - rect.left;
    touchStartY = touch.clientY - rect.top;
    isDragging = true;
}

function handleTouchMove(e) {
    if (!isDragging) return;
    e.preventDefault();
}

function handleTouchEnd(e) {
    if (!isDragging || isMoving) return;
    isDragging = false;
    e.preventDefault();

    let touch = e.changedTouches[0];
    let rect = canvas.getBoundingClientRect();
    let endX = touch.clientX - rect.left;
    let endY = touch.clientY - rect.top;

    let dx = touchStartX - endX;
    let dy = touchStartY - endY;

    if (dy > 20) { // 上方向へのスワイプで発射
        let angle = Math.atan2(dx, dy);
        bulletVX = Math.sin(angle) * MAX_SPEED;
        bulletVY = -Math.cos(angle) * MAX_SPEED;
        isMoving = true;
    }
}

// ==========================================
// 8. 新アイテム機能 & 描画ループ
// ==========================================
function useItemOshitsuke() {
    let targetId = promptPlayerSelect("おしつける相手の番号を入力してください:");
    if (targetId !== null) sendItemAction(1, targetId);
}

function useItemForceShoot() {
    let targetId = promptPlayerSelect("強制発射させる相手の番号を入力してください:");
    if (targetId !== null) sendItemAction(2, targetId);
}

function useItemDefense() {
    sendItemAction(3, myPlayerId);
}

function promptPlayerSelect(msg) {
    let options = players
        .filter(p => p.id !== myPlayerId)
        .map(p => `[${p.id}] ${p.name}`)
        .join("\n");
    let res = prompt(`${msg}\n${options}`);
    let id = parseInt(res);
    return isNaN(id) ? null : id;
}

function sendItemAction(itemType, targetId) {
    if (battleRole === 'host') {
        processItemEffect(myPlayerId, itemType, targetId);
    } else {
        if (guestConn && guestConn.open) {
            guestConn.send({ type: 'action_use_item', itemType: itemType, targetId: targetId });
        }
    }
}

function processItemEffect(fromId, itemType, targetId) {
    let p = players.find(item => item.id === fromId);
    let targetP = players.find(item => item.id === targetId);

    if (itemType === 1 && p) p.oshitsukeTarget = targetId;
    else if (itemType === 2 && targetP) targetP.forceShoot = true;
    else if (itemType === 3 && p) p.isShield = true;

    broadcastHost({ type: 'sync_player_states', players: players });
}

// 描画メインループ
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'playing') {
        // 1. グリッド（配置されている玉）の描画
        for (let r = 0; r < ROWS; r++) {
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            let rowXOffset = (r % 2 === 0) ? RADIUS : RADIUS * 2;

            for (let c = 0; c < colsInRow; c++) {
                let cell = grid[r][c];
                if (cell) {
                    let cx = rowXOffset + c * DIAMETER;
                    let cy = RADIUS + r * ROW_HEIGHT;

                    ctx.beginPath();
                    ctx.arc(cx, cy, RADIUS - 1, 0, Math.PI * 2);
                    ctx.fillStyle = (cell.color === SPECIAL_RAINBOW) ? '#fff' : cell.color;
                    ctx.fill();
                    ctx.strokeStyle = '#000';
                    ctx.stroke();

                    if (cell.isMystery) {
                        ctx.fillStyle = '#000';
                        ctx.font = 'bold 16px sans-serif';
                        ctx.textAlign = 'center';
                        ctx.textBaseline = 'middle';
                        ctx.fillText('?', cx, cy);
                    }
                }
            }
        }

        // 2. 移動中の玉の更新と描画
        if (isMoving) {
            bulletX += bulletVX;
            bulletY += bulletVY;

            // 壁でのバウンド
            if (bulletX - RADIUS < 0 || bulletX + RADIUS > canvas.width) {
                bulletVX = -bulletVX;
            }

            // 天井到達または上限で停止
            if (bulletY - RADIUS < 0) {
                isMoving = false;
                spawnBullet();
            }
        }

        // 3. 発射台の玉を描画
        if (bulletData) {
            ctx.beginPath();
            ctx.arc(bulletX, bulletY, RADIUS - 1, 0, Math.PI * 2);
            ctx.fillStyle = (bulletData.color === SPECIAL_RAINBOW) ? '#fff' : bulletData.color;
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.stroke();
        }

        // 4. 控えの玉を描画
        if (nextBubble) {
            ctx.beginPath();
            ctx.arc(30, canvas.height - 30, RADIUS * 0.7, 0, Math.PI * 2);
            ctx.fillStyle = (nextBubble.color === SPECIAL_RAINBOW) ? '#fff' : nextBubble.color;
            ctx.fill();
            ctx.strokeStyle = '#888';
            ctx.stroke();
        }

        // 手番表示テキスト
        ctx.fillStyle = (battleTurnState === 'my_turn') ? '#4dff4d' : '#ff4d4d';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText((battleTurnState === 'my_turn') ? "YOUR TURN" : "WAITING...", canvas.width / 2, canvas.height - 15);
    }

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);
