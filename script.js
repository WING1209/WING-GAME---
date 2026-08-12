// ==========================================
// 1. 初期設定・キャンバス定義
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ==========================================
// 2. オーディオ（SE・BGM）管理
// ==========================================
const audioPath = 'audio/';

const se = {
    ballShoot:   new Audio(`${audioPath}se/se_ball_shoot.wav`),
    ballLand:    new Audio(`${audioPath}se/se_ball_land.wav`),
    bombExplode: new Audio(`${audioPath}se/se_bomb_explode.wav`),
    rainbowLand: new Audio(`${audioPath}se/se_rainbow_land.wav`),
    rainbowSet:  new Audio(`${audioPath}se/se_rainbow_set.wav`),
    blockFall:   new Audio(`${audioPath}se/se_block_fall.wav`),
    gameOver:    new Audio(`${audioPath}se/se_game_over.mp3`),
    stageClear:  new Audio(`${audioPath}se/se_stage_clear.wav`)
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

// ==========================================
// 3. ゲーム基本定数・グローバル変数
// ==========================================
const ROWS = 15; 
const COLS =  8;  
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);

const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const COLOR_NAMES = {
    '#ff4d4d': '赤の玉', '#4da6ff': '青の玉', '#4dff4d': '緑の玉',
    '#ffff4d': '黄色の玉', '#ff4dda': 'ピンクの玉', 'SPECIAL_BOMB': 'ボム玉(💣)'
};
let customImages = {};
const UNBREAKABLE_COLOR = '#fff';
const TOP_MARGIN = 15; 

const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let currentStage = 1;
const maxStages = 10;

// --- 対戦・ゲームモード状態 ---
let gameMode = 'single'; 
let battleType = 'お邪魔対戦'; // ターン制お邪魔対戦
let targetWins = 1;
let myWins = 0;
let opponentWins = 0;

// --- カウント・マイルストーン演出 ---
let myClearedBubbleCount = 0;
let opponentClearedBubbleCount = 0;
const TARGET_CLEARED_COUNT = 500;
let activeMarqueeText = "";
let marqueeX = 305;
let marqueeTimer = 0;
let triggeredMilestones = new Set(); 

// --- じゃんけん・ターン状態 ---
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
let isRouletteActive = false;
let rouletteItemIndex = 0;
let rouletteInterval = null;
let isRouletteStopping = false; 
let rouletteStopShakeTimer = 0; 
let colorChangeStep = 0; 
let colorChangeSourceColor = '';

let piercingClearedThisTurn = 0;

// --- 射出・物理計算パラメータ ---
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

// --- エフェクト・演出オブジェクト ---
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

// --- タイムリミット・通信 ---
const STAGE_TIME_LIMIT = 180; 
let remainingTime = STAGE_TIME_LIMIT;
let timerInterval = null;
let totalClearTime = 0;

let peer = null;
let conn = null;
const PEER_PREFIX = 'pb-game-room-2026-v7-';

// ==========================================
// 4. 画面遷移・タイマー管理
// ==========================================
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
        conn.send({ type: 'sync_turn_action', ojamaAmount: 0, didClear: false, activeItemsUsed: [], myClearedCount: myClearedBubbleCount });
    }
    switchTurnToOpponent();
}

// ==========================================
// 5. ステージ・グリッド初期化
// ==========================================
function getRandomGridCell() {
    let color = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
    let isMystery = false;
    if (gameMode === 'battle') {
        if (Math.random() < 0.11) {
            isMystery = true;
        }
    }
    return { color: color, isOjama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
    let isMystery = false;
    if (gameMode === 'battle') {
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

    let fillRows = (gameMode === 'battle') ? 2 : Math.min(ROWS - 5, 2 + Math.floor(stage * 0.5));
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

// ==========================================
// 6. ネットワーク通信 (PeerJS 対戦機能)
// ==========================================
function setupRole(role) {
    battleRole = role;
    closeNetwork();

    if (role === 'host') {
        roomCode = Math.floor(1000 + Math.random() * 9000).toString();
        let displayCode = document.getElementById('display-room-code');
        if (displayCode) displayCode.innerText = roomCode;
        showScreen('screen-host-wait');

        peer = new Peer(PEER_PREFIX + roomCode);
        peer.on('connection', (c) => {
            conn = c;
            setupConnectionListeners();
            showScreen('screen-host-rule-setup');
        });
        peer.on('error', () => {
            alert('接続エラーが発生しました（部屋IDが競合している可能性があります）');
            showScreen('screen-role-select');
        });
    } else {
        showScreen('screen-guest-join');
        let statusMsg = document.getElementById('status-message');
        if (statusMsg) statusMsg.innerText = '';
    }
}

function joinRoom() {
    let codeEl = document.getElementById('input-room-code');
    let code = codeEl ? codeEl.value : '';
    if (code.length !== 4) {
        let statusMsg = document.getElementById('status-message');
        if (statusMsg) statusMsg.innerText = '4桁の数字を入力してください';
        return;
    }

    roomCode = code;
    let statusMsg = document.getElementById('status-message');
    if (statusMsg) statusMsg.innerText = '接続中...';
    closeNetwork();
    peer = new Peer();

    peer.on('open', () => {
        conn = peer.connect(PEER_PREFIX + roomCode);
        setupConnectionListeners();
    });
    peer.on('error', () => {
        if (statusMsg) statusMsg.innerText = '部屋が見つからないか接続に失敗しました';
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
                battleType = 'お邪魔対戦';
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
            } else if (data.type === 'guest_request_round_win' || data.type === 'guest_request_500_win') {
                handleHostRoundDecide('OPPONENT');
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
            alert('相手との通信が切断されました');
            returnToTitle();
        }
    });
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
        conn.send({
            type: 'show_rules',
            targetWins: targetWins,
            battleType: 'お邪魔対戦'
        });
    }
    displayBattleRulesDesc();
}

function displayBattleRulesDesc() {
    let desc = `<b>【⚔️ ターン制お邪魔対戦】</b><br>じゃんけんで先攻後攻を決定！交互に玉を打ちます。<br>出現する「？」付きの玉を消すとアイテムルーレットが発生！<br><b>✨ルール: 先に500個消すか、玉が危険ライン（点線）を超えると敗北！</b><br><br>• 勝利条件: ${targetWins}勝先取`;
    let descEl = document.getElementById('rules-text-content');
    if (descEl) descEl.innerHTML = desc;
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
    bombUsesLeft = 2;
    initGridForStage(1);
    spawnBullet();
    gameState = 'playing';
    playRandomBGM();
    startJankenPhase();
}

// ==========================================
// 7. じゃんけんフェーズ
// ==========================================
function startJankenPhase() {
    battleTurnState = 'janken';
    myJankenChoice = '';
    opponentJankenChoice = '';
    jankenResultMsg = 'じゃんけんの手を選んでください';
    
    let container = document.getElementById('janken-overlay');
    if (!container) {
        createJankenOverlayDOM();
    }
    let statusMsg = document.getElementById('janken-status-msg');
    let buttonsEl = document.getElementById('janken-choice-buttons');
    let roleSelectEl = document.getElementById('janken-role-select');
    
    if (statusMsg) statusMsg.innerText = jankenResultMsg;
    if (buttonsEl) buttonsEl.style.display = 'flex';
    if (roleSelectEl) roleSelectEl.style.display = 'none';
    if (container) container.style.display = 'flex';

    if (battleRole === 'host') {
        if (conn && conn.open) conn.send({ type: 'start_janken' });
    }
}

function openJankenScreen() {
    battleTurnState = 'janken';
    myJankenChoice = '';
    opponentJankenChoice = '';
    jankenResultMsg = 'じゃんけんの手を選んでください';
    
    let statusMsg = document.getElementById('janken-status-msg');
    let buttonsEl = document.getElementById('janken-choice-buttons');
    let roleSelectEl = document.getElementById('janken-role-select');
    let overlay = document.getElementById('janken-overlay');

    if (statusMsg) statusMsg.innerText = jankenResultMsg;
    if (buttonsEl) buttonsEl.style.display = 'flex';
    if (roleSelectEl) roleSelectEl.style.display = 'none';
    if (overlay) overlay.style.display = 'flex';
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
                <button id="btn-role-first" class="menu-btn" style="touch-action:manipulation;">先行で始める</button>
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
            if (statusMsgEl) statusMsgEl.innerText = "あなたの勝ち！ 先行か後攻を選んでください";
            if (roleSelectEl) roleSelectEl.style.display = 'flex';
        } else {
            if (statusMsgEl) statusMsgEl.innerText = "あなたの負け... 相手の選択を待っています";
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
            opponentTurnNoticeText = "💤 1回休み！ 相手の連続ターンです";
            opponentTurnNoticeTimer = 90;
            playSE(se.bombExplode);
            return;
        }

        battleTurnState = 'my_turn';
        startTurnTimer();
    }
}

