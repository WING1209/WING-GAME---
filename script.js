//
// 1. 初期設定・キャンバス定義
//
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

//
// 2. オーディオ (SE・BGM) 管理
//
const audioPath = 'audio/';
const se = {
    ballShoot: new Audio(`${audioPath}se/se_ball_shoot.wav`),
    ballLand: new Audio(`${audioPath}se/se_ball_land.wav`),
    bombExplode: new Audio(`${audioPath}se/se_bomb_explode.wav`),
    rainbowLand: new Audio(`${audioPath}se/se_rainbow_land.wav`),
    rainbowSet: new Audio(`${audioPath}se/se_rainbow_set.wav`),
    blockFall: new Audio(`${audioPath}se/se_block_fall.wav`),
    gameover: new Audio(`${audioPath}se/se_game_over.mp3`),
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
        if (sound) {
            sound.currentTime = 0;
            let p = sound.play();
            if (p !== undefined) p.catch(() => {});
        }
    } catch(e) {}
}

//
// 3. 基本定数・グローバル変数
//
const ROWS = 15;
const COLS = 8;
const RADIUS = 19;
const DIAMETER = RADIUS * 2;
const BASE_COLORS = ['#ff4d4d', '#4da6ff', '#4dff4d', '#ffff4d', '#ff4dda'];
const UNBREAKABLE_COLOR = '#fff';

let grid = [];
let score = 0;
let gameState = 'title';

// --- マルチ対戦・ピア管理パラメータ ---
let peer = null;
let conns = {}; // peerId -> connection (Host用)
let hostConn = null; // Guest用
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let targetWins = 1;

let maxPlayersCount = 2;
let myPeerId = '';
let myPlayerName = 'プレイヤー';
let playersList = []; // [{ id, name, wins, isReady, turnOrder, statusEffects }]

// --- ターン制御 ---
let currentTurnIndex = 0; // playersListのインデックス
let battleTurnState = 'waiting';

// --- ルーレット制御 ---
let turnRouletteInterval = null;
let myAssignedTurnNumber = 0;
let rouletteState = 'idle'; // 'running', 'stopped'

// --- 新アイテム個数 & 特殊状態 ---
let specialItems = {
    oshitsuke: 1,
    hassha: 1,
    bougyo: 1
};
let selectedItemType = null; // 'oshitsuke' or 'hassha'

// 状態異常管理 (自プレイヤー用)
let activeStatus = {
    oshitsukeTargetId: null, // おしつけ対象プレイヤーID
    oshitsukeTurns: 0,
    bougyoTurns: 0,
    forceLaunch: false // 次のターン勝手に発射されるか
};

// 物理・射出系
let shooterX = 180;
let shooterY = 570;
let bulletX = shooterX;
let bulletY = shooterY;
let bulletVX = 0;
let bulletVY = 0;
let isMoving = false;
let bulletData = getRandomShooterBubble();

function getRandomShooterBubble() {
    return {
        color: BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)],
        isojama: false
    };
}

//
// 4. 画面遷移 & 演出系
//
function showScreen(screenId) {
    document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
    if (!screenId) return;
    let target = document.getElementById(screenId);
    if (target) target.style.display = 'flex';
}

function showBigAnnouncement(text, duration = 2000) {
    let el = document.getElementById('big-announcement');
    if (!el) return;
    el.innerText = text;
    el.style.display = 'block';
    setTimeout(() => {
        el.style.display = 'none';
    }, duration);
}

function exitGame() {
    if (confirm('ゲームを終了してタイトル画面に戻りますか？')) {
        closeNetwork();
        showScreen('screen-title');
    }
}

//
// 5. ホスト・ゲスト初期選択 & 接続処理 (①機能)
//
function selectRole(role) {
    unlockAudio();
    battleRole = role;
    closeNetwork();

    if (role === 'host') {
        showScreen('screen-host-count');
    } else {
        showScreen('screen-guest-join');
    }
}

function confirmHostCount() {
    let select = document.getElementById('select-player-count');
    maxPlayersCount = parseInt(select.value, 10);
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    
    document.getElementById('display-room-code').innerText = roomCode;
    showScreen('screen-host-rules');
}

