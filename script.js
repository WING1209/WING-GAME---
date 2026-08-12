// --- WING GAME玉 script.js ---

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- サウンド (SE & BGM) 設定 ---
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

// --- ゲーム基本パラメータ ---
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const COLOR_NAMES = {
    '#ff4d4d': '赤の玉', '#4da6ff': '青の玉', '#4dff4d': '緑の玉',
    '#ffff4d': '黄色の玉', '#ff4dda': 'ピンクの玉', 'SPECIAL_BOMB': 'ボム玉'
};

const UNBREAKABLE_COLOR = '#fff';
const TOP_MARGIN = 15;
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let currentStage = 1;
const maxStages = 10;
let gameMode = 'single';
let battleType = 'お邪魔対戦';
let targetWins = 1;
let myWins = 0;
let opponentWins = 0;

// --- 消した玉数カウント・マイルストーン演出管理 ---
let myClearedBubbleCount = 0;
let opponentClearedBubbleCount = 0;
const TARGET_CLEARED_COUNT = 500;
let battleRole = '';
let roomCode = '';
let gameState = 'title';
let battleTurnState = 'waiting';
let myJankenChoice = '';
let opponentJankenChoice = '';
let jankenResultMsg = 'じゃんけんの手を選んでください';
let currentTurnPlayer = '';
const TURN_TIME_LIMIT = 10;
let turnRemainingTime = TURN_TIME_LIMIT;
let turnTimerInterval = null;

// --- アイテムシステム管理変数 ---
let itemStockCounts = [0, 0, 0, 0, 0];
let activeItems = [];
let piercingClearedThisTurn = 0;

let shooterX = 200;
let shooterY = 670;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;
let bulletData = getRandomShooterBubble();
let nextBubble = getRandomShooterBubble();
let bombUsesLeft = 2;

let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let pullX = 0;
let pullY = 0;
const MAX_PULL_DISTANCE = 120;
const MIN_SPEED = 8;
const MAX_SPEED = 24;

let isMoving = false;
let fallingBubbles = [];
let flashingBubbles = [];
let particles = [];
let fireworks = [];
let flyingOjamaList = [];

const STAGE_TIME_LIMIT = 180;
let remainingTime = STAGE_TIME_LIMIT;
let timerInterval = null;
let totalClearTime = 0;

let maxPlayers = 2;
let connections = {};
let playersData = [];
let myPlayerName = "";
let myPeerId = "";
let currentTurnIndex = 0;
let peer = null;
let conn = null;
const PEER_PREFIX = 'pb-game-room-2026-v7-';

// --- 画面切り替え ---
function showScreen(screenId) {
    document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
    if (screenId === '') return;
    let target = document.getElementById(screenId);
    if (target) {
        target.style.display = 'flex';
        if (screenId === 'screen-title') {
            gameState = 'title';
            stopBGM();
            stopTimer();
            stopTurnTimer();
            let logo = target.querySelector('.title-logo');
            if (logo) {
                logo.style.animation = 'none';
                logo.offsetHeight;
                logo.style.animation = null;
            }
        }
    }
}

function goToHowToPlay() {
    unlockAudio();
    if (gameState === 'title') showScreen('screen-how-to-play');
}