// ==========================================
// 8. アナウンス（電光掲示板・演出）
// ==========================================
function checkMilestoneAndTriggerMarquee(count) {
    let milestones = [100, 200, 300, 400, 450];
    for (let m of milestones) {
        if (count >= m && !triggeredMilestones.has(m)) {
            triggeredMilestones.add(m);
            triggerMarqueeAnnouncement(`相手が ${m} 個の玉を消しました！`);
            break;
        }
    }
}

function triggerMarqueeAnnouncement(text) {
    activeMarqueeText = text;
    marqueeX = 305;
    marqueeTimer = 180; 
}

// ==========================================
// 9. アイテムシステム (ルーレット & 色変更)
// ==========================================
function triggerItemRoulette() {
    isRouletteActive = true;
    isRouletteStopping = false;
    rouletteItemIndex = Math.floor(Math.random() * 5);
    
    let container = document.getElementById('roulette-overlay');
    if (!container) {
        createRouletteOverlayDOM();
    }
    document.getElementById('roulette-overlay').style.display = 'flex';
    let stopBtn = document.getElementById('btn-stop-roulette');
    if (stopBtn) {
        stopBtn.style.transform = 'scale(1)';
        stopBtn.style.background = '#ff5722';
        stopBtn.innerText = 'STOP!';
    }
    
    playSE(se.rainbowSet);

    rouletteInterval = setInterval(() => {
        if (isRouletteStopping) return;
        rouletteItemIndex = (rouletteItemIndex + 1) % 5;
        updateRouletteDisplay();
    }, 90);
}

function updateRouletteDisplay() {
    let names = ['① お邪魔×2', '② お邪魔×3', '③ スキップ', '④ 貫通', '⑤ 色変更'];
    let descList = [
        '【お邪魔×2】お邪魔玉の数が2倍増！',
        '【お邪魔×3】お邪魔玉の数が3倍増！',
        '【スキップ】相手に1回休みを付与！',
        '【貫通】壁・玉を突き抜け直進＆全消し！',
        '【色変更】指定した色の玉を別の色へ一斉変更！'
    ];
    let displayBox = document.getElementById('roulette-display-box');
    if (displayBox) {
        displayBox.innerText = names[rouletteItemIndex];
        if (rouletteStopShakeTimer > 0) {
            let offsetX = (Math.random() - 0.5) * 8;
            let offsetY = (Math.random() - 0.5) * 8;
            displayBox.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
        } else {
            displayBox.style.transform = 'translate(0, 0)';
        }
    }
    let descBox = document.getElementById('roulette-desc-box');
    if (descBox) descBox.innerText = descList[rouletteItemIndex];
}

function createRouletteOverlayDOM() {
    let overlay = document.createElement('div');
    overlay.id = 'roulette-overlay';
    overlay.className = 'overlay-screen';
    overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:1100; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
    
    overlay.innerHTML = `
        <div style="background:#222; padding:30px; border-radius:15px; text-align:center; width:300px; border:2px solid #ffcc00;">
            <h2 style="color:#ffcc00; margin-bottom:10px;">🎁 アイテムルーレット！</h2>
            <p style="font-size:12px; color:#aaa; margin-bottom:20px;">ストップボタンでアイテムをゲット！(最大5個ストック)</p>
            <div id="roulette-display-box" style="background:#333; color:#4dff4d; font-size:22px; font-weight:bold; padding:20px; border-radius:10px; border:2px solid #555; margin-bottom:15px; transition: transform 0.05s;">
                ① お邪魔×2
            </div>
            <p id="roulette-desc-box" style="font-size:12px; color:#ddd; margin-bottom:25px; min-height:35px;">【お邪魔×2】お邪魔玉の数が2倍増！</p>
            <button id="btn-stop-roulette" class="menu-btn" style="touch-action:manipulation; background:#ff5722;">STOP!</button>
        </div>
    `;
    document.body.appendChild(overlay);

    ['touchstart', 'click'].forEach(evt => {
        document.getElementById('btn-stop-roulette').addEventListener(evt, (e) => {
            e.preventDefault();
            stopItemRoulette();
        }, { passive: false });
    });
}

function stopItemRoulette() {
    if (!isRouletteActive || isRouletteStopping) return;
    isRouletteStopping = true;
    clearInterval(rouletteInterval);

    playSE(se.ballLand);
    let stopBtn = document.getElementById('btn-stop-roulette');
    if (stopBtn) {
        stopBtn.style.background = '#4dff4d';
        stopBtn.innerText = 'GET!';
    }

    rouletteStopShakeTimer = 25;
    let shakeInterval = setInterval(() => {
        rouletteStopShakeTimer--;
        updateRouletteDisplay();
        if (rouletteStopShakeTimer <= 0) {
            clearInterval(shakeInterval);
            finalizeRouletteItem();
        }
    }, 16);
}

function finalizeRouletteItem() {
    if (!isRouletteActive) return;
    isRouletteActive = false;
    
    if (itemStockCounts[rouletteItemIndex] < 5) {
        itemStockCounts[rouletteItemIndex]++;
    }

    document.getElementById('roulette-overlay').style.display = 'none';
}

function openColorChangeOverlay() {
    stopTurnTimer(); 
    let container = document.getElementById('colorchange-overlay');
    if (!container) {
        createColorChangeOverlayDOM();
    }
    colorChangeStep = 1;
    colorChangeSourceColor = '';
    
    document.getElementById('cc-step1-section').style.opacity = '1';
    document.getElementById('cc-step2-section').style.opacity = '0.3';
    document.getElementById('cc-step2-section').style.pointerEvents = 'none';
    
    document.querySelectorAll('.cc-src-btn').forEach(b => b.style.borderColor = '#fff');
    document.querySelectorAll('.cc-dst-btn').forEach(b => { b.style.borderColor = '#fff'; b.style.transform = 'scale(1)'; });

    document.getElementById('colorchange-overlay').style.display = 'flex';
}

function createColorChangeOverlayDOM() {
    let overlay = document.createElement('div');
    overlay.id = 'colorchange-overlay';
    overlay.className = 'overlay-screen';
    overlay.style.cssText = "display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.85); z-index:1150; flex-direction:column; justify-content:center; align-items:center; color:#fff;";
    
    overlay.innerHTML = `
        <div style="background:#222; padding:20px; border-radius:15px; text-align:center; width:310px; border:2px solid #4da6ff;">
            <h3 style="color:#4da6ff; margin-bottom:12px; font-size:16px;">🎨 色変更アイテム</h3>
            
            <div id="cc-step1-section" style="transition: opacity 0.3s;">
                <p style="font-size:12px; color:#ffcc00; margin-bottom:6px; font-weight:bold;">1. 変えたい色の玉を選択</p>
                <div id="cc-src-buttons" style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap; margin-bottom:5px;"></div>
            </div>

            <div style="font-size:28px; font-weight:bold; color:#4da6ff; margin:4px 0; text-shadow:0 0 8px rgba(77,166,255,0.6);">↓</div>

            <div id="cc-step2-section" style="opacity:0.3; pointer-events:none; transition: opacity 0.3s;">
                <p style="font-size:12px; color:#4dff4d; margin-bottom:6px; font-weight:bold;">2. 変更先の色の玉を選択</p>
                <div id="cc-dst-buttons" style="display:flex; justify-content:center; gap:8px; flex-wrap:wrap; margin-bottom:12px;"></div>
            </div>

            <button id="btn-cancel-cc" class="menu-btn gray" style="touch-action:manipulation; font-size:12px; padding:8px; width:120px; margin:0 auto;">キャンセル</button>
        </div>
    `;
    document.body.appendChild(overlay);

    let srcContainer = document.getElementById('cc-src-buttons');
    let dstContainer = document.getElementById('cc-dst-buttons');

    BASE_COLORS.forEach(col => {
        let srcBtn = document.createElement('button');
        srcBtn.className = 'cc-src-btn';
        srcBtn.style.cssText = `width:40px; height:40px; border-radius:50%; background:${col}; border:3px solid #fff; cursor:pointer; touch-action:manipulation;`;
        ['touchstart', 'click'].forEach(evt => {
            srcBtn.addEventListener(evt, (e) => {
                e.preventDefault();
                handleColorChangeStep1(col, srcBtn);
            }, { passive: false });
        });
        srcContainer.appendChild(srcBtn);

        let dstBtn = document.createElement('button');
        dstBtn.className = 'cc-dst-btn';
        dstBtn.style.cssText = `width:40px; height:40px; border-radius:50%; background:${col}; border:3px solid #fff; cursor:pointer; touch-action:manipulation;`;
        ['touchstart', 'click'].forEach(evt => {
            dstBtn.addEventListener(evt, (e) => {
                e.preventDefault();
                handleColorChangeStep2(col);
            }, { passive: false });
        });
        dstContainer.appendChild(dstBtn);
    });

    ['touchstart', 'click'].forEach(evt => {
        document.getElementById('btn-cancel-cc').addEventListener(evt, (e) => {
            e.preventDefault();
            document.getElementById('colorchange-overlay').style.display = 'none';
            if (gameMode === 'battle') {
                startTurnTimer(); 
            }
        }, { passive: false });
    });
}

