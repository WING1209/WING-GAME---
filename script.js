
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
const UNBREAKABLE_COLOR = '#888888';
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let currentStage = 1;
const maxStages = 10;
let gameMode = 'battle';
let battleType = 'お邪魔対戦';
let targetWins = 1;
let myWins = 0;
let opponentWins = 0;

let myClearedBubbleCount = 0;
let opponentClearedBubbleCount = 0;
const TARGET_CLEARED_COUNT = 500;

let activeMarqueeText = "";
let marqueeX = 305;
let marqueeTimer = 0;
let triggeredMilestones = new Set();
let battleRole = '';
let roomCode = '';
let gameState = 'title';
let battleTurnState = '';
let myJankenChoice = '';
let opponentJankenChoice = '';
let jankenResultMsg = 'じゃんけんの手を選んでください';
let currentTurnPlayer = '';
const TURN_TIME_LIMIT = 10;
let turnRemainingTime = TURN_TIME_LIMIT;
let turnTimerInterval = null;

let itemStockCounts = [0, 0, 0, 0, 0];
let activeItems = [];
let isRouletteActive = false;
let rouletteItemIndex = 0;
let rouletteInterval = null;
let isRouletteStopping = false;
let rouletteStopShakeTimer = 0;

let colorChangeStep = 0;
let colorChangeSourceColor = '';
let piercingClearedThisTurn = 0;

let shooterX = 200;
let shooterY = canvas.height - 70;
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
let battleWinner = '';
let flyingOjamaList = [];
let attackNoticeText = "";
let attackNoticeTimer = 0;
let shakeTimer = 0;
let opponentTurnNoticeText = "";
let opponentTurnNoticeTimer = 0;

const STAGE_TIME_LIMIT = 180;
let remainingTime = STAGE_TIME_LIMIT;
let timerInterval = null;
let totalClearTime = 0;

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
            let logo = target.querySelector('.title-logo');
            if (logo) {
                logo.style.animation = 'none';
                logo.offsetHeight;
                logo.style.animation = null;
            }
        }
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
    if (battleType === 'お邪魔対戦') {
        if (Math.random() < 0.11) {
            isMystery = true;
        }
    }
    return { color: color, isOjama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
    let isMystery = false;
    if (battleType === 'お邪魔対戦') {
        if (Math.random() < 0.11) {
            isMystery = true;
        }
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
    triggeredMilestones.clear();
    activeMarqueeText = "";
    piercingClearedThisTurn = 0;

    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) row.push(null);
        grid.push(row);
    }

    let fillRows = (battleType === 'お邪魔対戦') ? 2 : Math.min(ROWS - 5, 2 + Math.floor(stage * 0.5));
    for (let r = 0; r < fillRows; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (grid[r][c] === null && Math.random() < 0.7) {
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
            showScreen('');
        });
        peer.on('error', () => {
            alert('ルーム作成に失敗しました。');
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
        document.getElementById('status-message').innerText = '部屋が見つからないか接続に失敗しました';
    });
}

function setupConnectionListeners() {
    conn.on('open', () => {
        if (battleRole === 'guest') {
            showScreen('screen-guest-wait-rule');
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
                battleType = data.battleType;
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
            } else if (data.type === 'guest_game_over' || data.type === 'guest_request_500_win') {
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
        if (gameState === 'playing' || gameState === 'battle_result') {
            alert('対戦相手が切断しました。');
            returnToTitle();
        }
    });
}

function returnToTitle() {
    closeNetwork();
    stopBGM();
    stopTurnTimer();
    gameState = 'title';
    showScreen('screen-title');
}

function setHostBattleType(type) {
    battleType = type;
    document.getElementById('btn-mode-ojama').className = type === 'お邪魔対戦' ? 'menu-btn sub' : 'menu-btn gray';
    document.getElementById('btn-mode-ta').className = type === '500個消し対戦' ? 'menu-btn sub' : 'menu-btn gray';
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
            targetWins: targetWins,
            battleType: battleType
        });
    }
    displayBattleRulesDesc();
}

