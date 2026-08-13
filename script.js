// ==========================================
// 1. 初期設定・グローバル変数
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let gameMode = 'battle';
let gameState = 'title';
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let myPlayerId = 0; // 0, 1, 2, ...
let maxPlayers = 2;
let targetWins = 1;
let ojamaMultiplier = 1;

let peer = null;
let hostConnMap = {}; // Host用: [peerId]: connection
let guestConn = null; // Guest用

// プレイヤー管理情報
let players = []; // { id, name, order, wins, oshitsukeTarget, forceShoot, isShield }
let readyCount = 0;

// ルーレット状態
let rouletteState = 'idle'; // 'idle', 'running', 'stopped', 'ready_wait'
let myOrderNum = 0;
let rouletteInterval = null;

// ==========================================
// 2. 画面遷移制御
// ==========================================
function showScreen(screenId) {
    document.querySelectorAll('.overlay-screen').forEach(s => s.style.display = 'none');
    if (screenId) {
        let el = document.getElementById(screenId);
        if (el) el.style.display = 'flex';
    }
}

// 最初の3択メニュー
function selectMainMenu(choice) {
    if (choice === 'host') {
        battleRole = 'host';
        showScreen('screen-host-config');
    } else if (choice === 'guest') {
        battleRole = 'guest';
        showScreen('screen-guest-join');
    } else if (choice === 'exit') {
        alert("ゲームを終了します");
        window.close();
    }
}

// ==========================================
// 3. 通信 & ネットワーク処理 (PeerJS)
// ==========================================
function confirmHostSettings() {
    maxPlayers = parseInt(document.getElementById('select-max-players').value);
    targetWins = parseInt(document.getElementById('select-target-wins').value);
    ojamaMultiplier = parseInt(document.getElementById('select-ojama-mult').value);

    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    showScreen('screen-host-wait');

    peer = new Peer('pb-game-multi-' + roomCode);
    
    players = [{ id: 0, name: '', order: 0, wins: 0, oshitsukeTarget: null, forceShoot: false, isShield: false }];
    myPlayerId = 0;

    peer.on('connection', (conn) => {
        let newId = players.length;
        if (newId >= maxPlayers) {
            conn.close();
            return;
        }
        hostConnMap[conn.peer] = conn;
        players.push({ id: newId, name: '', order: 0, wins: 0, oshitsukeTarget: null, forceShoot: false, isShield: false });

        setupHostConnection(conn, newId);
        updateHostWaitStatus();

        if (players.length === maxPlayers) {
            // 全員揃ったら全員に名前入力指示
            broadcastHost({ type: 'start_name_input' });
            showScreen('screen-name-input');
        }
    });
}

function updateHostWaitStatus() {
    let el = document.getElementById('host-wait-status');
    if (el) el.innerText = `参加者を待っています... (${players.length}/${maxPlayers})`;
}

function setupHostConnection(conn, assignedId) {
    conn.on('open', () => {
        conn.send({ type: 'init_guest', playerId: assignedId, maxPlayers: maxPlayers, ojamaMult: ojamaMultiplier });
    });
    conn.on('data', (data) => handleHostReceiveData(assignedId, data));
}

function joinRoom() {
    let code = document.getElementById('input-room-code').value;
    if (code.length !== 4) {
        document.getElementById('guest-status-msg').innerText = "4桁の数字を入力してください";
        return;
    }
    roomCode = code;
    peer = new Peer();
    
    peer.on('open', () => {
        guestConn = peer.connect('pb-game-multi-' + roomCode);
        guestConn.on('data', handleGuestReceiveData);
    });
    
    peer.on('error', () => {
        document.getElementById('guest-status-msg').innerText = "部屋が見つかりませんでした";
    });
}

function broadcastHost(data) {
    Object.values(hostConnMap).forEach(c => {
        if (c && c.open) c.send(data);
    });
}