function handleColorChangeStep1(col, btnElement) {
    colorChangeSourceColor = col;
    colorChangeStep = 2;

    document.querySelectorAll('.cc-src-btn').forEach(b => b.style.borderColor = '#fff');
    btnElement.style.borderColor = '#ffcc00';

    document.getElementById('cc-step1-section').style.opacity = '0.4';
    document.getElementById('cc-step2-section').style.opacity = '1';
    document.getElementById('cc-step2-section').style.pointerEvents = 'auto';
}

function handleColorChangeStep2(targetColor) {
    if (colorChangeStep !== 2) return;
    
    document.getElementById('colorchange-overlay').style.display = 'none';
    
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r][c];
            if (cell !== null && cell.color === colorChangeSourceColor) {
                grid[r][c].color = targetColor;
            }
        }
    }
    playSE(se.rainbowLand);
    
    if (itemStockCounts[4] > 0) {
        itemStockCounts[4]--;
    }
    activeItems = activeItems.filter(i => i !== 4);

    if (gameMode === 'battle') {
        startTurnTimer(); 
    }
}

function clickItemButton(idx) {
    if (gameMode !== 'battle' || battleTurnState !== 'my_turn') return;
    if (isMoving) return;
    if (itemStockCounts[idx] <= 0) return;

    if (activeItems.includes(idx)) {
        activeItems = activeItems.filter(i => i !== idx);
        return;
    }

    if ((idx === 0 && activeItems.includes(1)) || (idx === 1 && activeItems.includes(0))) {
        activeItems = activeItems.filter(i => i !== 0 && i !== 1);
    }

    if (activeItems.length >= 2) {
        activeItems.shift();
    }

    activeItems.push(idx);

    if (idx === 4) {
        openColorChangeOverlay();
    }
}

// ==========================================
// 10. お邪魔玉飛来・計算処理
// ==========================================
function countWallReflections(launchAngle, speed) {
    let simX = shooterX;
    let simY = shooterY;
    let simVX = Math.cos(launchAngle) * speed;
    let simVY = Math.sin(launchAngle) * speed;
    let reflections = 0;

    let steps = 0;
    while (steps < 300) {
        steps++;
        simX += simVX / 4;
        simY += simVY / 4;

        if (simX - RADIUS <= 0) {
            simX = RADIUS;
            simVX *= -1;
            reflections++;
        } else if (simX + RADIUS >= 305) {
            simX = 305 - RADIUS;
            simVX *= -1;
            reflections++;
        }

        if (simY - RADIUS <= TOP_MARGIN) {
            break;
        }

        let hit = false;
        for (let r = 0; r < ROWS; r++) {
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            for (let c = 0; c < colsInRow; c++) {
                if (grid[r][c] !== null) {
                    let pos = getPixelCoords(r, c);
                    if (Math.hypot(simX - pos.x, simY - pos.y) <= DIAMETER - 2) {
                        hit = true;
                        break;
                    }
                }
            }
            if (hit) break;
        }
        if (hit) break;
    }
    return reflections;
}

function launchOjamaProjectilesFromBottom(amount) {
    if (amount <= 0) return;
    let safeAmount = Math.min(amount, 15);

    attackNoticeText = `⚠️ お邪魔玉 +${safeAmount} 飛来中！`;
    attackNoticeTimer = 75; 
    shakeTimer = Math.min(shakeTimer + 10, 30); 
    playSE(se.bombExplode);

    for (let i = 0; i < safeAmount; i++) {
        setTimeout(() => {
            let startX = Math.random() * 220 + 40;
            let startY = canvas.height + 40; 
            let gridCell = getRandomGridCell(); 
            
            let targetCoords = findLowestAvailableGridCoords();
            let targetPos = getPixelCoords(targetCoords.r, targetCoords.c);
            
            flyingOjamaList.push({
                x: startX,
                y: startY,
                targetY: targetPos.y,
                targetR: targetCoords.r,
                targetC: targetCoords.c,
                cellData: gridCell,
                vy: -(8 + Math.random() * 2) 
            });
        }, i * 120);
    }
}

function findLowestAvailableGridCoords() {
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            if (grid[r][c] === null) {
                return { r, c };
            }
        }
    }
    return { r: 0, c: 0 };
}

function applyOjamaToGrid(cellData, targetR, targetC) {
    let placed = false;

    if (targetR >= 0 && targetR < ROWS) {
        let colsInRow = (targetR % 2 === 0) ? COLS : COLS - 1;
        if (targetC >= 0 && targetC < colsInRow && grid[targetR][targetC] === null) {
            grid[targetR][targetC] = { color: cellData.color, isOjama: true, isMystery: cellData.isMystery };
            placed = true;
        }
    }

    if (!placed) {
        for (let r = 0; r < ROWS; r++) {
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            for (let c = 0; c < colsInRow; c++) {
                if (grid[r][c] === null) {
                    grid[r][c] = { color: cellData.color, isOjama: true, isMystery: cellData.isMystery };
                    placed = true;
                    break;
                }
            }
            if (placed) break;
        }
    }

    checkGameOverCondition();
}

// ==========================================
// 11. ゲーム勝敗・勝敗判定 logic
// ==========================================
function retryStage() {
    bombUsesLeft = 2;
    remainingTime = STAGE_TIME_LIMIT;
    initGridForStage(currentStage);
    spawnBullet();
    gameState = 'playing';
    playRandomBGM();
    startTimer();
    showScreen('');
}

function nextStageAction() {
    if (currentStage < maxStages) {
        totalClearTime += (STAGE_TIME_LIMIT - remainingTime);
        currentStage++;
        bombUsesLeft = 2;
        remainingTime = STAGE_TIME_LIMIT;
        initGridForStage(currentStage);
        spawnBullet();
        gameState = 'playing';
        startTimer();
        showScreen('');
    }
}

function returnToTitle() {
    closeNetwork();
    stopBGM();
    stopTimer();
    stopTurnTimer();
    gameState = 'title';
    showScreen('screen-title');
}

function spawnBullet() {
    bulletData = nextBubble;
    nextBubble = getRandomShooterBubble();
    if (bulletData.color === SPECIAL_RAINBOW) playSE(se.rainbowSet);
    resetBulletPos();
    isMoving = false;
}

function resetBulletPos() {
    bulletX = shooterX;
    bulletY = shooterY;
    bulletVX = 0;
    bulletVY = 0;
    pullX = 0;
    pullY = 0;
}

function checkClearCondition() {
    if (fallingBubbles.length > 0 || flashingBubbles.length > 0 || flyingOjamaList.length > 0) return;

    let hasBreakable = false;
    for (let r = 0; r < grid.length; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r][c];
            if (cell !== null && cell.color !== UNBREAKABLE_COLOR) {
                hasBreakable = true; break;
            }
        }
        if (hasBreakable) break;
    }

    if (!hasBreakable) {
        playSE(se.stageClear);
        if (gameMode === 'battle') {
            if (battleRole === 'host') {
                handleHostRoundDecide('YOU');
            } else {
                if (conn && conn.open) conn.send({ type: 'guest_request_round_win' });
            }
        } else {
            if (currentStage < maxStages) {
                gameState = 'stage_clear_menu';
                let scoreText = document.getElementById('clear-score-text');
                if (scoreText) scoreText.innerText = `ステージ ${currentStage} クリア！\nスコア: ${score}`;
                showScreen('screen-stage-clear');
            } else {
                stopTimer();
                totalClearTime += (STAGE_TIME_LIMIT - remainingTime);
                initWinParticles();
                gameState = 'gameclear';
                showScreen('');
            }
        }
    }
}