function setHostTargetWins(wins) {
    targetWins = wins;
    document.getElementById('btn-win-1').className = wins === 1 ? 'menu-btn' : 'menu-btn gray';
    document.getElementById('btn-win-2').className = wins === 2 ? 'menu-btn' : 'menu-btn gray';
}

function confirmHostRules() {
    setupHostPeer();
    showScreen('screen-wait-players');
    updateWaitPlayerStatus();
}

const PEER_PREFIX = 'wing-game-room-2026-v1-';

function setupHostPeer() {
    myPeerId = PEER_PREFIX + roomCode + '-host';
    peer = new Peer(myPeerId);
    playersList = [{ id: myPeerId, name: 'ホスト', wins: 0, isReady: false, statusEffects: {} }];

    peer.on('connection', (c) => {
        if (Object.keys(conns).length >= maxPlayersCount - 1) {
            c.close();
            return;
        }
        conns[c.peer] = c;
        setupConnectionListeners(c);
    });

    peer.on('error', (err) => {
        alert('ネットワークエラーが発生しました。部屋IDを変えてやり直してください。');
        showScreen('screen-title');
    });
}

function joinRoom() {
    let codeEl = document.getElementById('input-room-code');
    let code = codeEl ? codeEl.value : '';
    if (code.length !== 4) {
        document.getElementById('status-message').innerText = '4桁の数字を入力してください';
        return;
    }
    roomCode = code;
    document.getElementById('status-message').innerText = '接続中...';

    peer = new Peer();
    peer.on('open', (id) => {
        myPeerId = id;
        let hostId = PEER_PREFIX + roomCode + '-host';
        hostConn = peer.connect(hostId);
        setupConnectionListeners(hostConn);
    });

    peer.on('error', () => {
        document.getElementById('status-message').innerText = '部屋が見つからないか接続に失敗しました';
    });
}

function setupConnectionListeners(c) {
    c.on('open', () => {
        if (battleRole === 'guest') {
            showScreen('screen-wait-players');
        } else {
            // ホスト側：プレイヤー参加の検知
            playersList.push({ id: c.peer, name: 'ゲスト', wins: 0, isReady: false, statusEffects: {} });
            broadcastHostData({ type: 'sync_players', playersList: playersList, maxPlayersCount: maxPlayersCount });
            updateWaitPlayerStatus();
            
            if (playersList.length === maxPlayersCount) {
                // 揃ったら全員名前入力へ
                setTimeout(() => {
                    broadcastHostData({ type: 'start_name_input' });
                    startNameInputPhase();
                }, 1000);
            }
        }
    });

    c.on('data', (data) => {
        handleNetworkData(data, c.peer);
    });

    c.on('close', () => {
        if (gameState === 'playing') {
            alert('通信が切断されました');
            showScreen('screen-title');
        }
    });
}

function broadcastHostData(data) {
    Object.values(conns).forEach(c => {
        if (c && c.open) c.send(data);
    });
}

function sendToHost(data) {
    if (hostConn && hostConn.open) {
        hostConn.send(data);
    }
}

function updateWaitPlayerStatus() {
    let el = document.getElementById('wait-player-status');
    if (el) el.innerText = `接続中: ${playersList.length} / ${maxPlayersCount} 人`;
    
    let listEl = document.getElementById('player-list-display');
    if (listEl) {
        listEl.innerHTML = playersList.map((p, i) => `P${i+1}: ${p.name}`).join('<br>');
    }
}

//
// 6. 名前入力 & ルーレット順番決定 (②機能)
//
function startNameInputPhase() {
    showScreen('screen-name-input');
}

function submitPlayerName() {
    let input = document.getElementById('input-player-name');
    let name = input ? input.value.trim() : '';
    if (!name) name = 'プレイヤー';
    if (name.length > 6) name = name.substring(0, 6);

    myPlayerName = name;
    document.getElementById('gui-my-name').innerText = myPlayerName;

    document.getElementById('name-wait-status').innerText = '他のプレイヤーの入力を待っています...';

    if (battleRole === 'host') {
        let me = playersList.find(p => p.id === myPeerId);
        if (me) me.name = myPlayerName;
        checkAllNamesSubmitted();
    } else {
        sendToHost({ type: 'submit_name', name: myPlayerName });
    }
}

