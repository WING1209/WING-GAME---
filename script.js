const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// BGM & SE
const audioPath = 'audio/';
const se = {
    ballShoot: new Audio(`${audioPath}se/se_ball_shoot.wav`),
    ballLand: new Audio(`${audioPath}se/se_ball_land.wav`),
    bombExplode: new Audio(`${audioPath}se/se_bomb_explode.wav`),
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

// ゲーム定数・変数
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#f14dda'];
const OJAMA_COLOR = '#888888';

let grid = [];
let score = 0;
let gameState = 'title';

// 対戦設定
let battleRole = '';
let roomCode = '';
let gameMenu = 'お邪魔対戦';
let maxPlayers = 2;
let targetWins = 1;

// プレイヤー管理
let myPlayerId = '';
let myPlayerName = 'プレイヤー';
let players = [];
let mySeatOrder = 0;

// ターン管理
let turnOrderList = [];
let currentTurnIndex = 0;
let turnRemainingTime = 15;
let turnTimerInterval = null;

// アイテム（3人以上専用：「おしつけ」）
let ositsukeTurnsLeft = 0;

// シューター・発射玉
let shooterX = canvas.width / 2;
let shooterY = canvas.height - 50;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;
let bulletColor = getRandomColor();
let nextBulletColor = getRandomColor();

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let pullX = 0;
let pullY = 0;

let isMoving = false;
let shakeTimer = 0;
let flyingOjamaList = [];

// 中央アナウンス
let centerNoticeText = "";
let centerNoticeTimer = 0;

// 通信用
let peer = null;
let hostConn = null;
let guestConns = [];
const PEER_PREFIX = 'pb-wing-multi-2026-v8-';

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

function getRandomColor() {
    return BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
}

// ホスト設定GUI
function setHostGameMenu(menu) {
    gameMenu = menu;
    document.getElementById('btn-menu-ta').className = menu === 'タイムアタック' ? 'menu-btn sub' : 'menu-btn gray';
    document.getElementById('btn-menu-ojama').className = menu === 'お邪魔対戦' ? 'menu-btn sub' : 'menu-btn gray';
    let group = document.getElementById('setting-group-players');
    if (group) group.style.display = (menu === 'お邪魔対戦') ? 'block' : 'none';
}

function setHostMaxPlayers(num) {
    maxPlayers = num;
    for (let i = 2; i <= 5; i++) {
        let btn = document.getElementById(`btn-p-${i}`);
        if (btn) btn.className = (i === num) ? 'menu-btn sub' : 'menu-btn gray';
    }
}

function setHostTargetWins(wins) {
    targetWins = wins;
    document.getElementById('btn-win-1').className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
    document.getElementById('btn-win-2').className = wins === 2 ? 'menu-btn' : 'menu-btn gray';
}

function setupRole(role) {
    battleRole = role;
    closeNetwork();
    if (role === 'host') {
        gameMenu = 'お邪魔対戦';
        maxPlayers = 2;
        targetWins = 1;
        setHostGameMenu('お邪魔対戦');
        setHostMaxPlayers(2);
        setHostTargetWins(1);
        showScreen('screen-host-settings');
    } else {
        showScreen('screen-guest-join');
        document.getElementById('status-message').innerText = '';
    }
}

function confirmHostSettings() {
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    
    myPlayerId = 'host_' + Math.random().toString(36).substr(2, 6);
    players = [{ id: myPlayerId, name: 'ホスト', wins: 0, seatOrder: -1, isAlive: true }];
    
    updateHostWaitUI();
    showScreen('screen-host-wait');

    peer = new Peer(PEER_PREFIX + roomCode);
    peer.on('connection', (c) => {
        if (players.length >= maxPlayers) {
            c.on('open', () => { c.send({ type: 'room_full' }); c.close(); });
            return;
        }
        guestConns.push({ id: c.peer, conn: c });
        setupHostConnection(c);
    });
    peer.on('error', () => {
        alert('ルーム作成に失敗しました。');
    });
}

function updateHostWaitUI() {
    document.getElementById('room-members-count').innerText = `参加人数: ${players.length} / ${maxPlayers}名`;
    let startBtn = document.getElementById('btn-host-start-game');
    if (players.length >= maxPlayers && gameMenu === 'お邪魔対戦') {
        startBtn.style.display = 'block';
    } else if (gameMenu === 'タイムアタック' && players.length >= 2) {
        startBtn.style.display = 'block';
    } else {
        startBtn.style.display = 'none';
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
    peer.on('open', (id) => {
        myPlayerId = 'guest_' + id.substr(0, 6);
        hostConn = peer.connect(PEER_PREFIX + roomCode);
        setupGuestConnection(hostConn);
    });
    peer.on('error', () => {
        document.getElementById('status-message').innerText = '部屋が見つからないか接続に失敗しました';
    });
}

function setupHostConnection(c) {
    c.on('open', () => {
        c.send({ type: 'welcome_settings', gameMenu: gameMenu, maxPlayers: maxPlayers, targetWins: targetWins, players: players });
    });
    c.on('data', (data) => {
        if (data.type === 'join_request') {
            players.push(data.player);
            broadcastToAllGuests({ type: 'update_players', players: players });
            updateHostWaitUI();
            if (players.length >= maxPlayers) {
                setTimeout(() => startNameInputPhase(), 500);
            }
        } else if (data.type === 'submit_name') {
            let p = players.find(x => x.id === data.id);
            if (p) p.name = data.name;
            broadcastToAllGuests({ type: 'update_players', players: players });
            checkAllNamesSubmitted();
        } else if (data.type === 'submit_roulette') {
            let p = players.find(x => x.id === data.id);
            if (p) p.seatOrder = data.seatOrder;
            checkAllRouletteSubmitted();
        } else if (data.type === 'sync_turn_action') {
            broadcastToAllGuests(data);
            executeActionOnHost(data);
        }
    });
    c.on('close', () => {
        guestConns = guestConns.filter(item => item.conn !== c);
    });
}

function setupGuestConnection(c) {
    c.on('data', (data) => {
        if (data.type === 'room_full') {
            alert('ルームが満員です。');
            showScreen('screen-guest-join');
        } else if (data.type === 'welcome_settings') {
            gameMenu = data.gameMenu;
            maxPlayers = data.maxPlayers;
            targetWins = data.targetWins;
            players = data.players;
            c.send({ type: 'join_request', player: { id: myPlayerId, name: 'ゲスト', wins: 0, seatOrder: -1, isAlive: true } });
            showScreen('screen-guest-wait');
        } else if (data.type === 'update_players') {
            players = data.players;
        } else if (data.type === 'start_name_input') {
            showScreen('screen-name-input');
        } else if (data.type === 'start_roulette') {
            players = data.players;
            openRoulettePhase();
        } else if (data.type === 'start_battle') {
            turnOrderList = data.turnOrderList;
            startBattleGameLoop();
        } else if (data.type === 'sync_turn_action') {
            executeOpponentAction(data);
        } else if (data.type === 'next_turn') {
            currentTurnIndex = data.currentTurnIndex;
            turnOrderList = data.turnOrderList;
            startTurnTimer();
        }
    });
    c.on('close', () => {
        alert('ホストとの接続が切断されました。');
        returnToTitle();
    });
}

function broadcastToAllGuests(data) {
    guestConns.forEach(item => {
        if (item.conn && item.conn.open) item.conn.send(data);
    });
}

function sendToServer(data) {
    if (battleRole !== 'host' && hostConn && hostConn.open) {
        hostConn.send(data);
    }
}

function closeNetwork() {
    if (hostConn) { try { hostConn.close(); } catch(e) {} hostConn = null; }
    guestConns.forEach(item => { try { item.conn.close(); } catch(e) {} });
    guestConns = [];
    if (peer) {
        try { peer.disconnect(); peer.destroy(); } catch(e) {}
        peer = null;
    }
}

function returnToTitle() {
    closeNetwork();
    stopBGM();
    stopTurnTimer();
    gameState = 'title';
    showScreen('screen-title');
}

function startNameInputPhase() {
    if (battleRole === 'host') {
        broadcastToAllGuests({ type: 'start_name_input' });
        showScreen('screen-name-input');
    }
}

function submitPlayerName() {
    let nameVal = document.getElementById('input-player-name').value.trim();
    if (nameVal) myPlayerName = nameVal;
    
    let p = players.find(x => x.id === myPlayerId);
    if (p) p.name = myPlayerName;

    if (battleRole === 'host') {
        checkAllNamesSubmitted();
    } else {
        sendToServer({ type: 'submit_name', id: myPlayerId, name: myPlayerName });
        showScreen('screen-name-wait');
        document.getElementById('name-wait-status').innerText = '他のプレイヤーの名前入力を待っています...';
    }
}

function checkAllNamesSubmitted() {
    let allReady = players.every(p => p.name && p.name !== '');
    if (allReady && battleRole === 'host') {
        broadcastToAllGuests({ type: 'start_roulette', players: players });
        openRoulettePhase();
    }
}

function openRoulettePhase() {
    let container = document.getElementById('roulette-overlay');
    if (!container) {
        createRouletteOverlayDOM();
    }
    document.getElementById('roulette-overlay').style.display = 'flex';
    document.getElementById('roulette-result-text').innerText = 'ボタンを押して順番を決定！';
    document.getElementById('btn-spin-roulette').style.display = 'block';
}

function createRouletteOverlayDOM() {
    let overlay = document.createElement('div');
    overlay.id = 'roulette-overlay';
    overlay.className = 'overlay-screen';
    overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.9); z-index:1000; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
    overlay.innerHTML = `
        <div style="background:#222; padding:25px; border-radius:15px; text-align:center; width:340px; border:2px solid #ffcc00;">
            <h2 style="color:#ffcc00; margin-bottom:15px;">🎰 順番決めルーレット 🎲</h2>
            <p id="roulette-result-text" style="font-size:18px; margin-bottom:20px; font-weight:bold; color:#4da6ff;">ボタンを押して順番を決定！</p>
            <button id="btn-spin-roulette" class="menu-btn" onclick="spinMyRoulette()">ルーレットを回す</button>
        </div>
    `;
    document.body.appendChild(overlay);
}

let isSpinning = false;
function spinMyRoulette() {
    if (isSpinning) return;
    isSpinning = true;
    let btn = document.getElementById('btn-spin-roulette');
    btn.style.display = 'none';

    let txt = document.getElementById('roulette-result-text');
    let count = 0;
    let interval = setInterval(() => {
        let tempNum = Math.floor(Math.random() * players.length) + 1;
        txt.innerText = `抽選中... [ ${tempNum} ]`;
        count++;
        if (count > 15) {
            clearInterval(interval);
            finalizeRouletteOrder();
        }
    }, 80);
}

function finalizeRouletteOrder() {
    let randomTempOrder = Math.floor(Math.random() * 10000);
    mySeatOrder = randomTempOrder;

    if (battleRole === 'host') {
        let p = players.find(x => x.id === myPlayerId);
        if (p) p.seatOrder = randomTempOrder;
        checkAllRouletteSubmitted();
    } else {
        sendToServer({ type: 'submit_roulette', id: myPlayerId, seatOrder: randomTempOrder });
        document.getElementById('roulette-result-text').innerText = '他のプレイヤーの決定を待っています...';
    }
}

function checkAllRouletteSubmitted() {
    let allDone = players.every(p => p.seatOrder !== -1);
    if (allDone && battleRole === 'host') {
        players.sort((a, b) => a.seatOrder - b.seatOrder);
        players.forEach((p, idx) => {
            p.seatOrder = idx + 1;
        });

        broadcastToAllGuests({ type: 'start_battle', turnOrderList: players });
        startBattleGameLoop();
    }
}

function startBattleGameLoop() {
    let rOverlay = document.getElementById('roulette-overlay');
    if (rOverlay) rOverlay.style.display = 'none';

    turnOrderList = players.filter(p => p.isAlive);
    currentTurnIndex = 0;
    
    let me = players.find(x => x.id === myPlayerId);
    if (me) mySeatOrder = me.seatOrder;

    showScreen('');
    initGrid();
    spawnBullet();
    playRandomBGM();
    gameState = 'playing';
    startTurnTimer();
    triggerCenterAnnouncement(`${mySeatOrder}番手 スタート！`, 120);
}

function triggerCenterAnnouncement(text, duration) {
    centerNoticeText = text;
    centerNoticeTimer = duration;
}

function startTurnTimer() {
    stopTurnTimer();
    turnRemainingTime = 15;
    turnTimerInterval = setInterval(() => {
        if (gameState === 'playing') {
            let currentTurnPlayer = turnOrderList[currentTurnIndex];
            if (currentTurnPlayer && currentTurnPlayer.id === myPlayerId) {
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
    let actionData = {
        type: 'sync_turn_action',
        senderId: myPlayerId,
        ojamaAmount: 0
    };
    if (battleRole === 'host') {
        broadcastToAllGuests(actionData);
        executeActionOnHost(actionData);
    } else {
        sendToServer(actionData);
    }
}

function executeActionOnHost(data) {
    let ojama = data.ojamaAmount;
    if (ojama > 0) {
        broadcastToAllGuests({ type: 'sync_turn_action', ojamaAmount: ojama });
        launchOjamaProjectilesFromBottom(ojama);
    }
    advanceTurn();
    broadcastToAllGuests({ type: 'next_turn', currentTurnIndex: currentTurnIndex, turnOrderList: turnOrderList });
}

function executeOpponentAction(data) {
    if (data.ojamaAmount > 0) {
        launchOjamaProjectilesFromBottom(data.ojamaAmount);
    }
}

function advanceTurn() {
    currentTurnIndex = (currentTurnIndex + 1) % turnOrderList.length;
    startTurnTimer();
}

function launchOjamaProjectilesFromBottom(count) {
    for (let i = 0; i < count; i++) {
        let col = Math.floor(Math.random() * COLS);
        let placed = false;
        for (let r = ROWS - 1; r >= 0; r--) {
            if (grid[r] && grid[r][col] === null) {
                grid[r][col] = { color: OJAMA_COLOR, isOjama: true };
                placed = true;
                break;
            }
        }
        if (!placed) {
            // 最上段に溢れた場合
            grid[0][0] = { color: OJAMA_COLOR, isOjama: true };
        }
    }
    playSE(se.ballLand);
}

// パズルグリッドの初期化
function initGrid() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }
    // 初期配置
    for (let r = 0; r < 4; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (Math.random() < 0.75) {
                grid[r][c] = { color: getRandomColor(), isOjama: false };
            }
        }
    }
}

function spawnBullet() {
    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    bulletColor = nextBulletColor;
    nextBulletColor = getRandomColor();
}

// 物理・判定ロジック
function update() {
    if (shakeTimer > 0) shakeTimer--;
    if (centerNoticeTimer > 0) centerNoticeTimer--;

    if (isMoving) {
        bulletX += bulletVX;
        bulletY += bulletVY;

        // 壁反射
        if (bulletX - RADIUS < 0) {
            bulletX = RADIUS;
            bulletVX *= -1;
        } else if (bulletX + RADIUS > canvas.width) {
            bulletX = canvas.width - RADIUS;
            bulletVX *= -1;
        }

        // 天井衝突
        if (bulletY - RADIUS <= 40) {
            snapBulletToGrid();
            return;
        }

        // 既存バブルとの接触判定
        for (let r = 0; r < ROWS; r++) {
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            for (let c = 0; c < colsInRow; c++) {
                if (grid[r][c] !== null) {
                    let pos = getCellPixelPosition(r, c);
                    let dist = Math.hypot(bulletX - pos.x, bulletY - pos.y);
                    if (dist < DIAMETER - 4) {
                        snapBulletToGrid();
                        return;
                    }
                }
            }
        }
    }
}

function getCellPixelPosition(r, c) {
    let xOffset = (r % 2 === 0) ? RADIUS + 10 : RADIUS + RADIUS + 10;
    let x = c * DIAMETER + xOffset;
    let y = r * ROW_HEIGHT + 50 + RADIUS;
    return { x: x, y: y };
}

function snapBulletToGrid() {
    isMoving = false;
    playSE(se.ballLand);

    // 最も近い空きグリッドセルを探す
    let bestR = 0, bestC = 0, minDist = Infinity;
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (grid[r][c] === null) {
                let pos = getCellPixelPosition(r, c);
                let dist = Math.hypot(bulletX - pos.x, bulletY - pos.y);
                if (dist < minDist) {
                    minDist = dist;
                    bestR = r;
                    bestC = c;
                }
            }
        }
    }

    grid[bestR][bestC] = { color: bulletColor, isOjama: false };

    // 同色チェック・消去処理
    let clearedCount = checkAndClearBubbles(bestR, bestC);
    
    // お邪魔発生計算
    let ojamaToSend = 0;
    if (clearedCount >= 3) {
        ojamaToSend = Math.floor(clearedCount / 3);
        score += clearedCount * 100;
    }

    let actionData = {
        type: 'sync_turn_action',
        senderId: myPlayerId,
        ojamaAmount: ojamaToSend
    };

    if (battleRole === 'host') {
        broadcastToAllGuests(actionData);
        executeActionOnHost(actionData);
    } else {
        sendToServer(actionData);
        advanceTurn();
    }

    spawnBullet();
}

