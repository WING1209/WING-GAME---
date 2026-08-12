const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// BGM & SE
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

// ゲーム定数・変数
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#f14dda'];
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let gameState = 'title';

// 対戦設定
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let gameMenu = 'お邪魔対戦'; // 'タイムアタック' or 'お邪魔対戦'
let maxPlayers = 2; // 2〜5
let targetWins = 1;

// プレイヤー管理
let myPlayerId = '';
let myPlayerName = 'プレイヤー';
let players = []; // [{ id, name, wins, seatOrder, isAlive }]
let mySeatOrder = 0;

// ターン管理 (多人数用)
let turnOrderList = []; // 順番通りのplayer配列
let currentTurnIndex = 0;
let turnRemainingTime = 15;
let turnTimerInterval = null;

// アイテム（3人以上専用：「おしつけ」）
let ositsukeTargetId = null; // ターゲットのプレイヤーID
let ositsukeTurnsLeft = 0; // 残りターン数（全員のターンが2周終了するまで）

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

let isMoving = false;
let shakeTimer = 0;
let flyingOjamaList = [];

// 通信用
let peer = null;
let hostConn = null; // ゲスト用
let guestConns = []; // ホスト用 [{ id, conn }]
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

// 役割設定
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
                // 自動で名前入力へ
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
        } else if (data.type === 'round_decide') {
            handleRoundDecide(data.winnerId);
        } else if (data.type === 'client_game_over') {
            let p = players.find(x => x.id === data.id);
            if (p) p.isAlive = false;
            checkSurvivalStatus();
        }
    });
    c.on('close', () => {
        guestConns = guestConns.filter(item => item.conn !== c);
    });
}

function setupGuestConnection(c) {
    c.on('open', () => {});
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
        } else if (data.type === 'round_result') {
            showRoundResultModal(data.winnerName);
        } else if (data.type === 'set_end') {
            showSetEndModal(data.winnerName);
        }
    });
    c.on('close', () => {
        alert('ホストとの接続が切断されました。');
        returnToTitle();
    });
}

function broadcastToAllGuests(data) {
    guestConns.forEach(item => {
        if (item.conn && item.conn.open) {
            item.conn.send(data);
        }
    });
}

function sendToServer(data) {
    if (battleRole === 'host') {
        // ホスト自身の処理
    } else {
        if (hostConn && hostConn.open) hostConn.send(data);
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

// 名前入力フェーズ
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
    if (allReady) {
        if (battleRole === 'host') {
            // ルーレットによる順番決めフェーズへ
            startRoulettePhaseAll();
        }
    }
}

function startRoulettePhaseAll() {
    if (battleRole === 'host') {
        broadcastToAllGuests({ type: 'start_roulette', players: players });
        openRoulettePhase();
    }
}

// 重複なしルーレット順番決め
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
    // クライアント側でランダムに一時決定してホストに送る、あるいはホストが重複なしで割り振る
    // ここではホストが全プレイヤーの申請を受け付けて重複なしに整列するロジックにする
    let randomTempOrder = Math.floor(Math.random() * 1000); // 一時的なランダム値
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
        // 重複なしの順番を確定 (seatOrderの昇順で 0, 1, 2... を割り振る)
        players.sort((a, b) => a.seatOrder - b.seatOrder);
        players.forEach((p, idx) => {
            p.seatOrder = idx + 1; // 1番手, 2番手...
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
    initGridForStage(1);
    spawnBullet();
    playRandomBGM();
    startTurnTimer();
    triggerCenterAnnouncement(`${mySeatOrder}番手 スタート！`, 120);
}

// 中央アナウンス表示用
let centerNoticeText = "";
let centerNoticeTimer = 0;
function triggerCenterAnnouncement(text, duration) {
    centerNoticeText = text;
    centerNoticeTimer = duration;
}

// ターン管理
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
        ojamaAmount: 0,
        activeItemsUsed: [],
        ositsukeTargetId: null
    };
    if (battleRole === 'host') {
        broadcastToAllGuests(actionData);
        executeActionOnHost(actionData);
    } else {
        sendToServer(actionData);
        advanceTurn();
    }
}

function advanceTurn() {
    currentTurnIndex = (currentTurnIndex + 1) % turnOrderList.length;
    
    // おしつけ効果の減算チェック（全員のターンが2周終了するまで＝ターン進行回数ベースで計算）
    if (ositsukeTurnsLeft > 0) {
        ositsukeTurnsLeft--;
    }

    startTurnTimer();
}

function executeActionOnHost(data) {
    // ホストがアクションを受信してターンを進める
    let ojama = data.ojamaAmount;
    let senderId = data.senderId;
    let items = data.activeItemsUsed || [];
    let targetId = data.ositsukeTargetId;

    if (ojama > 0) {
        // 3名以上で「おしつけ」アイテムが使われている場合の処理
        if (players.length >= 2) {
            // 基本ルール：自分のターンで玉を消した場合全員に同一数のお邪魔玉が飛んでいく
            // ただし「おしつけ」を使われているプレイヤーには肩代わり分が上乗せされる
            distributeOjamaToAll(senderId, ojama, items, targetId);
        }
    }
    advanceTurn();
    broadcastToAllGuests({ type: 'next_turn', currentTurnIndex: currentTurnIndex, turnOrderList: turnOrderList });
}