function triggerSoloGameOver(msg) {
    stopTimer();
    stopBGM();
    playSE(se.gameOver);
    gameState = 'gameover_menu';
    let scoreText = document.getElementById('gameover-score-text');
    if (scoreText) scoreText.innerText = `${msg}\nスコア: ${score}`;
    showScreen('screen-game-over');
}

function checkGameOverCondition() {
    if (gameState !== 'playing') return;
    if (flyingOjamaList.length > 0) return;
    if (fallingBubbles.length > 0 || flashingBubbles.length > 0) return; 

    let limitRow = ROWS - 1; 

    for (let r = limitRow; r < ROWS; r++) {
        let rowCols = (r % 2 === 0) ? COLS : COLS - 1;
        for (let cc = 0; cc < rowCols; cc++) {
            if (grid[r][cc] !== null) {
                if (gameMode === 'battle') {
                    stopBGM();
                    stopTurnTimer();
                    gameState = 'gameover_menu';
                    
                    if (battleRole === 'host') {
                        handleHostRoundDecide('OPPONENT');
                    } else {
                        if (conn && conn.open) {
                            conn.send({ type: 'guest_game_over' });
                        }
                    }
                } else {
                    triggerSoloGameOver(`ステージ ${currentStage} で終了`);
                }
                return;
            }
        }
    }
}

function check500WinCondition() {
    if (gameState !== 'playing' || gameMode !== 'battle') return;

    if (myClearedBubbleCount >= TARGET_CLEARED_COUNT) {
        stopBGM();
        stopTurnTimer();
        gameState = 'gameover_menu';
        if (battleRole === 'host') {
            handleHostRoundDecide('YOU');
        } else {
            if (conn && conn.open) conn.send({ type: 'guest_request_500_win' });
        }
    } else if (opponentClearedBubbleCount >= TARGET_CLEARED_COUNT) {
        stopBGM();
        stopTurnTimer();
        gameState = 'gameover_menu';
        if (battleRole === 'host') {
            handleHostRoundDecide('OPPONENT');
        }
    }
}

function handleHostRoundDecide(roundWinnerRole) {
    if (battleRole !== 'host') return;

    if (roundWinnerRole === 'YOU') {
        myWins++;
    } else {
        opponentWins++;
    }

    if (conn && conn.open) {
        conn.send({
            type: 'sync_round_end',
            myWins: myWins,
            opponentWins: opponentWins,
            winner: roundWinnerRole
        });
    }

    checkBattleSetEnd(roundWinnerRole);
}

function handleTimeOutGameOver() {
    triggerSoloGameOver(`タイムアップ！ (ステージ ${currentStage})`);
}

function requestRematch() {
    if (battleRole === 'host') {
        myWins = 0;
        opponentWins = 0;
        if (conn && conn.open) conn.send({ type: 'rematch' });
        startNextRound();
    } else {
        if (conn && conn.open) conn.send({ type: 'rematch' });
    }
}

function checkBattleSetEnd(roundWinner) {
    if (myWins >= targetWins || opponentWins >= targetWins) {
        battleWinner = (myWins >= targetWins) ? 'YOU' : 'OPPONENT';
        
        gameState = 'battle_result';
        stopBGM();
        stopTurnTimer();
        playSE(se.gameOver);

        let titleEl = document.getElementById('battle-result-title');
        let subEl = document.getElementById('battle-result-sub');
        let loserControls = document.getElementById('battle-loser-controls');
        let winnerWait = document.getElementById('battle-winner-wait');

        if (battleWinner === 'YOU') {
            if (titleEl) {
                titleEl.innerText = "🏆 勝利！ WINNER!";
                titleEl.style.color = "#ffcc00";
            }
            if (subEl) subEl.innerText = `勝利達成！ (${myWins}勝 - ${opponentWins}勝)`;
            initWinParticles(); 
            if (loserControls) loserControls.style.display = 'block';
            if (winnerWait) winnerWait.style.display = 'none';
        } else {
            if (titleEl) {
                titleEl.innerText = "💀 敗北... LOSER";
                titleEl.style.color = "#ff4d4d";
            }
            if (subEl) subEl.innerText = `対戦に敗北しました (${myWins}勝 - ${opponentWins}勝)`;
            initLoseParticles(); 
            if (loserControls) loserControls.style.display = 'block';
            if (winnerWait) winnerWait.style.display = 'none';
        }

        showScreen('screen-battle-result');
    } else {
        alert(`ラウンド終了！\n現在: あなた ${myWins}勝 - 相手 ${opponentWins}勝`);
        startNextRound();
    }
}

// ==========================================
// 12. パーティクル・紙吹雪演出
// ==========================================
function initWinParticles() {
    particles = [];
    fireworks = [];
}

function spawnFirework() {
    const x = Math.random() * (canvas.width - 120) + 50;
    const targetY = Math.random() * (canvas.height * 0.4) + 50;
    fireworks.push({
        x: x,
        y: canvas.height,
        targetY: targetY,
        vy: -7 - Math.random() * 3,
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)]
    });
}

function createExplosion(x, y, color) {
    const count = 40;
    for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + Math.random() * 0.2;
        const speed = Math.random() * 4 + 2;
        particles.push({
            type: 'firework_spark',
            x: x,
            y: y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            alpha: 1.0,
            color: color,
            size: Math.random() * 3 + 2
        });
    }
}

function initLoseParticles() {
    particles = [];
    fireworks = [];
    for (let i = 0; i < 80; i++) {
        particles.push({
            type: 'rain',
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height,
            len: Math.random() * 15 + 10,
            vy: Math.random() * 6 + 10,
            color: 'rgba(120, 160, 255, 0.6)'
        });
    }
}

function updateParticles() {
    if ((gameState === 'battle_result' && battleWinner === 'YOU' || gameState === 'gameclear') && Math.random() < 0.05) {
        spawnFirework();
    }

    for (let i = fireworks.length - 1; i >= 0; i--) {
        let fw = fireworks[i];
        fw.y += fw.vy;
        if (fw.y <= fw.targetY) {
            createExplosion(fw.x, fw.y, fw.color);
            fireworks.splice(i, 1);
        }
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        let p = particles[i];
        if (p.type === 'firework_spark') {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.05;
            p.alpha -= 0.02;
            if (p.alpha <= 0) particles.splice(i, 1);
        } else if (p.type === 'rain') {
            p.y += p.vy;
            if (p.y > canvas.height) {
                p.y = -20;
                p.x = Math.random() * canvas.width;
            }
        }
    }
}

function drawParticles() {
    for (let fw of fireworks) {
        ctx.beginPath();
        ctx.arc(fw.x, fw.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = fw.color;
        ctx.fill();
        ctx.closePath();
    }

    for (let p of particles) {
        if (p.type === 'firework_spark') {
            ctx.save();
            ctx.globalAlpha = p.alpha;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.restore();
        } else if (p.type === 'rain') {
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p.x, p.y + p.len);
            ctx.strokeStyle = p.color;
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.closePath();
        }
    }
}

// ==========================================
// 13. 入力（タッチ & マウス）イベント処理
// ==========================================
function getTouchPos(e) {
    const rect = canvas.getBoundingClientRect();
    let clientX = e.touches && e.touches.length > 0 ? e.touches[0].clientX : e.clientX;
    let clientY = e.touches && e.touches.length > 0 ? e.touches[0].clientY : e.clientY;
    
    let scaleX = canvas.width / rect.width;
    let scaleY = canvas.height / rect.height;

    let x = (clientX - rect.left) * scaleX;
    let y = (clientY - rect.top) * scaleY;

    x = Math.max(0, Math.min(canvas.width, x));
    y = Math.max(0, Math.min(canvas.height, y));

    return { x, y };
}