function checkAllNamesSubmitted() {
    let allEntered = playersList.every(p => p.name !== 'ゲスト' && p.name !== '');
    if (allEntered) {
        // 全員入力完了したらルーレット画面へ遷移指示
        assignRandomTurnOrders();
        broadcastHostData({ type: 'start_turn_roulette', playersList: playersList });
        startTurnRoulettePhase();
    }
}

// 重複のない順番をホスト側で事前に割り当て
function assignRandomTurnOrders() {
    let orders = [];
    for (let i = 1; i <= playersList.length; i++) orders.push(i);
    orders.sort(() => Math.random() - 0.5);

    playersList.forEach((p, idx) => {
        p.turnOrder = orders[idx];
    });
}

function startTurnRoulettePhase() {
    showScreen('screen-roulette-turn');
    let me = playersList.find(p => p.id === myPeerId);
    if (me) myAssignedTurnNumber = me.turnOrder;

    rouletteState = 'running';
    let statusEl = document.getElementById('roulette-status-text');
    let btn = document.getElementById('btn-roulette-action');
    btn.innerText = 'タップして停止';
    btn.disabled = false;

    let displayNum = 1;
    turnRouletteInterval = setInterval(() => {
        if (rouletteState === 'running') {
            displayNum = (displayNum % playersList.length) + 1;
            statusEl.innerText = `[ ${displayNum} ]`;
        }
    }, 80);
}

function handleTurnRouletteClick() {
    let btn = document.getElementById('btn-roulette-action');
    let statusEl = document.getElementById('roulette-status-text');

    if (rouletteState === 'running') {
        rouletteState = 'stopped';
        clearInterval(turnRouletteInterval);
        statusEl.innerText = `あなたは ${myAssignedTurnNumber} 番です`;
        btn.innerText = '準備画面へ';
    } else if (rouletteState === 'stopped') {
        showReadyConfirmScreen();
    }
}

function showReadyConfirmScreen() {
    showScreen('screen-ready-confirm');
    document.getElementById('my-turn-order-desc').innerText = `あなたの順番: ${myAssignedTurnNumber} 番目`;
    document.getElementById('ready-wait-status').innerText = '';
}

function sendReadySignal() {
    document.getElementById('btn-ready-start').disabled = true;
    document.getElementById('ready-wait-status').innerText = '全員の準備完了を待っています...';

    if (battleRole === 'host') {
        let me = playersList.find(p => p.id === myPeerId);
        if (me) me.isReady = true;
        checkAllReady();
    } else {
        sendToHost({ type: 'player_ready' });
    }
}

function checkAllReady() {
    let allReady = playersList.every(p => p.isReady);
    if (allReady) {
        // 順番通りに並び替え
        playersList.sort((a, b) => a.turnOrder - b.turnOrder);
        broadcastHostData({ type: 'start_game', playersList: playersList });
        executeGameStart();
    }
}

function executeGameStart() {
    showScreen(''); // 全画面オーバーレイを隠す
    showBigAnnouncement('ゲームスタート！', 2500);

    initGrid();
    currentTurnIndex = 0;
    specialItems = { oshitsuke: 1, hassha: 1, bougyo: 1 };
    updateGUIItemCounts();
    
    gameState = 'playing';
    startTurnLoop();
}

//
// 7. データ同期 & ハンドラ
//
function handleNetworkData(data, senderId) {
    if (data.type === 'sync_players') {
        playersList = data.playersList;
        maxPlayersCount = data.maxPlayersCount;
        updateWaitPlayerStatus();
    } else if (data.type === 'start_name_input') {
        startNameInputPhase();
    } else if (data.type === 'submit_name') {
        let p = playersList.find(item => item.id === senderId);
        if (p) p.name = data.name;
        checkAllNamesSubmitted();
    } else if (data.type === 'start_turn_roulette') {
        playersList = data.playersList;
        startTurnRoulettePhase();
    } else if (data.type === 'player_ready') {
        let p = playersList.find(item => item.id === senderId);
        if (p) p.isReady = true;
        checkAllReady();
    } else if (data.type === 'start_game') {
        playersList = data.playersList;
        executeGameStart();
    } else if (data.type === 'sync_turn_action') {
        handleTurnActionReceived(data);
    }
}

