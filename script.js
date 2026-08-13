// ==========================================
// 1. 初期設定・グローバル変数
// ==========================================
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PEER_PREFIX = 'bomber-game-v2026-room-';

let gameState = 'title';
let battleRole = ''; // 'host' or 'guest'
let roomCode = '';
let myPlayerId = 0;
let maxPlayers = 2;
let targetWins = 1;
let ojamaMultiplier = 1;

let peer = null;
let guestConn = null;
let hostConnections = []; // ホスト側の全ゲストコネクション管理配列

let players = []; // { id, name, order, wins, oshitsukeTarget, forceShoot, isShield }
let readyCount = 0;

let rouletteState = 'idle';
let myOrderNum = 0;
let rouletteInterval = null;

// ==========================================
// 2. 画面制御
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
// 3. 通信 (ホスト側 & ゲスト側)
// ==========================================
function confirmHostSettings() {
    maxPlayers = parseInt(document.getElementById('select-max-players').value);
    targetWins = parseInt(document.getElementById('select-target-wins').value);
    ojamaMultiplier = parseInt(document.getElementById('select-ojama-mult').value);

    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    document.getElementById('host-wait-status').innerText = "サーバーに接続中...";
    showScreen('screen-host-wait');

    // PeerJS 接続作成 (統一プレフィックスを使用)
    peer = new Peer(PEER_PREFIX + roomCode);

    players = [{ id: 0, name: '', order: 0, wins: 0, oshitsukeTarget: null, forceShoot: false, isShield: false }];
    myPlayerId = 0;

    peer.on('open', (id) => {
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
                ojamaMult: ojamaMultiplier 
            });
            updateHostWaitStatus();

            if (players.length === maxPlayers) {
                broadcastHost({ type: 'start_name_input' });
                showScreen('screen-name-input');
            }
        });

        conn.on('data', (data) => handleHostReceiveData(assignedId, data));

        conn.on('close', () => {
            hostConnections = hostConnections.filter(c => c !== conn);
        });
    });

    peer.on('error', (err) => {
        alert("ホスト接続エラー: 部屋コードを再生成します");
        confirmHostSettings();
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
            statusMsg.innerText = "ホストと接続成功！待機中...";
        });

        guestConn.on('data', handleGuestReceiveData);

        guestConn.on('error', (err) => {
            statusMsg.innerText = "接続エラーが発生しました";
        });

        guestConn.on('close', () => {
            alert("ホストとの通信が切断されました");
            showScreen('screen-title');
        });
    });

    peer.on('error', (err) => {
        statusMsg.innerText = "部屋が見つかりません (IDを確認してください)";
    });
}

function broadcastHost(data) {
    hostConnections.forEach(c => {
        if (c && c.open) c.send(data);
    });
}

// ==========================================
// 4. 通信データハンドラ
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
// 5. 名前入力 & ルーレット進行
// ==========================================
function submitPlayerName() {
    let inputName = document.getElementById('input-player-name').value.trim();
    if (!inputName) inputName = "P" + (myPlayerId + 1);
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
    let allFilled = players.every(p => p.name && p.name !== '');
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

    let notice = document.createElement('div');
    notice.style.cssText = "position:fixed; top:40%; left:50%; transform:translate(-50%, -50%); font-size:36px; font-weight:900; color:#ffcc00; text-shadow:0 0 15px #000; z-index:1000; pointer-events:none;";
    notice.innerText = "ゲームスタート！";
    document.body.appendChild(notice);

    setTimeout(() => notice.remove(), 2000);
}

// ==========================================
// 6. アイテム発動処理 (おしつけ / 発射 / 防御)
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
        guestConn.send({ type: 'action_use_item', itemType: itemType, targetId: targetId });
    }
}

function processItemEffect(fromId, itemType, targetId) {
    if (itemType === 1) {
        players[fromId].oshitsukeTarget = targetId;
    } else if (itemType === 2) {
        players[targetId].forceShoot = true;
    } else if (itemType === 3) {
        players[fromId].isShield = true;
    }
    broadcastHost({ type: 'sync_player_states', players: players });
}

// 描画メインループ
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    requestAnimationFrame(gameLoop);
}
requestAnimationFrame(gameLoop);