canvas.addEventListener('touchstart', (e) => {
    unlockAudio();
    let pos = getTouchPos(e);

    if (gameMode === 'battle' && battleTurnState === 'my_turn') {
        if (pos.x >= 305 && pos.x <= 400 && pos.y >= 350 && pos.y <= 595) {
            let relY = pos.y - 350;
            let btnH = 43;
            let gap = 5;
            let idx = Math.floor(relY / (btnH + gap));
            if (idx >= 0 && idx < 5) {
                if (e.cancelable) e.preventDefault();
                clickItemButton(idx);
                return;
            }
        }
    }

    if (gameState === 'playing') {
        let jankenEl = document.getElementById('janken-overlay');
        if (!jankenEl || jankenEl.style.display === 'none') {
            if (e.cancelable) e.preventDefault();
        }
    }
    handleInputStart(pos);
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    let jankenEl = document.getElementById('janken-overlay');
    if (jankenEl && jankenEl.style.display === 'flex') return;
    if (e.cancelable) e.preventDefault();
    handleDragMove(getTouchPos(e));
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    if (isDragging) {
        if (e.cancelable) e.preventDefault();
        isDragging = false;
        releaseBullet();
    }
}, { passive: false });

canvas.addEventListener('touchcancel', () => {
    isDragging = false;
    pullX = 0; pullY = 0;
}, { passive: true });

function handleInputStart(pos) {
    if (gameState === 'title') return;

    let jankenEl = document.getElementById('janken-overlay');
    if (jankenEl && jankenEl.style.display === 'flex') return;

    let ccEl = document.getElementById('colorchange-overlay');
    if (ccEl && ccEl.style.display === 'flex') return;

    if (gameState === 'gameclear') {
        return;
    }

    if (gameState === 'playing' && !isMoving) {
        if (gameMode === 'battle' && battleTurnState !== 'my_turn') {
            return; 
        }

        if (pos.x >= 305 && pos.x <= 395) {
            if (pos.y >= 260 && pos.y <= 335) {
                if (bombUsesLeft > 0) {
                    bulletData = { color: SPECIAL_BOMB, isOjama: false, isMystery: false };
                    bombUsesLeft--;
                }
                return;
            }
        }

        isDragging = true;
        dragStartX = pos.x; dragStartY = pos.y;
        pullX = 0; pullY = 0;
    }
}

function handleDragMove(pos) {
    let dx = pos.x - dragStartX;
    let dy = pos.y - dragStartY;
    let dist = Math.hypot(dx, dy);
    if (dist > MAX_PULL_DISTANCE) {
        let angle = Math.atan2(dy, dx);
        dx = Math.cos(angle) * MAX_PULL_DISTANCE;
        dy = Math.sin(angle) * MAX_PULL_DISTANCE;
    }
    pullX = dx; pullY = dy;
}

function releaseBullet() {
    let pullDist = Math.hypot(pullX, pullY);
    if (pullDist < 12) { pullX = 0; pullY = 0; return; }

    let power = Math.min(1.0, pullDist / MAX_PULL_DISTANCE);
    let speed = MIN_SPEED + (MAX_SPEED - MIN_SPEED) * power;
    let launchAngle = Math.atan2(-pullY, -pullX);
    
    if (launchAngle < -0.05 && launchAngle > -Math.PI + 0.05) {
        if (activeItems.includes(3)) {
            let reflections = countWallReflections(launchAngle, speed);
            if (reflections > 2) {
                attackNoticeText = "⚠️ 左右の壁への反射が多すぎます (最大2回まで)";
                attackNoticeTimer = 75;
                pullX = 0; pullY = 0;
                return;
            }
        }

        piercingClearedThisTurn = 0;
        bulletVX = Math.cos(launchAngle) * speed;
        bulletVY = Math.sin(launchAngle) * speed;
        isMoving = true;
        playSE(se.ballShoot);
        stopTurnTimer(); 
    }
    pullX = 0; pullY = 0;
}

// ==========================================
// 14. 泡（玉）の消去・物理ロジック
// ==========================================
function getPixelCoords(r, c) {
    let offsetX = (r % 2 === 1) ? RADIUS : 0;
    let x = c * DIAMETER + RADIUS + offsetX;
    let y = r * ROW_HEIGHT + RADIUS + TOP_MARGIN;
    return { x, y };
}

function findCellForPosition(x, y) {
    let bestR = 0, bestC = 0, minDist = Infinity;
    
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let pos = getPixelCoords(r, c);
            let dist = Math.hypot(x - pos.x, y - pos.y);
            if (dist < minDist) {
                minDist = dist;
                bestR = r;
                bestC = c;
            }
        }
    }

    if (grid[bestR][bestC] !== null) {
        let altMinDist = Infinity, altR = bestR, altC = bestC;
        for (let r = 0; r < ROWS; r++) {
            let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
            for (let c = 0; c < colsInRow; c++) {
                if (grid[r][c] === null) {
                    let pos = getPixelCoords(r, c);
                    let dist = Math.hypot(x - pos.x, y - pos.y);
                    if (dist < altMinDist) {
                        altMinDist = dist;
                        altR = r;
                        altC = c;
                    }
                }
            }
        }
        return { r: altR, c: altC };
    }
    return { r: bestR, c: bestC };
}

function findConnected(r, c, color, visited = new Set()) {
    let key = `${r},${c}`;
    let colsInRow = (r >= 0 && r < ROWS) ? ((r % 2 === 0) ? COLS : COLS - 1) : 0;
    if (visited.has(key) || r < 0 || r >= ROWS || c < 0 || c >= colsInRow) return [];
    
    let cell = grid[r][c];
    if (cell === null || cell.color === UNBREAKABLE_COLOR || cell.color !== color) return [];

    visited.add(key);
    let matches = [{ r, c }];
    let neighbors = (r % 2 === 0) ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]] : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];
    for (let n of neighbors) matches = matches.concat(findConnected(r + n[0], c + n[1], color, visited));
    return matches;
}

function triggerFlashEffect(cellsToFlash, extraScore = 0) {
    if (cellsToFlash.length === 0) return;
    flashingBubbles.push({ cells: cellsToFlash, timer: 30 });
    score += extraScore;
}

function removeFloating() {
    let visited = new Set();
    for (let c = 0; c < COLS; c++) {
        if (grid[0][c] !== null) markConnectedFromCeiling(0, c, visited);
    }

    let droppedCount = 0;
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r][c];
            if (cell !== null && !visited.has(`${r},${c}`)) {
                let cellData = cell;
                let pos = getPixelCoords(r, c);
                fallingBubbles.push({ x: pos.x, y: pos.y, vy: 2 + Math.random() * 2, color: cellData.color, isMystery: cellData.isMystery });
                
                if (cellData.isMystery) {
                    triggerItemRoulette();
                }

                grid[r][c] = null;
                droppedCount++;
            }
        }
    }
    if (droppedCount > 0) {
        score += droppedCount * 20;
        playSE(se.blockFall);
    }
    return droppedCount;
}

function markConnectedFromCeiling(r, c, visited) {
    let key = `${r},${c}`;
    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
    if (visited.has(key) || r < 0 || r >= ROWS || c < 0 || c >= colsInRow) return;
    if (grid[r][c] === null) return;
    visited.add(key);
    let neighbors = (r % 2 === 0) ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]] : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];
    for (let n of neighbors) markConnectedFromCeiling(r + n[0], c + n[1], visited);
}