function displayBattleRulesDesc() {
    let desc = '';
    if (battleType === 'お邪魔対戦') {
        desc = '<b>お邪魔対戦ルール</b><br><br>• 玉を消すと相手にジャマ玉が送られます。<br>• ターン制で交互に発射します。<br>• 先に相手をゲームオーバーにさせた方の勝ち！';
    } else {
        desc = '<b>500個消し対戦ルール</b><br><br>• 先に合計500個のバブルを消した方の勝ち！<br>• スピード勝負でバブルをどんどん消そう！';
    }
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
    }
    conn = null;
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
    document.getElementById('janken-choice-buttons').style.display = 'flex';
    document.getElementById('janken-role-select').style.display = 'none';
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
    document.getElementById('janken-status-msg').innerText = jankenResultMsg;
    document.getElementById('janken-choice-buttons').style.display = 'flex';
    document.getElementById('janken-role-select').style.display = 'none';
    document.getElementById('janken-overlay').style.display = 'flex';
}

function createJankenOverlayDOM() {
    let overlay = document.createElement('div');
    overlay.id = 'janken-overlay';
    overlay.className = 'overlay-screen';
    overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:1000; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
    overlay.innerHTML = `
        <div style="background:#222; padding:30px; border-radius:15px; text-align:center; width:320px; border:2px solid #555;">
            <h2 style="color:#ffcc00; margin-bottom:15px;">✊ じゃんけん勝負 ✌️</h2>
            <p style="font-size:12px; color:#aaa; margin-bottom:10px;">(先攻・後攻決定)</p>
            <p id="janken-status-msg" style="margin-bottom:20px; font-size:14px;">じゃんけんの手を選んでください</p>
            <div id="janken-choice-buttons" style="display:flex; justify-content:center; gap:12px; margin-bottom:20px;">
                <button id="btn-janken-rock" class="menu-btn sub" style="width:75px; height:60px; font-size:20px; touch-action:manipulation;">✊</button>
                <button id="btn-janken-scissors" class="menu-btn sub" style="width:75px; height:60px; font-size:20px; touch-action:manipulation;">✌️</button>
                <button id="btn-janken-paper" class="menu-btn sub" style="width:75px; height:60px; font-size:20px; touch-action:manipulation;">✋</button>
            </div>
            <div id="janken-role-select" style="display:none; flex-direction:column; gap:10px;">
                <p id="janken-winner-desc" style="color:#4dff4d; font-weight:bold; font-size:15px;"></p>
                <button id="btn-role-first" class="menu-btn" style="touch-action:manipulation;">先攻で始める</button>
                <button id="btn-role-second" class="menu-btn sub" style="touch-action:manipulation;">後攻で始める</button>
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
    let names = { 'rock': '✊ グー', 'scissors': '✌️ チョキ', 'paper': '✋ パー' };
    let statusMsgEl = document.getElementById('janken-status-msg');
    let buttonsEl = document.getElementById('janken-choice-buttons');
    if (statusMsgEl) statusMsgEl.innerText = `あなた: ${names[choice]} を選択しました。\n相手の選択を待っています...`;
    if (buttonsEl) buttonsEl.style.display = 'none';
    if (conn && conn.open) {
        conn.send({ type: 'sync_janken_result', choice: choice });
    }
    checkJankenFinish();
}

function checkJankenFinish() {
    let statusMsgEl = document.getElementById('janken-status-msg');
    let roleSelectEl = document.getElementById('janken-role-select');
    let buttonsEl = document.getElementById('janken-choice-buttons');
    if (myJankenChoice !== '' && opponentJankenChoice !== '') {
        if (myJankenChoice === opponentJankenChoice) {
            if (statusMsgEl) statusMsgEl.innerText = "あいこです！もう一度選んでください";
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
            if (statusMsgEl) statusMsgEl.innerText = "あなたの勝ちです！先攻・後攻を選んでください";
            if (roleSelectEl) roleSelectEl.style.display = 'flex';
        } else {
            if (statusMsgEl) statusMsgEl.innerText = "相手の勝ちです。相手の選択を待っています...";
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
    let activeItemsUsed = data.activeItemsUsed || [];
    let actualOjama = data.ojamaAmount;
    if (data.myClearedCount !== undefined) {
        opponentClearedBubbleCount = data.myClearedCount;
        checkMilestoneAndTriggerMarquee(opponentClearedBubbleCount);
        check500WinCondition();
    }
    if (activeItemsUsed.includes(3) && actualOjama > 0) {
        actualOjama = 0;
    }
    if (actualOjama > 0) {
        launchOjamaProjectilesFromBottom(actualOjama);
    } else {
        if (activeItemsUsed.includes(2)) {
            opponentTurnNoticeText = "相手がバリア展開中！";
            opponentTurnNoticeTimer = 90;
            playSE(se.bombExplode);
        }
        battleTurnState = 'my_turn';
        startTurnTimer();
    }
}

function checkMilestoneAndTriggerMarquee(count) {
    let milestones = [100, 200, 300, 400, 450];
    for (let m of milestones) {
        if (count >= m && !triggeredMilestones.has(m)) {
            triggeredMilestones.add(m);
            triggerMarqueeAnnouncement(`${m}個到達！`);
            break;
        }
    }
}

function triggerMarqueeAnnouncement(text) {
    activeMarqueeText = text;
    marqueeX = 305;
    marqueeTimer = 180;
}

function check500WinCondition() {
    if (battleType === '500個消し対戦') {
        if (myClearedBubbleCount >= TARGET_CLEARED_COUNT && opponentClearedBubbleCount < TARGET_CLEARED_COUNT) {
            if (conn && conn.open) conn.send({ type: 'guest_request_500_win' });
            handleHostRoundDecide('YOU');
        } else if (opponentClearedBubbleCount >= TARGET_CLEARED_COUNT && myClearedBubbleCount < TARGET_CLEARED_COUNT) {
            handleHostRoundDecide('OPPONENT');
        }
    }
}

function handleHostRoundDecide(winner) {
    if (winner === 'YOU') {
        myWins++;
    } else {
        opponentWins++;
    }
    if (conn && conn.open) {
        conn.send({
            type: 'sync_round_end',
            winner: winner,
            myWins: myWins,
            opponentWins: opponentWins
        });
    }
    checkBattleSetEnd(winner);
}

function checkBattleSetEnd(roundWinner) {
    gameState = 'battle_result';
    stopTurnTimer();
    playSE(roundWinner === 'YOU' ? se.stageClear : se.gameOver);
}

function spawnBullet() {
    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    bulletData = nextBubble;
    nextBubble = getRandomShooterBubble();
}

function launchOjamaProjectilesFromBottom(count) {
    for (let i = 0; i < count; i++) {
        flyingOjamaList.push({
            x: canvas.width / 2 + (Math.random() * 100 - 50),
            y: canvas.height + 20,
            targetRow: 0,
            targetCol: 0,
            speed: 6
        });
    }
}

function update() {
    if (shakeTimer > 0) shakeTimer--;
    if (marqueeTimer > 0) {
        marqueeTimer--;
        marqueeX -= 2;
    }
    if (attackNoticeTimer > 0) attackNoticeTimer--;
    if (opponentTurnNoticeTimer > 0) opponentTurnNoticeTimer--;
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff';
    ctx.font = '16px sans-serif';
    ctx.fillText(`対戦モード (${battleType})`, 20, 30);
    ctx.fillText(`スコア: ${score}`, 20, 60);
}

function gameLoop() {
    update();
    draw();
    requestAnimationFrame(gameLoop);
}

canvas.addEventListener('pointerdown', (e) => {
    if (gameState !== 'playing') return;
    if (gameMode === 'battle' && battleType === 'お邪魔対戦' && battleTurnState !== 'my_turn') return;
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
    }
    pullX = 0;
    pullY = 0;
});

showScreen('screen-title');
requestAnimationFrame(gameLoop);
