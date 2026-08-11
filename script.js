/**
 * WebRTC (PeerJS) を活用した 2～5名リアルタイムお邪魔対戦ロジック
 */

const BOARD_COLS = 6;
const BOARD_ROWS = 10;
const BUBBLE_SIZE = 40;
const COLORS = ['#ff4d4d', '#4da6ff', '#5cd65c', '#ffcc00', '#ff66cc'];

// ネットワーク状態
let peer = null;
let connections = []; // ホスト側: 接続してきた全ゲストのConnリスト
let hostConnection = null; // ゲスト側: ホストへのConn
let isHost = false;
let myPeerId = "";

// ゲーム状態
let gameState = {
    maxPlayers: 2,
    players: [], // { peerId, name, isAlive, oshitsukeTarget: null, oshitsukeTurns: 0, hasOshitsukeItem: false }
    turnIndex: 0,
    board: [],
    pendingOjama: 0,
    isMultiplayer: false
};

// DOM参照
const modeScreen = document.getElementById('mode-screen');
const createRoomScreen = document.getElementById('create-room-screen');
const joinRoomScreen = document.getElementById('join-room-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const orderScreen = document.getElementById('order-screen');
const targetScreen = document.getElementById('target-screen');

const btnSingle = document.getElementById('btn-single');
const btnCreateRoomMenu = document.getElementById('btn-create-room-menu');
const btnJoinRoomMenu = document.getElementById('btn-join-room-menu');
const btnCreateRoom = document.getElementById('btn-create-room');
const btnJoinRoom = document.getElementById('btn-join-room');
const btnStartOrderSetup = document.getElementById('btn-start-order-setup');
const btnStartGame = document.getElementById('btn-start-game');

const btnOshitsuke = document.getElementById('btn-item-oshitsuke');
const btnCancelTarget = document.getElementById('btn-cancel-target');
const btnEndTurn = document.getElementById('btn-end-turn');

const displayRoomId = document.getElementById('display-room-id');
const lobbyPlayerList = document.getElementById('lobby-player-list');

const amidaCanvas = document.getElementById('amida-canvas');
const gameCanvas = document.getElementById('game-canvas');
const ctx = gameCanvas.getContext('2d');
const turnInfo = document.getElementById('turn-info');
const statusInfo = document.getElementById('status-info');

// --- 画面遷移設定 ---

btnSingle.addEventListener('click', () => startSinglePlay());
btnCreateRoomMenu.addEventListener('click', () => {
    modeScreen.classList.add('hidden');
    createRoomScreen.classList.remove('hidden');
});
btnJoinRoomMenu.addEventListener('click', () => {
    modeScreen.classList.add('hidden');
    joinRoomScreen.classList.remove('hidden');
});
document.getElementById('btn-back-from-create').addEventListener('click', () => {
    createRoomScreen.classList.add('hidden');
    modeScreen.classList.remove('hidden');
});
document.getElementById('btn-back-from-join').addEventListener('click', () => {
    joinRoomScreen.classList.add('hidden');
    modeScreen.classList.remove('hidden');
});

// --- 通信 (PeerJS) 処理 ---

// 1. 部屋作成 (ホスト)
btnCreateRoom.addEventListener('click', () => {
    const name = document.getElementById('host-name-input').value.trim() || 'ホスト';
    gameState.maxPlayers = parseInt(document.getElementById('select-max-players').value, 10);
    isHost = true;
    gameState.isMultiplayer = true;

    // 部屋ID生成
    const roomId = 'ROOM-' + Math.floor(1000 + Math.random() * 9000);
    peer = new Peer(roomId);

    peer.on('open', (id) => {
        myPeerId = id;
        displayRoomId.textContent = id;
        
        // ホスト自身をプレイヤー追加
        gameState.players = [{
            peerId: id,
            name: name,
            isAlive: true,
            oshitsukeTarget: null,
            oshitsukeTurns: 0,
            hasOshitsukeItem: gameState.maxPlayers >= 3
        }];

        createRoomScreen.classList.add('hidden');
        lobbyScreen.classList.remove('hidden');
        updateLobbyUI();
    });

    // ゲストからの接続受け入れ
    peer.on('connection', (conn) => {
        connections.push(conn);
        conn.on('data', (data) => handleHostReceiveData(data, conn));
        conn.on('close', () => {
            connections = connections.filter(c => c !== conn);
            gameState.players = gameState.players.filter(p => p.peerId !== conn.peer);
            broadcastToAll({ type: 'LOBBY_UPDATE', players: gameState.players });
            updateLobbyUI();
        });
    });
});

// 2. 部屋参加 (ゲスト)
btnJoinRoom.addEventListener('click', () => {
    const name = document.getElementById('guest-name-input').value.trim() || 'ゲスト';
    const targetRoomId = document.getElementById('join-room-id-input').value.trim();

    if (!targetRoomId) return alert('ルームIDを入力してください');

    isHost = false;
    gameState.isMultiplayer = true;
    peer = new Peer();

    peer.on('open', (id) => {
        myPeerId = id;
        hostConnection = peer.connect(targetRoomId);

        hostConnection.on('open', () => {
            // ホストに入室リクエストを送信
            hostConnection.send({ type: 'JOIN_REQUEST', name: name, peerId: id });
            joinRoomScreen.classList.add('hidden');
            lobbyScreen.classList.remove('hidden');
            displayRoomId.textContent = targetRoomId;
        });

        hostConnection.on('data', (data) => handleGuestReceiveData(data));
    });
});

// --- 通信メッセージハンドラー ---

// ホスト側データ受信処理
function handleHostReceiveData(data, conn) {
    switch (data.type) {
        case 'JOIN_REQUEST':
            if (gameState.players.length < gameState.maxPlayers) {
                gameState.players.push({
                    peerId: data.peerId,
                    name: data.name,
                    isAlive: true,
                    oshitsukeTarget: null,
                    oshitsukeTurns: 0,
                    hasOshitsukeItem: gameState.maxPlayers >= 3
                });
                broadcastToAll({ type: 'LOBBY_UPDATE', players: gameState.players });
                updateLobbyUI();
            }
            break;

        case 'ACTION_END_TURN':
            processNextTurn();
            break;

        case 'ACTION_CLEAR_BUBBLES':
            processOjamaDistribute(data.attackerPeerId, data.clearedCount);
            break;

        case 'ACTION_OSHITSUKE':
            applyOshitsukeLogic(data.fromPeerId, data.targetPeerId);
            break;
    }
}

// ゲスト側データ受信処理
function handleGuestReceiveData(data) {
    switch (data.type) {
        case 'LOBBY_UPDATE':
            gameState.players = data.players;
            updateLobbyUI();
            break;

        case 'START_ORDER':
            gameState.players = data.players;
            lobbyScreen.classList.add('hidden');
            orderScreen.classList.remove('hidden');
            renderOrderScreen(data.isAmida);
            break;

        case 'START_GAME':
            orderScreen.classList.add('hidden');
            initGame();
            break;

        case 'SYNC_GAME_STATE':
            gameState.turnIndex = data.turnIndex;
            gameState.players = data.players;
            if (data.targetOjamaPeerId === myPeerId) {
                gameState.pendingOjama += data.addOjama;
            }
            updateUI();
            break;
    }
}

// 全員へ一括送信 (ホスト用)
function broadcastToAll(data) {
    connections.forEach(conn => {
        if (conn.open) conn.send(data);
    });
}

// ロビー更新
function updateLobbyUI() {
    lobbyPlayerList.innerHTML = "<b>参加メンバー:</b><br>" + 
        gameState.players.map(p => `- ${p.name} ${p.peerId === myPeerId ? "(あなた)" : ""}`).join("<br>");

    if (isHost) {
        btnStartOrderSetup.disabled = gameState.players.length < gameState.maxPlayers;
    } else {
        btnStartOrderSetup.disabled = true;
    }
}

// --- 順番決め（あみだくじ/じゃんけん）の同期 ---

btnStartOrderSetup.addEventListener('click', () => {
    if (!isHost) return;

    // 順番をランダム決定
    gameState.players.sort(() => Math.random() - 0.5);

    const isAmida = gameState.players.length >= 3;
    broadcastToAll({ type: 'START_ORDER', players: gameState.players, isAmida: isAmida });

    lobbyScreen.classList.add('hidden');
    orderScreen.classList.remove('hidden');
    renderOrderScreen(isAmida);
});

function renderOrderScreen(isAmida) {
    document.getElementById('order-title').textContent = isAmida ? "あみだくじ (順番決定)" : "じゃんけん (順番決定)";
    
    // Canvas演出描画
    const ctxA = amidaCanvas.getContext('2d');
    ctxA.clearRect(0, 0, amidaCanvas.width, amidaCanvas.height);
    ctxA.fillStyle = "#333";
    ctxA.font = "16px sans-serif";
    ctxA.fillText(isAmida ? "あみだくじ抽選完了！" : "じゃんけん勝敗完了！", 70, 120);

    let resultHtml = "<b>決定した順番:</b><br>";
    gameState.players.forEach((p, idx) => {
        resultHtml += `${idx + 1}番手: ${p.name} ${p.peerId === myPeerId ? '(自分)' : ''}<br>`;
    });
    document.getElementById('order-result').innerHTML = resultHtml;

    if (isHost) {
        btnStartGame.classList.remove('hidden');
        document.getElementById('waiting-host-msg').classList.add('hidden');
    } else {
        btnStartGame.classList.add('hidden');
        document.getElementById('waiting-host-msg').classList.remove('hidden');
    }
}

btnStartGame.addEventListener('click', () => {
    if (!isHost) return;
    broadcastToAll({ type: 'START_GAME' });
    orderScreen.classList.add('hidden');
    initGame();
});

// --- ゲーム進行・お邪魔・おしつけの完全同期 ---

function startSinglePlay() {
    gameState.isMultiplayer = false;
    gameState.maxPlayers = 1;
    gameState.players = [{ peerId: 'local', name: 'Player', isAlive: true, oshitsukeTarget: null, oshitsukeTurns: 0, hasOshitsukeItem: false }];
    modeScreen.classList.add('hidden');
    initGame();
}

function initGame() {
    gameState.turnIndex = 0;
    gameState.pendingOjama = 0;
    initBoard();
    updateUI();
    renderBoard();
}

function initBoard() {
    gameState.board = [];
    for (let r = 0; r < BOARD_ROWS; r++) {
        let row = [];
        for (let c = 0; c < BOARD_COLS; c++) {
            row.push(r >= BOARD_ROWS - 4 ? Math.floor(Math.random() * COLORS.length) : -1);
        }
        gameState.board.push(row);
    }
}

// ターン終了要求
btnEndTurn.addEventListener('click', () => {
    const curPlayer = gameState.players[gameState.turnIndex];
    if (gameState.isMultiplayer && curPlayer.peerId !== myPeerId) {
        return alert("あなたのターンではありません");
    }

    if (isHost) {
        processNextTurn();
    } else {
        hostConnection.send({ type: 'ACTION_END_TURN' });
    }
});

// ターン交代処理（ホストで一括管理）
function processNextTurn() {
    const curPlayer = gameState.players[gameState.turnIndex];

    // おしつけ効果ターンの減算
    if (curPlayer.oshitsukeTurns > 0) {
        curPlayer.oshitsukeTurns--;
        if (curPlayer.oshitsukeTurns === 0) curPlayer.oshitsukeTarget = null;
    }

    // 次の生存者へ
    do {
        gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    } while (!gameState.players[gameState.turnIndex].isAlive);

    syncGameState();
}

// お邪魔玉計算＆送出（ホスト管理）
function processOjamaDistribute(attackerPeerId, count) {
    const attacker = gameState.players.find(p => p.peerId === attackerPeerId);
    if (!attacker) return;

    gameState.players.forEach(p => {
        if (p.peerId === attackerPeerId || !p.isAlive) return;

        let targetPeerId = p.peerId;

        // おしつけ対象判定
        if (p.oshitsukeTurns > 0 && p.oshitsukeTarget) {
            targetPeerId = p.oshitsukeTarget;
        }

        // 同期通知
        syncGameState(targetPeerId, count);
    });
}

// おしつけアイテム発動
btnOshitsuke.addEventListener('click', () => {
    const curPlayer = gameState.players[gameState.turnIndex];
    if (curPlayer.peerId !== myPeerId) return;

    const targetButtons = document.getElementById('target-buttons');
    targetButtons.innerHTML = '';

    gameState.players.forEach(p => {
        if (p.peerId !== myPeerId && p.isAlive) {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.textContent = p.name;
            btn.onclick = () => {
                if (isHost) {
                    applyOshitsukeLogic(myPeerId, p.peerId);
                } else {
                    hostConnection.send({ type: 'ACTION_OSHITSUKE', fromPeerId: myPeerId, targetPeerId: p.peerId });
                }
                targetScreen.classList.add('hidden');
            };
            targetButtons.appendChild(btn);
        }
    });

    targetScreen.classList.remove('hidden');
});

btnCancelTarget.addEventListener('click', () => targetScreen.classList.add('hidden'));

function applyOshitsukeLogic(fromPeerId, targetPeerId) {
    const player = gameState.players.find(p => p.peerId === fromPeerId);
    if (player) {
        player.oshitsukeTarget = targetPeerId;
        player.oshitsukeTurns = gameState.players.filter(p => p.isAlive).length * 2; // 全員のターン2周分
        player.hasOshitsukeItem = false;
        syncGameState();
    }
}

// 全端末の状態同期
function syncGameState(targetOjamaPeerId = null, addOjama = 0) {
    if (!isHost) return;

    const syncData = {
        type: 'SYNC_GAME_STATE',
        turnIndex: gameState.turnIndex,
        players: gameState.players,
        targetOjamaPeerId: targetOjamaPeerId,
        addOjama: addOjama
    };

    if (targetOjamaPeerId === myPeerId) {
        gameState.pendingOjama += addOjama;
    }

    broadcastToAll(syncData);
    updateUI();
}

function updateUI() {
    const curPlayer = gameState.players[gameState.turnIndex];
    const isMyTurn = curPlayer && curPlayer.peerId === myPeerId;

    turnInfo.textContent = `手番: ${curPlayer ? curPlayer.name : '-'}` + (isMyTurn ? " (あなた)" : "");
    statusInfo.textContent = `お邪魔: ${gameState.pendingOjama}`;

    btnEndTurn.disabled = !isMyTurn;

    // おしつけボタン制御
    if (isMyTurn && gameState.players.length >= 3 && curPlayer.hasOshitsukeItem) {
        btnOshitsuke.disabled = false;
    } else {
        btnOshitsuke.disabled = true;
    }
}

function renderBoard() {
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const colorIdx = gameState.board[r][c];
            if (colorIdx >= 0) {
                ctx.beginPath();
                ctx.arc(c * BUBBLE_SIZE + BUBBLE_SIZE / 2 + 10, r * BUBBLE_SIZE + BUBBLE_SIZE / 2 + 10, BUBBLE_SIZE / 2 - 2, 0, Math.PI * 2);
                ctx.fillStyle = COLORS[colorIdx];
                ctx.fill();
                ctx.closePath();
            }
        }
    }
}

// タップ消去（自分のターンの時のみ動作）
gameCanvas.addEventListener('click', (e) => {
    const curPlayer = gameState.players[gameState.turnIndex];
    if (gameState.isMultiplayer && curPlayer.peerId !== myPeerId) return;

    const rect = gameCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor((x - 10) / BUBBLE_SIZE);
    const row = Math.floor((y - 10) / BUBBLE_SIZE);

    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
        if (gameState.board[row][col] !== -1) {
            gameState.board[row][col] = -1;
            renderBoard();

            // ホストへお邪魔通知
            if (isHost) {
                processOjamaDistribute(myPeerId, 1);
            } else {
                hostConnection.send({ type: 'ACTION_CLEAR_BUBBLES', attackerPeerId: myPeerId, clearedCount: 1 });
            }
        }
    }
});