// ==========================================
// 15. フレーム更新 (Update)
// ==========================================
function update() {
    if (gameState === 'gameclear' || gameState === 'battle_result') {
        updateParticles();
        return;
    }

    if (attackNoticeTimer > 0) attackNoticeTimer--;
    if (opponentTurnNoticeTimer > 0) opponentTurnNoticeTimer--;
    if (shakeTimer > 0) shakeTimer--;
    if (marqueeTimer > 0) {
        marqueeTimer--;
        marqueeX -= 3; 
    }

    for (let i = flyingOjamaList.length - 1; i >= 0; i--) {
        let oj = flyingOjamaList[i];
        oj.y += oj.vy; 
        if (oj.y <= oj.targetY) {
            applyOjamaToGrid(oj.cellData, oj.targetR, oj.targetC);
            flyingOjamaList.splice(i, 1);
            
            if (flyingOjamaList.length === 0 && gameMode === 'battle' && battleTurnState === 'opponent_turn') {
                battleTurnState = 'my_turn';
                startTurnTimer();
            }
        }
    }

    for (let i = fallingBubbles.length - 1; i >= 0; i--) {
        let fb = fallingBubbles[i];
        fb.y += fb.vy; fb.vy += 0.6;
        if (fb.y > canvas.height + 50) fallingBubbles.splice(i, 1);
    }

    for (let i = flashingBubbles.length - 1; i >= 0; i--) {
        flashingBubbles[i].timer--;
        if (flashingBubbles[i].timer <= 0) {
            flashingBubbles.splice(i, 1);
            removeFloating();
            checkClearCondition();
            checkGameOverCondition(); 
        }
    }

    if (fallingBubbles.length === 0 && flashingBubbles.length === 0 && flyingOjamaList.length === 0 && gameState === 'playing') {
        checkClearCondition();
        checkGameOverCondition();
    }

    if (gameState === 'playing' && isMoving) {
        let steps = 4;
        let stepVX = bulletVX / steps;
        let stepVY = bulletVY / steps;

        for (let s = 0; s < steps; s++) {
            bulletX += stepVX;
            bulletY += stepVY;

            if (bulletX - RADIUS <= 0) { 
                bulletX = RADIUS; 
                bulletVX *= -1; 
                stepVX *= -1;
            } else if (bulletX + RADIUS >= 305) {
                bulletX = 305 - RADIUS; 
                bulletVX *= -1; 
                stepVX *= -1;
            }

            if (activeItems.includes(3)) {
                if (bulletY - RADIUS <= TOP_MARGIN) {
                    bulletY = TOP_MARGIN + RADIUS;
                    snapBullet();
                    return;
                }
                for (let r = 0; r < ROWS; r++) {
                    let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
                    for (let c = 0; c < colsInRow; c++) {
                        let cell = grid[r][c];
                        if (cell !== null && cell.color !== UNBREAKABLE_COLOR) {
                            let pos = getPixelCoords(r, c);
                            if (Math.hypot(bulletX - pos.x, bulletY - pos.y) <= DIAMETER) {
                                if (cell.isMystery) triggerItemRoulette();
                                fallingBubbles.push({ x: pos.x, y: pos.y, vy: 2 + Math.random() * 2, color: cell.color, isMystery: cell.isMystery });
                                grid[r][c] = null;
                                score += 20;
                                piercingClearedThisTurn++;
                            }
                        }
                    }
                }
                continue;
            }

            if (bulletY - RADIUS <= TOP_MARGIN) {
                bulletY = TOP_MARGIN + RADIUS;
                snapBullet();
                return;
            }

            for (let r = 0; r < ROWS; r++) {
                let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
                for (let c = 0; c < colsInRow; c++) {
                    if (grid[r][c] !== null) {
                        let pos = getPixelCoords(r, c);
                        if (Math.hypot(bulletX - pos.x, bulletY - pos.y) <= DIAMETER - 2) {
                            snapBullet();
                            return;
                        }
                    }
                }
            }
        }
    }
}

function snapBullet() {
    let wasPiercing = activeItems.includes(3);
    isMoving = false;
    let cell = findCellForPosition(bulletX, bulletY);
    
    let baseClearedCount = 0;

    if (wasPiercing) {
        playSE(se.bombExplode);
        let floatCount = removeFloating();
        baseClearedCount = piercingClearedThisTurn + floatCount; 
    } else if (cell.r >= 0 && cell.r < ROWS) {
        let colsInRow = (cell.r % 2 === 0) ? COLS : COLS - 1;
        cell.c = Math.max(0, Math.min(colsInRow - 1, cell.c));

        if (grid[cell.r][cell.c] === null) {
            if (bulletData.color === SPECIAL_BOMB) {
                playSE(se.bombExplode);
                let affectedCells = [{ r: cell.r, c: cell.c }];
                let neighbors = (cell.r % 2 === 0) ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]] : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];
                for (let n of neighbors) {
                    let nr = cell.r + n[0], nc = cell.c + n[1];
                    let nCols = (nr >= 0 && nr < ROWS) ? ((nr % 2 === 0) ? COLS : COLS - 1) : 0;
                    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < nCols && grid[nr][nc] !== null && grid[nr][nc].color !== UNBREAKABLE_COLOR) {
                        affectedCells.push({ r: nr, c: nc });
                    }
                }
                let flashList = [];
                let bombCleared = 0;
                for (let ac of affectedCells) {
                    let targetCell = grid[ac.r][ac.c];
                    if (targetCell !== null && targetCell.color !== UNBREAKABLE_COLOR) {
                        if (targetCell.isMystery) triggerItemRoulette();
                        flashList.push({ r: ac.r, c: ac.c });
                        grid[ac.r][ac.c] = null;
                        bombCleared++;
                    }
                }
                triggerFlashEffect(flashList, flashList.length * 40);
                let floatCount = removeFloating();
                baseClearedCount = bombCleared + floatCount;
            } else if (bulletData.color === SPECIAL_RAINBOW) {
                playSE(se.rainbowLand);
                let targetColor = null;
                let neighbors = (cell.r % 2 === 0) ? [[-1,-1], [-1,0], [0,-1], [0,1], [1,-1], [1,0]] : [[-1,0], [-1,1], [0,-1], [0,1], [1,0], [1,1]];
                for (let n of neighbors) {
                    let nr = cell.r + n[0], nc = cell.c + n[1];
                    let nCols = (nr >= 0 && nr < ROWS) ? ((nr % 2 === 0) ? COLS : COLS - 1) : 0;
                    if (nr >= 0 && nr < ROWS && nc >= 0 && nc < nCols && grid[nr][nc] !== null && grid[nr][nc].color !== UNBREAKABLE_COLOR) {
                        targetColor = grid[nr][nc].color; break;
                    }
                }
                if (targetColor !== null) {
                    let clearedCount = 0;
                    for (let r = 0; r < ROWS; r++) {
                        let rCols = (r % 2 === 0) ? COLS : COLS - 1;
                        for (let c = 0; c < rCols; c++) {
                            let gCell = grid[r][c];
                            if (gCell !== null && gCell.color === targetColor) {
                                if (gCell.isMystery) triggerItemRoulette();
                                let pos = getPixelCoords(r, c);
                                fallingBubbles.push({ x: pos.x, y: pos.y, vy: 2 + Math.random() * 2, color: targetColor, isMystery: gCell.isMystery });
                                grid[r][c] = null; clearedCount++;
                            }
                        }
                    }
                    score += clearedCount * 30;
                    let floatCount = removeFloating();
                    baseClearedCount = clearedCount + floatCount;
                }
            } else {
                playSE(se.ballLand);
                grid[cell.r][cell.c] = { color: bulletData.color, isOjama: false, isMystery: bulletData.isMystery };
                let matches = findConnected(cell.r, cell.c, bulletData.color);
                if (matches.length >= 3) {
                    for (let m of matches) {
                        let mCell = grid[m.r][m.c];
                        if (mCell && mCell.isMystery) triggerItemRoulette();
                        let pos = getPixelCoords(m.r, m.c);
                        fallingBubbles.push({ x: pos.x, y: pos.y, vy: 2 + Math.random() * 2, color: bulletData.color, isMystery: mCell ? mCell.isMystery : false });
                        grid[m.r][m.c] = null; score += 10;
                    }
                    let floatCount = removeFloating();
                    baseClearedCount = matches.length + floatCount;
                }
            }
        }
    }
    
    myClearedBubbleCount += baseClearedCount;
    check500WinCondition();
    spawnBullet();

    // 消した玉の数に応じて生成するお邪魔玉の計算
    let generatedOjama = baseClearedCount * 2; 

    let itemsUsedThisTurn = [...activeItems];
    
    for (let usedIdx of itemsUsedThisTurn) {
        if (itemStockCounts[usedIdx] > 0) {
            itemStockCounts[usedIdx]--;
        }
    }

    if (itemsUsedThisTurn.includes(0)) generatedOjama *= 2; 
    if (itemsUsedThisTurn.includes(1)) generatedOjama *= 3; 

    if (gameMode === 'battle') {
        if (conn && conn.open) {
            conn.send({ 
                type: 'sync_turn_action', 
                ojamaAmount: generatedOjama, 
                didClear: false, 
                activeItemsUsed: itemsUsedThisTurn, 
                myClearedCount: myClearedBubbleCount 
            });
        }

        if (itemsUsedThisTurn.includes(2)) {
            battleTurnState = 'my_turn';
            startTurnTimer();
        } else {
            switchTurnToOpponent();
        }
    }

    activeItems = [];
    piercingClearedThisTurn = 0;
    checkClearCondition();
    checkGameOverCondition();
}