// ==========================================
// 4. データ受信ハンドラ
// ==========================================
function handleHostReceiveData(fromId, data) {
    if (data.type === 'submit_name') {
        players[fromId].name = data.name;
        checkAllNamesSubmitted();
    } else if (data.type === 'ready_start') {
        readyCount++;
        if (readyCount === maxPlayers) {
            broadcastHost({ type: 'game_start_signal' });
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
    } else if (data.type === 'start_name_input') {
        showScreen('screen-name-input');
    } else if (data.type === 'start_roulette') {
        players = data.players;
        showScreen('screen-roulette');
        startRouletteAnimation();
    } else if (data.type === 'game_start_signal') {
        launchGameStartNotice();
    }
}

// ==========================================
// 5. 名前入力 & ルーレット処理
// ==========================================
function submitPlayerName() {
    let inputName = document.getElementById('input-player-name').value.trim();
    if (!inputName) inputName = "P" + (myPlayerId + 1);
    
    // 全角6文字制限
    if (inputName.length > 6) inputName = inputName.substring(0, 6);

    document.getElementById('my-player-name').innerText = inputName;
    players[myPlayerId].name = inputName;

    document.getElementById('name-wait-msg').innerText = "他のプレイヤーの入力を待っています...";

    if (battleRole === 'host') {
        checkAllNamesSubmitted();
    } else {
        guestConn.send({ type: 'submit_name', name: inputName });
    }
}

function checkAllNamesSubmitted() {
    let allFilled = players.every(p => p.name !== '');
    if (allFilled) {
        // 順番をランダムに決定 (Fisher-Yates)
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

        myOrderNum = players[myPlayerId].order;
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
                broadcastHost({ type: 'game_start_signal' });
                launchGameStartNotice();
            }
        } else {
            guestConn.send({ type: 'ready_start' });
        }
    }
}

function launchGameStartNotice() {
    showScreen('');
    gameState = 'playing';

    // 画面中央に大きく「ゲームスタート！」演出を表示
    let notice = document.createElement('div');
    notice.style.cssText = "position:fixed; top:40%; left:50%; transform:translate(-50%, -50%); font-size:36px; font-weight:900; color:#ffcc00; text-shadow:0 0 15px #000; z-index:1000; pointer-events:none;";
    notice.innerText = "ゲームスタート！";
    document.body.appendChild(notice);

    setTimeout(() => notice.remove(), 2000);
}

// ==========================================
// 6. 新アイテム処理 (おしつけ、発射、防御)
// ==========================================

// アイテム1：おしつけ
function useItemOshitsuke() {
    let targetId = promptPlayerSelect("おしつける相手を選択してください:");
    if (targetId !== null) {
        sendItemAction(1, targetId);
    }
}

// アイテム2：発射
function useItemForceShoot() {
    let targetId = promptPlayerSelect("強制発射させる相手を選択してください:");
    if (targetId !== null) {
        sendItemAction(2, targetId);
    }
}

// アイテム3：防御
function useItemDefense() {
    sendItemAction(3, myPlayerId);
}

function promptPlayerSelect(msg) {
    let options = players
        .filter(p => p.id !== myPlayerId)
        .map(p => `${p.id}: ${p.name}`)
        .join("\n");
    let res = prompt(`${msg}\n${options}`);
    let id = parseInt(res);
    return isNaN(id) ? null : id;
}

function sendItemAction(itemType, targetId) {
    if (battleRole === 'host') {
        processItemEffect(myPlayerId, itemType, targetId);
    } else {
        guestConn.send({ type: 'action_use_item', itemType: itemType, targetId: targetId });
    }
}

function processItemEffect(fromId, itemType, targetId) {
    if (itemType === 1) { // おしつけ
        players[fromId].oshitsukeTarget = targetId;
    } else if (itemType === 2) { // 発射
        players[targetId].forceShoot = true;
    } else if (itemType === 3) { // 防御
        players[fromId].isShield = true;
    }
    broadcastHost({ type: 'sync_player_states', players: players });
}

// 描画ループ (ダミー実装：キャンバス描画のフレームワーク)
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (gameState === 'playing') {
        // ゲーム画面の背景および玉の描画処理などをここに記述
    }
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
