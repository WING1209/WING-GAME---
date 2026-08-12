const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- サウンド設定 (変更なし) ---
const audioPath = 'audio/';
const se = { /* 略: ご提示のコードのまま */ };
let audioUnlocked = false;
function unlockAudio() { /* 略 */ }
function playSE(sound) { /* 略 */ }
const bgmList = [ /* 略 */ ];
let currentBGM = null;
function playRandomBGM() { /* 略 */ }
function stopBGM() { /* 略 */ }

// --- ゲーム基本パラメータ ---
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const ROW_HEIGHT = RADIUS * Math.sqrt(3);
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const COLOR_NAMES = { /* 略 */ };
const UNBREAKABLE_COLOR = '#fff';
const TOP_MARGIN = 15;
const SPECIAL_RAINBOW = 'SPECIAL_RAINBOW';
const SPECIAL_BOMB = 'SPECIAL_BOMB';

let grid = [];
let score = 0;
let currentStage = 1;

// 削除: let gameMode = 'single'; (常時対戦のため不要)
// 削除: let battleType = 'タイムアタック'; (常時お邪魔対戦のため不要)
// 削除: let customImages = {};

let targetWins = 1;
let myWins = 0;
let opponentWins = 0;

// --- 消した玉数カウント・マイルストーン演出管理 ---
let myClearedBubbleCount = 0;
let opponentClearedBubbleCount = 0;
const TARGET_CLEARED_COUNT = 500;
let activeMarqueeText = "";
let marqueeX = 305;
let marqueeTimer = 0;
let triggeredMilestones = new Set();
let battleRole = '';
let roomCode = '';
let gameState = 'title'; // title, playing, battle_result 等
let battleTurnState = 'waiting';
let myJankenChoice = '';
let opponentJankenChoice = '';
let jankenResultMsg = 'じゃんけんの手を選んでください';
let currentTurnPlayer = '';

const TURN_TIME_LIMIT = 10;
let turnRemainingTime = TURN_TIME_LIMIT;
let turnTimerInterval = null;
// 削除: 一人用タイマー (STAGE_TIME_LIMIT, remainingTime, timerInterval 等) は全て削除

// --- アイテムシステム管理変数 (変更なし) ---
// (itemStockCounts, activeItems 等、省略)

// ==========================================
// 画面遷移・初期化関連
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

// 削除: function startTimer() / stopTimer() (一人用のタイマー処理)

// ターンタイマー処理 (対戦用)
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
    let isMystery = Math.random() < 0.11; // 常に「お邪魔対戦」の設定
    return { color: color, isOjama: false, isMystery: isMystery };
}

function getRandomShooterBubble() {
    let isMystery = Math.random() < 0.11;
    if (Math.random() < 0.08) return { color: SPECIAL_RAINBOW, isOjama: false, isMystery: false };
    return {
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
        isOjama: false,
        isMystery: isMystery
    };
}

// 盤面初期化 (対戦専用に整理)
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
    
    // 対戦モード固定のため、シングルプレイ用のランダムお邪魔ブロック配置処理を削除
    // 最初から2行分だけ玉を配置する
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

// 削除: function startSinglePlay()

// ==========================================
// ネットワーク・通信処理 (PeerJS)
// ==========================================
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
            showScreen('screen-host-rule-setup');
        });
        peer.on('error', () => {
            alert('接続エラーが発生しました(部屋IDが競合している可能性があります)');
            showScreen('screen-role-select');
        });
    } else {
        showScreen('screen-guest-join');
        document.getElementById('status-message').innerText = '';
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
    // ※元のコードのリスナー設定をそのまま維持
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
                displayBattleRulesDesc(); // ルール表示
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
                checkBattleSetEnd(guestWinner); // ※後半コードにある想定の関数
            } else if (data.type === 'rematch') {
                myWins = 0;
                opponentWins = 0;
                startNextRound();
            }
        } else {
            // Host側の受信処理
            if (data.type === 'sync_janken_result') {
                opponentJankenChoice = data.choice;
                checkJankenFinish();
            } else if (data.type === 'sync_turn_action') {
                executeOpponentAction(data);
            } else if (data.type === 'guest_game_over') {
                handleHostRoundDecide('YOU'); // ※後半コードにある想定の関数
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
            // returnToTitle(); // ※後半コードにある想定の関数
        }
    });
}

// 削除: function setHostBattleType(type) (モード固定のため)

function setHostTargetWins(wins) {
    targetWins = wins;
    document.getElementById('btn-win-1').className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
    document.getElementById('btn-win-2').className = wins === 2 ? 'menu-btn' : 'menu-btn gray';
}

function confirmHostBattleStart() {
    if (conn && conn.open) {
        conn.send({
            type: 'show_rules',
            targetWins: targetWins
        });
    }
    displayBattleRulesDesc();
}

function displayBattleRulesDesc() {
    // お邪魔対戦用の説明に固定化
    let desc = `<b>【ターン制お邪魔対戦】</b><br>
        じゃんけんで先攻後攻を決定！ 交互に玉を打ちます。<br>
        出現する「?」付きの玉を消すとアイテムルーレットが発生！<br>
        <b>新ルール: 先に500個消すか、玉が危険ライン(点線)を超えると敗北！</b><br><br>
        勝利条件：${targetWins}勝先取`;
    
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
    gameState = 'playing';
    score = 0;
    currentStage = 1;
    bombUsesLeft = 2;
    myWins = 0;
    opponentWins = 0;
    
    initGridForStage(currentStage);
    spawnBullet(); // ※後半コードにある想定の関数
    playRandomBGM();
    startJankenPhase();
}

function closeNetwork() {
    if (conn) { try { conn.close(); } catch(e) {} }
    conn = null;
    if (peer) {
        try { peer.disconnect(); peer.destroy(); } catch(e) {}
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

// じゃんけん処理以降 (元のコードのまま)
function startJankenPhase() {
    battleTurnState = 'janken';
    myJankenChoice = '';
    opponentJankenChoice = '';
    jankenResultMsg = 'じゃんけんの手を選んでください';
    
    let container = document.getElementById('janken-overlay');
    if (!container) createJankenOverlayDOM();
    
    document.getElementById('janken-status-msg').innerText = jankenResultMsg;
    document.getElementById('janken-choice-buttons').style.display = 'flex';
    document.getElementById('janken-role-select').style.display = 'none';
    document.getElementById('janken-overlay').style.display = 'flex';
    
    if (battleRole === 'host' && conn && conn.open) {
        conn.send({ type: 'start_janken' });
    }
}

// ----- ！！！ ここ以降は元のコード(じゃんけん処理〜描画〜物理演算〜入力判定)をそのまま繋げてください ！！！ -----