//
// 8. アイテム機能 (③機能) & ターン進行
//
function updateGUIItemCounts() {
    document.getElementById('count-oshitsuke').innerText = `(${specialItems.oshitsuke})`;
    document.getElementById('count-hassha').innerText = `(${specialItems.hassha})`;
    document.getElementById('count-bougyo').innerText = `(${specialItems.bougyo})`;

    let isMyTurn = (playersList[currentTurnIndex] && playersList[currentTurnIndex].id === myPeerId);
    
    document.getElementById('btn-item-oshitsuke').disabled = !isMyTurn || specialItems.oshitsuke <= 0;
    document.getElementById('btn-item-hassha').disabled = !isMyTurn || specialItems.hassha <= 0;
    document.getElementById('btn-item-bougyo').disabled = !isMyTurn || specialItems.bougyo <= 0;
}

function useSpecialItem(type) {
    if (specialItems[type] <= 0) return;

    if (type === 'oshitsuke' || type === 'hassha') {
        selectedItemType = type;
        openTargetSelectModal();
    } else if (type === 'bougyo') {
        specialItems.bougyo--;
        activeStatus.bougyoTurns = playersList.length; // 全員のターンが1周するまで
        showBigAnnouncement('防御発動！(お邪魔玉半減)', 1500);
        updateGUIItemCounts();
    }
}

function openTargetSelectModal() {
    let container = document.getElementById('target-player-buttons');
    container.innerHTML = '';

    playersList.forEach(p => {
        if (p.id !== myPeerId) {
            let btn = document.createElement('button');
            btn.className = 'menu-btn sub';
            btn.style.margin = '6px';
            btn.innerText = p.name;
            btn.onclick = () => selectTargetPlayer(p.id);
            container.appendChild(btn);
        }
    });

    showScreen('screen-target-select');
}

function closeTargetSelect() {
    showScreen('');
}

function selectTargetPlayer(targetId) {
    closeTargetSelect();

    if (selectedItemType === 'oshitsuke') {
        specialItems.oshitsuke--;
        activeStatus.oshitsukeTargetId = targetId;
        activeStatus.oshitsukeTurns = playersList.length; // 全員のターン1周分
        let targetName = playersList.find(p => p.id === targetId)?.name;
        showBigAnnouncement(`おしつけ発動！ -> ${targetName}`, 1500);
    } else if (selectedItemType === 'hassha') {
        specialItems.hassha--;
        // 相手に強制発射を送る
        let targetData = {
            type: 'sync_turn_action',
            itemUsed: 'hassha',
            targetId: targetId
        };
        if (battleRole === 'host') broadcastHostData(targetData);
        else sendToHost(targetData);

        let targetName = playersList.find(p => p.id === targetId)?.name;
        showBigAnnouncement(`${targetName} に強制発射！`, 1500);
    }

    updateGUIItemCounts();
}

function startTurnLoop() {
    let currentPlayer = playersList[currentTurnIndex];
    let isMyTurn = (currentPlayer.id === myPeerId);

    updateGUIItemCounts();

    if (isMyTurn) {
        showBigAnnouncement('あなたのターン！', 1500);

        // 強制発射チェック
        if (activeStatus.forceLaunch) {
            activeStatus.forceLaunch = false;
            showBigAnnouncement('強制発射！', 1500);
            setTimeout(() => {
                autoRandomShoot();
            }, 1000);
        }
    } else {
        showBigAnnouncement(`${currentPlayer.name} のターン`, 1200);
    }
}