// ==========================================
// 16. 描画 (Draw) ロジック
// ==========================================
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (gameState === 'title') { drawTitleBackground(); return; }
    if (gameState === 'gameclear') { drawGameClearScreen(); return; }
    if (gameState === 'battle_result') { drawBattleResultScreen(); return; }

    ctx.save();
    if (shakeTimer > 0) {
        let offsetX = (Math.random() - 0.5) * 10;
        let offsetY = (Math.random() - 0.5) * 10;
        ctx.translate(offsetX, offsetY);
    }

    // --- 右側サイドパネルの描画 ---
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(305, 0, 95, canvas.height);
    ctx.strokeStyle = "#444";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(305, 0); ctx.lineTo(305, canvas.height); ctx.stroke();

    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px sans-serif";
    if (gameMode === 'battle') {
        let roleText = battleRole === 'host' ? '1P(H)' : '2P(G)';
        ctx.fillText(`対戦[${roleText}]`, 312, 22);
        ctx.fillText(` (${targetWins}勝先取)`, 312, 38);
        ctx.fillStyle = "#ffcc00";
        ctx.fillText(`${myWins}勝 - ${opponentWins}勝`, 312, 56);
        ctx.fillStyle = "#fff";
        ctx.fillText(`${battleType}`, 312, 74);

        ctx.fillStyle = (battleTurnState === 'my_turn') ? "#4dff4d" : "#ff4d4d";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(battleTurnState === 'my_turn' ? `あなたの番 (${turnRemainingTime}s)` : "相手の番", 312, 105);

        ctx.fillStyle = "#4da6ff";
        ctx.font = "bold 9px sans-serif";
        ctx.fillText("MY消去数", 352, 128);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`${myClearedBubbleCount}/500`, 352, 146);

        ctx.fillStyle = "#ff7777";
        ctx.font = "bold 9px sans-serif";
        ctx.fillText("OPP消去数", 352, 168);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 15px sans-serif";
        ctx.fillText(`${opponentClearedBubbleCount}/500`, 352, 186);
        ctx.textAlign = "left";
    } else {
        ctx.fillStyle = "#ffcc00";
        ctx.fillText(`ST ${currentStage}/10`, 312, 25);
        ctx.fillStyle = "#fff";
        ctx.fillText(`TIME: ${remainingTime}s`, 312, 45);
        ctx.fillStyle = "#4da6ff";
        ctx.font = "bold 11px sans-serif";
        ctx.fillText(`SCORE:`, 312, 135);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText(`${score}`, 312, 153);
    }

    ctx.fillStyle = "#aaa";
    ctx.font = "bold 11px sans-serif";
    ctx.fillText("NEXT", 336, 206);
    drawBubble(352, 244, nextBubble.color, 17, false, nextBubble.isMystery);

    let btnBg = bombUsesLeft > 0 ? "#ff5722" : "#333";
    ctx.fillStyle = btnBg;
    ctx.beginPath(); ctx.roundRect(312, 275, 80, 70, 10); ctx.fill();
    ctx.strokeStyle = bombUsesLeft > 0 ? "#fff" : "#555"; ctx.lineWidth = 2; ctx.stroke(); ctx.closePath();

    ctx.fillStyle = bombUsesLeft > 0 ? "#fff" : "#777";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("💣ボム", 352, 305);
    ctx.fillText(`(${bombUsesLeft})`, 352, 325);

    if (gameMode === 'battle') {
        let itemNames = ['①お邪魔×2', '②お邪魔×3', '③スキップ', '④貫通', '⑤色変更'];
        let itemStartY = 355;
        let itemBtnH = 40;
        let itemGap = 4;

        for (let i = 0; i < 5; i++) {
            let by = itemStartY + i * (itemBtnH + itemGap);
            let count = itemStockCounts[i];
            let isSelected = activeItems.includes(i);

            ctx.fillStyle = isSelected ? "#ffcc00" : (count > 0 ? "#4da6ff" : "#2a2a2a");
            ctx.beginPath(); ctx.roundRect(312, by, 80, itemBtnH, 8); ctx.fill();
            ctx.strokeStyle = isSelected ? "#ffffff" : (count > 0 ? "#88ccff" : "#444");
            ctx.lineWidth = isSelected ? 3 : 1.5; ctx.stroke(); ctx.closePath();

            ctx.fillStyle = count > 0 ? "#ffffff" : "#666";
            ctx.font = "bold 10px sans-serif";
            ctx.fillText(itemNames[i], 352, by + 18);
            ctx.font = "bold 9px sans-serif";
            ctx.fillStyle = isSelected ? "#111" : "#ffcc00";
            ctx.fillText(`[${count}/5]`, 352, by + 32);
        }
    }
    ctx.textAlign = "left";

    // --- デンジャーライン（危険ライン）描画 ---
    let dangerRow = ROWS - 1;
    let dangerY = dangerRow * ROW_HEIGHT + TOP_MARGIN;
    ctx.save();
    ctx.strokeStyle = "rgba(255, 77, 77, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(0, dangerY);
    ctx.lineTo(305, dangerY);
    ctx.stroke();
    ctx.restore();

    // --- メインフィールドのグリッド玉描画 ---
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r][c];
            if (cell !== null) {
                let pos = getPixelCoords(r, c);
                if (cell.color === UNBREAKABLE_COLOR) drawUnbreakableBubble(pos.x, pos.y, RADIUS);
                else {
                    drawBubble(pos.x, pos.y, cell.color, RADIUS, cell.isOjama, cell.isMystery);
                }
            }
        }
    }

    for (let fb of flashingBubbles) {
        let phase = Math.floor(fb.timer / 10);
        let flashColor = (phase === 1) ? "#ff0000" : "#ffffff";
        for (let ac of fb.cells) {
            let pos = getPixelCoords(ac.r, ac.c);
            ctx.beginPath(); ctx.arc(pos.x, pos.y, RADIUS - 1, 0, Math.PI * 2);
            ctx.fillStyle = flashColor; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.stroke(); ctx.closePath();
        }
    }

    for (let fb of fallingBubbles) drawBubble(fb.x, fb.y, fb.color, RADIUS, false, fb.isMystery);

    for (let oj of flyingOjamaList) {
        drawBubble(oj.x, oj.y, oj.cellData.color, RADIUS, true, oj.cellData.isMystery);
    }

    // --- 発射・引っ張りガイド線描画 ---
    if (isDragging) {
        let pullDist = Math.hypot(pullX, pullY);
        if (pullDist > 8) {
            let launchAngle = Math.atan2(-pullY, -pullX);
            let guideLength = 250;
            ctx.beginPath(); ctx.moveTo(shooterX, shooterY);
            ctx.lineTo(shooterX + Math.cos(launchAngle) * guideLength, shooterY + Math.sin(launchAngle) * guideLength);
            ctx.strokeStyle = 'rgba(255, 204, 0, 0.95)'; ctx.lineWidth = 4; ctx.setLineDash([10, 8]); ctx.stroke(); ctx.setLineDash([]); ctx.closePath();
        }
        ctx.beginPath(); ctx.moveTo(shooterX, shooterY); ctx.lineTo(shooterX + pullX, shooterY + pullY);
        ctx.strokeStyle = '#ff4d4d'; ctx.lineWidth = 4; ctx.stroke(); ctx.closePath();
        drawBubble(shooterX + pullX, shooterY + pullY, bulletData.color, RADIUS, false, bulletData.isMystery);
    } else if (isMoving) {
        drawBubble(bulletX, bulletY, bulletData.color, RADIUS, false, bulletData.isMystery);
    } else {
        drawBubble(shooterX, shooterY, bulletData.color, RADIUS, false, bulletData.isMystery);
    }

    // --- 各種オーバーレイ通知（電光掲示板・相手のターン・カウントダウン） ---
    if (marqueeTimer > 0 && activeMarqueeText !== "") {
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
        ctx.fillRect(0, canvas.height / 2 - 25, 305, 40);
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 2;
        ctx.strokeRect(0, canvas.height / 2 - 25, 305, 40);

        ctx.fillStyle = "#ffcc00";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(activeMarqueeText, marqueeX, canvas.height / 2 - 5);
        ctx.restore();
    }

    if (gameMode === 'battle' && battleTurnState === 'opponent_turn') {
        let alpha = 0.5 + 0.5 * Math.sin(Date.now() / 400);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
        ctx.fillRect(10, canvas.height / 2 - 40, 285, 70);
        ctx.strokeStyle = "#ffcc00";
        ctx.lineWidth = 3;
        ctx.strokeRect(10, canvas.height / 2 - 40, 285, 70);

        ctx.fillStyle = "#ffcc00";
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("相手の番です。", 152, canvas.height / 2 - 10);
        ctx.font = "bold 14px sans-serif";
        ctx.fillStyle = "#ffffff";
        ctx.fillText("PLEASE WAIT", 152, canvas.height / 2 + 16);
        ctx.restore();
    }

    if (gameMode === 'battle' && battleTurnState === 'my_turn' && turnRemainingTime <= 5) {
        ctx.save();
        ctx.fillStyle = "rgba(255, 0, 0, 0.35)";
        ctx.fillRect(40, canvas.height / 2 - 55, 225, 90);
        ctx.strokeStyle = "#ff0000";
        ctx.lineWidth = 4;
        ctx.strokeRect(40, canvas.height / 2 - 55, 225, 90);

        ctx.fillStyle = "#ffff00";
        ctx.font = "bold 64px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(turnRemainingTime.toString(), 152, canvas.height / 2 - 10);
        ctx.restore();
    }

    if (attackNoticeTimer > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(255, 0, 0, 0.85)";
        ctx.fillRect(10, canvas.height / 2 - 30, 285, 50);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeRect(10, canvas.height / 2 - 30, 285, 50);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(attackNoticeText, 152, canvas.height / 2 + 2);
        ctx.restore();
    }

    if (opponentTurnNoticeTimer > 0) {
        ctx.save();
        ctx.fillStyle = "rgba(0, 100, 255, 0.85)";
        ctx.fillRect(10, canvas.height / 2 - 30, 285, 50);
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 3;
        ctx.strokeRect(10, canvas.height / 2 - 30, 285, 50);

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(opponentTurnNoticeText, 152, canvas.height / 2 + 2);
        ctx.restore();
    }

    ctx.restore();
}