function startTimer() {
    stopTimer();
    timerInterval = setInterval(() => {
        if (gameState === 'playing' && gameMode === 'single') {
            remainingTime--;
            if (remainingTime <= 0) {
                remainingTime = 0;
                stopTimer();
                handleTimeOutGameOver();
            }
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

function startTurnTimer() {
    stopTurnTimer();
    turnRemainingTime = TURN_TIME_LIMIT;
    turnTimerInterval = setInterval(() => {
        if (gameState === 'playing' && gameMode === 'battle' && battleType === 'お邪魔対戦') {
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
        conn.send({ type: 'sync_turn_action', ojamaAmount: 0, didClear: false, activeItemsUsed: [], myClearedCount: myClearedBubbleCount });
    }
    switchTurnToOpponent();
}

function getRandomGridCell() {
    let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
    let isMystery = false;
    if (gameMode === 'battle' && battleType === 'お邪魔対戦') {
        if (Math.random() < 0.11) isMystery = true;
    }
    return { color: color, isOjama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
    let isMystery = false;
    if (gameMode === 'battle' && battleType === 'お邪魔対戦') {
        if (Math.random() < 0.11) isMystery = true;
    }
    if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW, isOjama: false, isMystery: false };
    return {
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
        isOjama: false,
        isMystery: isMystery
    };
}

function initGridForStage(stage) {
    grid = [];
    fallingBubbles = [];
    flashingBubbles = [];
    flyingOjamaList = [];
    itemStockCounts = [0, 0, 0, 0, 0];
    activeItems = [];
    myClearedBubbleCount = 0;
    opponentClearedBubbleCount = 0;
    piercingClearedThisTurn = 0;

    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }
    if (gameMode !== 'battle') {
        let maxUnbreakable = Math.min(8, stage + 1);
        let placed = 0;
        let attempts = 0;
        while (placed < maxUnbreakable && attempts < 100) {
            attempts++;
            let r = Math.floor(Math.random() * 3);
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            let c = Math.floor(Math.random() * colsInRow);
            if (grid[r][c] === null) {
                grid[r][c] = { color: UNBREAKABLE_COLOR, isOjama: false, isMystery: false };
                placed++;
            }
        }
    }
    let fillRows = (gameMode === 'battle' && battleType === 'お邪魔対戦') ? 2 : Math.min(ROWS - 5, 2 + Math.floor(stage * 0.5));
    for (let r = 0; r < fillRows; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (grid[r][c] === null && Math.random() < 0.7) {
                grid[r][c] = getRandomGridCell();
            }
        }
    }
}

function startSinglePlay() {
    closeNetwork();
    gameMode = 'single';
    gameState = 'playing';
    score = 0;
    currentStage = 1;
    bombUsesLeft = 2;
    totalClearTime = 0;
    remainingTime = STAGE_TIME_LIMIT;
    initGridForStage(currentStage);
    spawnBullet();
    playRandomBGM();
    startTimer();
    showScreen('');
}

function submitPlayerName() {
    myPlayerName = document.getElementById('input-player-name').value || "名無し";
    if (battleRole === 'host') {
        roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        peer = new Peer(PEER_PREFIX + roomCode);
        myPeerId = peer.id;
        playersData.push({ peerId: myPeerId, name: myPlayerName, isHost: true });
        document.getElementById('display-room-code').innerText = roomCode;
        showScreen('screen-host-wait');
        peer.on('connection', (c) => {
            if (Object.keys(connections).length < maxPlayers - 1) {
                connections[c.peer] = c;
                setupHostConnectionListeners(c);
            } else {
                c.send({ type: 'room_full' });
                setTimeout(() => c.close(), 1000);
            }
        });
    } else {
        showScreen('screen-guest-join');
    }
}

function broadcast(data) {
    Object.values(connections).forEach(c => {
        if (c.open) c.send(data);
    });
}

function joinRoom() {
    let code = document.getElementById('input-room-code').value;
    if (code.length !== 4) {
        document.getElementById('status-message').innerText = '4桁の数字を入力してください';
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
        document.getElementById('status-message').innerText = '部屋が見つからないか接続に失敗しました';
    });
}

function setupHostConnectionListeners(c) {
    c.on('open', () => {
        c.on('data', (data) => {
            if (data.type === 'join_room') {
                playersData.push({ peerId: c.peer, name: data.name, isHost: false });
                if (playersData.length === maxPlayers) {
                    checkAllPlayersReady();
                }
            }
        });
    });
}

function setupConnectionListeners() {
    conn.on('open', () => {
        if (battleRole === 'guest') {
            conn.send({ type: 'join_room', name: myPlayerName });
            showScreen('screen-guest-wait-rule');
        }
    });
    conn.on('data', (data) => {
        if (data.type === 'game_start_sync') {
            executeGameStartSync(data.players);
            targetWins = data.rules.targetWins;
            battleType = data.rules.battleType;
        } else if (data.type === 'show_rules') {
            targetWins = data.targetWins;
            battleType = data.battleType;
            displayBattleRulesDesc();
        } else if (data.type === 'ready_start') {
            executeBattleStart();
        } else if (data.type === 'start_janken') {
            openJankenScreen();
        } else if (data.type === 'set_first_player') {
            currentTurnPlayer = data.turnPlayer;
            closeJankenOverlay();
            startBattleRoundLoop();
        } else if (data.type === 'sync_janken_result') {
            opponentJankenChoice = data.choice;
            checkJankenFinish();
        } else if (data.type === 'sync_turn_action') {
            executeOpponentAction(data);
        }
    });
    conn.on('close', () => {
        if (gameState === 'playing' || gameState === 'battle_result') {
            alert('相手との通信が切断されました');
            returnToTitle();
        }
    });
}

function checkAllPlayersReady() {
    if (playersData.length === maxPlayers) {
        playersData.forEach((p, index) => {
            p.order = index + 1;
        });
        broadcast({ type: 'game_start_sync', players: playersData, rules: { targetWins, battleType } });
        executeGameStartSync(playersData);
    }
}

function executeGameStartSync(syncedPlayers) {
    playersData = syncedPlayers;
    let myObj = playersData.find(p => p.name === myPlayerName);
    let myOrder = myObj ? myObj.order : 1;
    let turnText = document.getElementById('turn-order-text');
    if (turnText) turnText.innerText = `あなたは ${myOrder} 番手です!`;
    showScreen('screen-turn-order');
    setTimeout(() => {
        currentTurnIndex = 0;
        startBattleRoundLoop();
    }, 2500);
}

function setHostBattleType(type) {
    battleType = type;
    if (type === 'お邪魔対戦') {
        showScreen('screen-player-count');
    } else {
        maxPlayers = 2;
        showScreen('screen-host-wait-rule');
    }
}

function setPlayerCount(count) {
    maxPlayers = count;
    showScreen('screen-host-wait-rule');
}

function setHostTargetWins(wins) {
    targetWins = wins;
    let btn1 = document.getElementById('btn-win-1');
    let btn2 = document.getElementById('btn-win-2');
    if (btn1) btn1.className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
    if (btn2) btn2.className = wins === 2 ? 'menu-btn' : 'menu-btn gray';
}

function confirmHostBattleStart() {
    if (conn && conn.open) {
        conn.send({ type: 'show_rules', targetWins: targetWins, battleType: battleType });
    }
    displayBattleRulesDesc();
}

function displayBattleRulesDesc() {
    let desc = "";
    if (battleType === 'タイムアタック') {
        desc = `<b>【タイムアタック】</b><br>画面上の消せる玉を相手より先にすべて消した方の勝利!<br><br>• 勝利条件: ${targetWins}勝先取`;
    } else {
        desc = `<b>【ターン制お邪魔対戦】</b><br>じゃんけんで先攻後攻を決定! 交互に玉を打ちます。<br>出現する「?」付きの玉を消すとアイテム発生!<br><br>勝利条件: ${targetWins}勝先取`;
    }
    let textElem = document.getElementById('rules-text-content');
    if (textElem) textElem.innerHTML = desc;
    showScreen('screen-battle-rules-desc');
}

function readyToStartBattle() {
    if (battleRole === 'host') {
        if (conn && conn.open) conn.send({ type: 'ready_start' });
        executeBattleStart();
    }
}

function executeBattleStart() {
    gameMode = 'battle';
    gameState = 'playing';
    score = 0;
    currentStage = 1;
    bombUsesLeft = 2;
    myWins = 0;
    opponentWins = 0;
    initGridForStage(currentStage);
    spawnBullet();
    playRandomBGM();
    if (battleType === 'お邪魔対戦') {
        startJankenPhase();
    } else {
        showScreen('');
    }
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
    bombUsesLeft = 2;
    initGridForStage(1);
    spawnBullet();
    gameState = 'playing';
    playRandomBGM();
    if (battleType === 'お邪魔対戦') {
        startJankenPhase();
    } else {
        showScreen('');
    }
}

function startJankenPhase() {
    battleTurnState = 'janken';
    myJankenChoice = '';
    opponentJankenChoice = '';
    jankenResultMsg = 'じゃんけんの手を選んでください';
    let container = document.getElementById('janken-overlay');
    if (!container) {
        createJankenOverlayDOM();
    }
    document.getElementById('janken-status-msg').innerText = jankenResultMsg;
    document.getElementById('janken-overlay').style.display = 'flex';
    if (battleRole === 'host') {
        if (conn && conn.open) conn.send({ type: 'start_janken' });
    }
}

function openJankenScreen() {
    battleTurnState = 'janken';
    myJankenChoice = '';
    opponentJankenChoice = '';
    jankenResultMsg = 'じゃんけんの手を選んでください';
    let container = document.getElementById('janken-overlay');
    if (!container) {
        createJankenOverlayDOM();
    }
    document.getElementById('janken-status-msg').innerText = jankenResultMsg;
    document.getElementById('janken-overlay').style.display = 'flex';
}

function createJankenOverlayDOM() {
    if (document.getElementById('janken-overlay')) return;
    let overlay = document.createElement('div');
    overlay.id = 'janken-overlay';
    overlay.className = 'overlay-screen';
    overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:1000; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
    overlay.innerHTML = `
        <div style="background:#222; padding:30px; border-radius:15px; text-align:center; width:320px; border:2px solid #555;">
            <h2 style="color:#ffcc00; margin-bottom:15px;">✊ じゃんけん勝負 ✌️</h2>
            <p id="janken-status-msg" style="margin-bottom:20px; font-size:14px;">じゃんけんの手を選んでください</p>
            <div style="display:flex; justify-content:space-around;">
                <button class="menu-btn" style="width:80px;" onclick="chooseJanken('rock')">グー</button>
                <button class="menu-btn" style="width:80px;" onclick="chooseJanken('paper')">パー</button>
                <button class="menu-btn" style="width:80px;" onclick="chooseJanken('scissors')">チョキ</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function chooseJanken(choice) {
    myJankenChoice = choice;
    document.getElementById('janken-status-msg').innerText = '相手の選択を待っています...';
    if (conn && conn.open) {
        conn.send({ type: 'sync_janken_result', choice: choice });
    }
    checkJankenFinish();
}

function checkJankenFinish() {
    if (myJankenChoice !== '' && opponentJankenChoice !== '') {
        let res = determineJankenWinner(myJankenChoice, opponentJankenChoice);
        if (res === 'draw') {
            document.getElementById('janken-status-msg').innerText = 'あいこで...もう一度！';
            myJankenChoice = '';
            opponentJankenChoice = '';
        } else {
            let turnPlayer = (res === 'win') ? myPlayerName : 'opponent';
            document.getElementById('janken-status-msg').innerText = (res === 'win') ? 'あなたの先攻です！' : '相手の先攻です！';
            setTimeout(() => {
                closeJankenOverlay();
                startBattleRoundLoop();
            }, 1500);
        }
    }
}

function determineJankenWinner(me, opp) {
    if (me === opp) return 'draw';
    if ((me === 'rock' && opp === 'scissors') || (me === 'paper' && opp === 'rock') || (me === 'scissors' && opp === 'paper')) {
        return 'win';
    }
    return 'lose';
}

function closeJankenOverlay() {
    let overlay = document.getElementById('janken-overlay');
    if (overlay) overlay.style.display = 'none';
}

function startBattleRoundLoop() {
    battleTurnState = 'my_turn';
    startTurnTimer();
}

function switchTurnToOpponent() {
    battleTurnState = 'opponent_turn';
    stopTurnTimer();
}

function executeOpponentAction(data) {
    startBattleRoundLoop();
}

function spawnBullet() {
    bulletX = shooterX;
    bulletY = shooterY;
    bulletData = nextBubble;
    nextBubble = getRandomShooterBubble();
    bulletVX = 0;
    bulletVY = 0;
}

function returnToTitle() {
    stopBGM();
    stopTimer();
    stopTurnTimer();
    closeNetwork();
    showScreen('screen-title');
}

// --- タッチ・マウス操作制御 ---
canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'playing' || isMoving) return;
    unlockAudio();
    let rect = canvas.getBoundingClientRect();
    let clientX = e.clientX - rect.left;
    let clientY = e.clientY - rect.top;
    
    isDragging = true;
    dragStartX = clientX;
    dragStartY = clientY;
    pullX = 0;
    pullY = 0;
});

canvas.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    let rect = canvas.getBoundingClientRect();
    let clientX = e.clientX - rect.left;
    let clientY = e.clientY - rect.top;
    
    let dx = clientX - dragStartX;
    let dy = clientY - dragStartY;
    let dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > MAX_PULL_DISTANCE) {
        dx = (dx / dist) * MAX_PULL_DISTANCE;
        dy = (dy / dist) * MAX_PULL_DISTANCE;
    }
    pullX = dx;
    pullY = dy;
});

canvas.addEventListener('pointerup', (e) => {
    if (!isDragging) return;
    isDragging = false;
    
    if (Math.abs(pullY) > 10) {
        let angle = Math.atan2(pullY, pullX);
        let speed = Math.min(Math.max(Math.sqrt(pullX * pullX + pullY * pullY) / 5, MIN_SPEED), MAX_SPEED);
        bulletVX = -Math.cos(angle) * speed;
        bulletVY = -Math.sin(angle) * speed;
        isMoving = true;
        playSE(se.ballShoot);
    }
    pullX = 0;
    pullY = 0;
});

// --- メインゲームループ ---
function update() {
    if (gameState === 'playing' && isMoving) {
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
        
        // 天井衝突または玉へのヒット判定
        if (bulletY - RADIUS <= TOP_MARGIN) {
            landBullet();
        }
    }
}

function landBullet() {
    isMoving = false;
    playSE(se.ballLand);
    spawnBullet();
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // グリッドの描画
    for (let r = 0; r < grid.length; r++) {
        let colsInRow = grid[r].length;
        let rowOffsetX = (r % 2 === 0) ? RADIUS : RADIUS * 2;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r][c];
            if (cell) {
                let x = rowOffsetX + c * DIAMETER;
                let y = TOP_MARGIN + RADIUS + r * ROW_HEIGHT;
                
                ctx.beginPath();
                ctx.arc(x, y, RADIUS - 1, 0, Math.PI * 2);
                ctx.fillStyle = cell.color === UNBREAKABLE_COLOR ? '#888' : cell.color;
                ctx.fill();
                ctx.strokeStyle = '#222';
                ctx.lineWidth = 2;
                ctx.stroke();
                ctx.closePath();
            }
        }
    }
    
    // 発射台の玉を描画
    if (bulletData) {
        ctx.beginPath();
        ctx.arc(bulletX, bulletY, RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = bulletData.color === SPECIAL_RAINBOW ? '#ff00ff' : bulletData.color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.closePath();
    }
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

// 初期化実行
initGridForStage(currentStage);
spawnBullet();
gameLoop();