function executeOpponentAction(data) {
    if (data.currentTurnIndex !== undefined) {
        currentTurnIndex = data.currentTurnIndex;
    }
    if (data.ojamaAmount > 0) {
        launchOjamaProjectilesFromBottom(data.ojamaAmount);
    }
    startTurnTimer();
}

function distributeOjamaToAll(senderId, ojamaCount, items, targetId) {
    // 全員（自分以外、またはおしつけ対象）にお邪魔玉を配るロジック
    // ホストから全員へ反映させる
    let actionPayload = {
        type: 'sync_turn_action',
        ojamaAmount: ojamaCount
    };
    if (battleRole === 'host') {
        broadcastToAllGuests(actionPayload);
        launchOjamaProjectilesFromBottom(ojamaCount);
    }
}

function launchOjamaProjectilesFromBottom(count) {
    for (let i = 0; i < count; i++) {
        flyingOjamaList.push({
            x: canvas.width / 2 + (Math.random() * 100 - 50),
            y: canvas.height + 20,
            speed: 6
        });
    }
}

// ゲームロジック基本
function getRandomGridCell() {
    let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
    return { color: color, isOjama: false, isMystery: false };
}

function getRandomShooterBubble() {
    if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW, isOjama: false, isMystery: false };
    return {
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
        isOjama: false,
        isMystery: false
    };
}

function initGridForStage(stage) {
    grid = [];
    flyingOjamaList = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }
    let fillRows = 2;
    for (let r = 0; r < fillRows; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (grid[r][c] === null && Math.random() < 0.7) {
                grid[r][c] = getRandomGridCell();
            }
        }
    }
}

function spawnBullet() {
    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    bulletData = nextBubble;
    nextBubble = getRandomShooterBubble();
}

function update() {
    if (shakeTimer > 0) shakeTimer--;
    if (centerNoticeTimer > 0) centerNoticeTimer--;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 背景・ステータス描画
    ctx.fillStyle = '#fff';
    ctx.font = '15px sans-serif';
    ctx.fillText(`【${myPlayerName}】(${mySeatOrder}番手)`, 15, 25);
    
    let currentTurnPlayer = turnOrderList[currentTurnIndex];
    let turnName = currentTurnPlayer ? currentTurnPlayer.name : '-';
    ctx.fillStyle = (currentTurnPlayer && currentTurnPlayer.id === myPlayerId) ? '#4dff4d' : '#ffcc00';
    ctx.fillText(`ターン: ${turnName} (残り ${turnRemainingTime}秒)`, 15, 50);

    // 3名以上で使える「おしつけ」アイテムUI表示
    if (players.length >= 3) {
        ctx.fillStyle = '#ff9900';
        ctx.font = '13px sans-serif';
        ctx.fillText(`アイテム [おしつけ]: ${ositsukeTurnsLeft > 0 ? '発動中('+ositsukeTurnsLeft+')' : '待機中'}`, 15, 75);
    }

    // 中央アナウンス
    if (centerNoticeTimer > 0) {
        ctx.save();
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(0, canvas.height / 2 - 40, canvas.width, 80);
        ctx.fillStyle = '#ffcc00';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(centerNoticeText, canvas.width / 2, canvas.height / 2 + 8);
        ctx.restore();
    }
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// タッチ・ドラッグ操作
canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'playing') return;
    let currentTurnPlayer = turnOrderList[currentTurnIndex];
    if (!currentTurnPlayer || currentTurnPlayer.id !== myPlayerId) return;

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
        bulletVX = -pullX * 0.1;
        bulletVY = pullY * 0.1;
        isMoving = true;
        playSE(se.ballShoot);

        // 自分のターンで玉を消したと仮定したお邪魔送信アクション
        let generatedOjama = 2; // 消去に応じたお邪魔数
        let actionData = {
            type: 'sync_turn_action',
            senderId: myPlayerId,
            ojamaAmount: generatedOjama,
            activeItemsUsed: ositsukeTurnsLeft > 0 ? [1] : [],
            ositsukeTargetId: ositsukeTargetId
        };

        if (battleRole === 'host') {
            broadcastToAllGuests(actionData);
            executeActionOnHost(actionData);
        } else {
            sendToServer(actionData);
            advanceTurn();
        }
    }
    pullX = 0;
    pullY = 0;
});

// モーダル・結果表示用関数
function showRoundResultModal(winnerName) {
    triggerCenterAnnouncement(`${winnerName}さんの勝利！`, 180);
}

function showSetEndModal(winnerName) {
    triggerCenterAnnouncement(`👑 優勝: ${winnerName} 👑`, 300);
    gameState = 'result';
}

function checkSurvivalStatus() {
    let aliveList = players.filter(p => p.isAlive);
    if (aliveList.length <= 1 && players.length > 1) {
        let winner = aliveList[0] ? aliveList[0].name : 'なし';
        if (battleRole === 'host') {
            broadcastToAllGuests({ type: 'set_end', winnerName: winner });
        }
        showSetEndModal(winner);
    }
}

showScreen('screen-title');
requestAnimationFrame(gameLoop);