function drawTitleBackground() {
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#888888";
    ctx.fillText("Ver 1.16", canvas.width / 2, canvas.height / 2 + 75);
    ctx.restore();
}

function drawGameClearScreen() {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawParticles();

    ctx.save();
    ctx.textAlign = "center";
    ctx.font = "bold 22px sans-serif";
    ctx.fillStyle = "#4dff4d";
    ctx.fillText("🎉 完全攻略！ 🎉", canvas.width / 2, canvas.height / 2 - 90);

    let colorIndex = Math.floor(Date.now() / 200) % BASE_COLORS.length;
    ctx.font = "900 26px 'Segoe UI', sans-serif";
    ctx.fillStyle = BASE_COLORS[colorIndex];
    ctx.fillText("CONGRATULATIONS!", canvas.width / 2, canvas.height / 2 - 40);

    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`ALL STAGE CLEAR!`, canvas.width / 2, canvas.height / 2 + 10);
    ctx.fillText(`TIME: ${totalClearTime}秒 / SCORE: ${score}`, canvas.width / 2, canvas.height / 2 + 45);

    ctx.font = "14px sans-serif";
    ctx.fillStyle = "#4da6ff";
    ctx.fillText("画面をタップしてタイトルへ ➔", canvas.width / 2, canvas.height / 2 + 100);
    ctx.restore();
}

function drawBattleResultScreen() {
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    drawParticles();
}

function drawBubble(x, y, color, r, isOjama = false, isMystery = false) {
    if (customImages[color]) {
        ctx.save();
        ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.clip();
        ctx.drawImage(customImages[color], x - r, y - r, r * 2, r * 2);
        ctx.restore();
        ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); 
        ctx.strokeStyle = isOjama ? "#ff4d4d" : "#fff"; 
        ctx.lineWidth = isOjama ? 3.5 : 2; 
        ctx.stroke(); ctx.closePath();
    } else {
        ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2);
        if (color === SPECIAL_RAINBOW) {
            let colorIndex = Math.floor(Date.now() / 150) % BASE_COLORS.length;
            ctx.fillStyle = BASE_COLORS[colorIndex]; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = "#ffffff"; ctx.font = "bold 14px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("★", x, y); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        } else if (color === SPECIAL_BOMB) {
            ctx.fillStyle = "#333"; ctx.fill(); ctx.strokeStyle = "#ff5722"; ctx.lineWidth = 3; ctx.stroke();
            ctx.fillStyle = "#ff5722"; ctx.font = "bold 13px sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.fillText("💣", x, y); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
        } else {
            ctx.fillStyle = color; ctx.fill(); 
            ctx.strokeStyle = isOjama ? "#ff4d4d" : "#fff"; 
            ctx.lineWidth = isOjama ? 3.5 : 2; 
            ctx.stroke();
        }
        ctx.closePath();
    }

    if (isMystery) {
        ctx.save();
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.shadowColor = "#000";
        ctx.shadowBlur = 4;
        ctx.fillText("？", x, y);
        ctx.restore();
    }
}

function drawUnbreakableBubble(x, y, r) {
    ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fillStyle = UNBREAKABLE_COLOR; ctx.fill();
    ctx.strokeStyle = "#aaa"; ctx.lineWidth = 2; ctx.stroke(); ctx.closePath();
    let offset = 6;
    ctx.beginPath(); ctx.moveTo(x - offset, y - offset); ctx.lineTo(x + offset, y + offset);
    ctx.moveTo(x + offset, y - offset); ctx.lineTo(x - offset, y + offset);
    ctx.strokeStyle = "#ff3333"; ctx.lineWidth = 2.5; ctx.stroke(); ctx.closePath();
}

// ==========================================
// 17. カスタムスキン・設定モーダル
// ==========================================
function openSettings() {
    let listContainer = document.getElementById('settings-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    [...BASE_COLORS, SPECIAL_BOMB].forEach(col => {
        let rowDiv = document.createElement('div');
        rowDiv.style.cssText = "display:flex; align-items:center; justify-content:space-between; width:92%; background:#222; padding:10px 12px; margin:6px 0; border-radius:8px;";
        
        let nameSpan = document.createElement('span');
        nameSpan.style.cssText = "font-size:13px; font-weight:bold;";
        nameSpan.innerText = COLOR_NAMES[col] || col;

        let btnGroup = document.createElement('div');
        btnGroup.style.cssText = "display:flex; gap:8px;";

        let uploadBtn = document.createElement('button');
        uploadBtn.className = 'menu-btn sub';
        uploadBtn.style.cssText = "padding:8px 12px; font-size:12px; width:auto; margin:0; touch-action:manipulation;";
        uploadBtn.innerText = '📷 変更';

        let resetBtn = document.createElement('button');
        resetBtn.className = 'menu-btn danger';
        resetBtn.style.cssText = "padding:8px 10px; font-size:12px; width:auto; margin:0; touch-action:manipulation;";
        resetBtn.innerText = '🔄';
        resetBtn.onclick = () => { delete customImages[col]; openSettings(); };
        
        let fileInput = document.createElement('input');
        fileInput.type = 'file'; fileInput.accept = 'image/*'; fileInput.style.display = 'none';
        fileInput.onchange = (e) => {
            let file = e.target.files[0];
            if (file) {
                let reader = new FileReader();
                reader.onload = (event) => {
                    let img = new Image();
                    img.onload = () => {
                        let tempCanvas = document.createElement('canvas');
                        let maxDim = 128;
                        let w = img.width, h = img.height;
                        if (w > h) { if (w > maxDim) { h *= maxDim / w; w = maxDim; } }
                        else { if (h > maxDim) { w *= maxDim / h; h = maxDim; } }
                        tempCanvas.width = w; tempCanvas.height = h;
                        let tCtx = tempCanvas.getContext('2d');
                        tCtx.drawImage(img, 0, 0, w, h);
                        let resizedImg = new Image();
                        resizedImg.onload = () => {
                            customImages[col] = resizedImg;
                            openSettings();
                        };
                        resizedImg.src = tempCanvas.toDataURL('image/jpeg', 0.85);
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            }
        };
        uploadBtn.onclick = () => fileInput.click();

        btnGroup.appendChild(uploadBtn);
        btnGroup.appendChild(resetBtn);

        rowDiv.appendChild(nameSpan);
        rowDiv.appendChild(btnGroup);
        rowDiv.appendChild(fileInput);
        listContainer.appendChild(rowDiv);
    });
    let settingsOverlay = document.getElementById('settings-overlay');
    if (settingsOverlay) settingsOverlay.style.display = 'flex';
}

function closeSettings() {
    let settingsOverlay = document.getElementById('settings-overlay');
    if (settingsOverlay) settingsOverlay.style.display = 'none';
}

// ==========================================
// 18. メインゲームループ・起動処理
// ==========================================
function loop() {
    update();
    draw();
    requestAnimationFrame(loop);
}

showScreen('screen-title');
loop();