function autoRandomShoot() {
    let angle = (Math.random() * 120 - 60) * Math.PI / 180;
    let speed = 15;
    bulletVX = Math.sin(angle) * speed;
    bulletVY = -Math.cos(angle) * speed;
    isMoving = true;
    playSE(se.ballShoot);
}

function finishMyTurn(ojamaCount = 0) {
    // 状態異常ターンのカウントダウン
    if (activeStatus.oshitsukeTurns > 0) {
        activeStatus.oshitsukeTurns--;
        if (activeStatus.oshitsukeTurns === 0) activeStatus.oshitsukeTargetId = null;
    }
    if (activeStatus.bougyoTurns > 0) {
        activeStatus.bougyoTurns--;
    }

    let actionData = {
        type: 'sync_turn_action',
        senderId: myPeerId,
        ojamaCount: ojamaCount,
        oshitsukeTargetId: activeStatus.oshitsukeTargetId
    };

    if (battleRole === 'host') {
        broadcastHostData(actionData);
        advanceTurn();
    } else {
        sendToHost(actionData);
    }
}

function handleTurnActionReceived(data) {
    if (data.itemUsed === 'hassha') {
        if (data.targetId === myPeerId) {
            activeStatus.forceLaunch = true;
        }
        return;
    }

    // お邪魔玉発生処理
    if (data.ojamaCount > 0) {
        let actualTarget = data.oshitsukeTargetId ? data.oshitsukeTargetId : getNextPlayerId(data.senderId);

        if (actualTarget === myPeerId) {
            let finalOjama = data.ojamaCount;
            // 防御チェック
            if (activeStatus.bougyoTurns > 0) {
                finalOjama = Math.floor(finalOjama / 2);
            }
            if (finalOjama > 0) {
                spawnOjamaBubbles(finalOjama);
            }
        }
    }

    if (battleRole === 'host') {
        advanceTurn();
    }
}

function getNextPlayerId(currentId) {
    let idx = playersList.findIndex(p => p.id === currentId);
    let nextIdx = (idx + 1) % playersList.length;
    return playersList[nextIdx].id;
}

function advanceTurn() {
    currentTurnIndex = (currentTurnIndex + 1) % playersList.length;
    let turnData = {
        type: 'sync_turn_action',
        nextTurnIndex: currentTurnIndex
    };
    broadcastHostData(turnData);
    startTurnLoop();
}

//
// 9. ゲーム盤面 & 描画ループ
//
function initGrid() {
    grid = [];
    for (let r = 0; r < ROWS; r++) {
        let row = [];
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        for (let c = 0; c < colsInRow; c++) {
            row.push(r < 3 ? getRandomShooterBubble() : null);
        }
        grid.push(row);
    }
}

function spawnOjamaBubbles(count) {
    // 下部からお邪魔玉を迫りあがらせる簡易処理
    showBigAnnouncement(`お邪魔玉 +${count}!`, 1200);
}

function closeNetwork() {
    if (hostConn) { try { hostConn.close(); } catch(e){} hostConn = null; }
    Object.values(conns).forEach(c => { try { c.close(); } catch(e){} });
    conns = {};
    if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
}

// 描画メインループ
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // グリッド描画
    for (let r = 0; r < ROWS; r++) {
        let colsInRow = (r % 2 === 0) ? COLS : COLS - 1;
        let xOffset = (r % 2 === 0) ? RADIUS : RADIUS * 2;
        for (let c = 0; c < colsInRow; c++) {
            let cell = grid[r] ? grid[r][c] : null;
            if (cell) {
                ctx.beginPath();
                ctx.arc(xOffset + c * DIAMETER, RADIUS + r * (RADIUS * Math.sqrt(3)), RADIUS - 1, 0, Math.PI * 2);
                ctx.fillStyle = cell.color;
                ctx.fill();
                ctx.closePath();
            }
        }
    }

    // 弾描画
    ctx.beginPath();
    ctx.arc(bulletX, bulletY, RADIUS - 1, 0, Math.PI * 2);
    ctx.fillStyle = bulletData.color;
    ctx.fill();
    ctx.closePath();

    requestAnimationFrame(gameLoop);
}

gameLoop();