function checkAndClearBubbles(startR, startC) {
    let targetColor = grid[startR][startC].color;
    let visited = Array.from({ length: ROWS }, () => []);
    let matchGroup = [];

    function dfs(r, c) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        if (r < 0 || r >= ROWS || c < 0 || c >= colsInRow) return;
        if (visited[r][c] || grid[r][c] === null || grid[r][c].color !== targetColor) return;
        visited[r][c] = true;
        matchGroup.push({ r: r, c: c });

        // 隣接6方向の探索
        let neighbors = getNeighbors(r, c);
        for (let n of neighbors) {
            dfs(n.r, n.c);
        }
    }

    dfs(startR, startC);

    if (matchGroup.length >= 3) {
        for (let m of matchGroup) {
            grid[m.r][m.c] = null;
        }
        return matchGroup.length;
    }
    return 0;
}

function getNeighbors(r, c) {
    let neighbors = [];
    let isEven = (r % 2 === 0);
    let offsets = isEven ? [
        { dr: -1, dc: -1 }, { dr: -1, dc: 0 },
        { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
        { dr: 1, dc: -1 }, { dr: 1, dc: 0 }
    ] : [
        { dr: -1, dc: 0 }, { dr: -1, dc: 1 },
        { dr: 0, dc: -1 }, { dr: 0, dc: 1 },
        { dr: 1, dc: 0 }, { dr: 1, dc: 1 }
    ];

    for (let o of offsets) {
        let nr = r + o.dr;
        let nc = c + o.dc;
        let colsInRow = (nr >= 0 && nr < ROWS) ? ((nr % 2 === 0) ? COLS : COLS - 1) : 0;
        if (nr >= 0 && nr < ROWS && nc >= 0 && nc < colsInRow) {
            neighbors.push({ r: nr, c: nc });
        }
    }
    return neighbors;
}

// 描画処理
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. グリッドのバブル描画
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let bubble = grid[r][c];
            if (bubble !== null) {
                let pos = getCellPixelPosition(r, c);
                ctx.beginPath();
                ctx.arc(pos.x, pos.y, RADIUS, 0, Math.PI * 2);
                ctx.fillStyle = bubble.color;
                ctx.fill();
                ctx.lineWidth = 2;
                ctx.strokeStyle = '#222';
                ctx.stroke();
                ctx.closePath();
            }
        }
    }

    // 2. 発射用シューターバブル
    if (!isMoving) {
        ctx.beginPath();
        ctx.arc(shooterX, shooterY, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = bulletColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.closePath();
    }

    // 3. 飛行中の発射玉
    if (isMoving) {
        ctx.beginPath();
        ctx.arc(bulletX, bulletY, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = bulletColor;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.closePath();
    }

    // 4. GUI・ステータス表示
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(`【${myPlayerName}】(${mySeatOrder}番手)`, 15, 25);
    
    let currentTurnPlayer = turnOrderList[currentTurnIndex];
    let turnName = currentTurnPlayer ? currentTurnPlayer.name : '-';
    let isMyTurn = (currentTurnPlayer && currentTurnPlayer.id === myPlayerId);
    
    ctx.fillStyle = isMyTurn ? '#4dff4d' : '#ffcc00';
    ctx.fillText(`ターン: ${turnName} (残り ${turnRemainingTime}秒)`, 15, 45);

    // 中央アナウンス
    if (centerNoticeTimer > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(centerNoticeText, canvas.width / 2, canvas.height / 2 + 7);
        ctx.restore();
    }
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// タッチ・ドラッグ操作（自分のターンの時のみ発射可能）
canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'playing' || isMoving) return;
    let currentTurnPlayer = turnOrderList[currentTurnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.id !== myPlayerId) return;

    unlockAudio();
    isDragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
});

canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    pullX = e.clientX - dragStartX;
    pullY = e.clientY - dragStartY;
});

canvas.addEventListener('pointerup', () => {
    if (!isDragging) return;
    isDragging = false;
    if (pullY < -10) {
        let angle = Math.atan2(pullY, pullX);
        let speed = 14;
        bulletVX = Math.cos(angle) * speed;
        bulletVY = Math.sin(angle) * speed;
        isMoving = true;
        playSE(se.ballShoot);
    }
    pullX = 0;
    pullY = 0;
});

showScreen('screen-title');
requestAnimationFrame(gameLoop);
