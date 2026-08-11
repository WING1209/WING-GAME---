/**
 * お邪魔対戦 (2~5人対応) ゲームロジック
 */

// --- 定数・構造体 ---
const BOARD_COLS = 6;
const BOARD_ROWS = 10;
const BUBBLE_SIZE = 40;

const COLORS = ['#ff4d4d', '#4da6ff', '#5cd65c', '#ffcc00', '#ff66cc'];

// --- アプリケーション状態 ---
let gameState = {
    playerCount: 2,
    players: [], // { id, name, isAlive, oshitsukeTarget: null, oshitsukeTurns: 0, hasOshitsukeItem: true }
    turnIndex: 0,
    board: [],
    pendingOjama: 0,
    isMultiplayer: false,
    selectedBubble: null
};

// --- DOM要素 ---
const modeScreen = document.getElementById('mode-screen');
const playerCountSelect = document.getElementById('player-count-select');
const nameInputScreen = document.getElementById('name-input-screen');
const nameInputsContainer = document.getElementById('name-inputs-container');
const orderScreen = document.getElementById('order-screen');
const targetScreen = document.getElementById('target-screen');

const btnSingle = document.getElementById('btn-single');
const btnOjamaMode = document.getElementById('btn-ojama-mode');
const btnConfirmPlayers = document.getElementById('btn-confirm-players');
const selectPlayers = document.getElementById('select-players');
const btnStartOrder = document.getElementById('btn-start-order');
const btnStartGame = document.getElementById('btn-start-game');
const btnOshitsuke = document.getElementById('btn-item-oshitsuke');
const btnCancelTarget = document.getElementById('btn-cancel-target');
const btnEndTurn = document.getElementById('btn-end-turn');

const amidaCanvas = document.getElementById('amida-canvas');
const gameCanvas = document.getElementById('game-canvas');
const ctx = gameCanvas.getContext('2d');

const turnInfo = document.getElementById('turn-info');
const statusInfo = document.getElementById('status-info');

// --- イベントリスナー初期化 ---
btnSingle.addEventListener('click', () => startSinglePlay());
btnOjamaMode.addEventListener('click', () => {
    playerCountSelect.classList.remove('hidden');
});

btnConfirmPlayers.addEventListener('click', () => {
    gameState.playerCount = parseInt(selectPlayers.value, 10);
    gameState.isMultiplayer = true;
    setupNameInputs();
    modeScreen.classList.add('hidden');
    nameInputScreen.classList.remove('hidden');
});

btnStartOrder.addEventListener('click', () => {
    // プレイヤー名の回収
    gameState.players = [];
    for (let i = 0; i < gameState.playerCount; i++) {
        const input = document.getElementById(`player-name-${i}`);
        const name = input.value.trim() || `P${i + 1}`;
        gameState.players.push({
            id: i,
            name: name,
            isAlive: true,
            oshitsukeTarget: null, // おしつけ対象のプレイヤーID
            oshitsukeTurns: 0,    // 効果継続ターン数
            hasOshitsukeItem: gameState.playerCount >= 3 // 3名以上のときだけ有効
        });
    }

    nameInputScreen.classList.add('hidden');
    orderScreen.classList.remove('hidden');

    if (gameState.playerCount >= 3) {
        runAmida();
    } else {
        runJanken();
    }
});

btnStartGame.addEventListener('click', () => {
    orderScreen.classList.add('hidden');
    initGame();
});

btnOshitsuke.addEventListener('click', () => {
    openOshitsukeTargetModal();
});

btnCancelTarget.addEventListener('click', () => {
    targetScreen.classList.add('hidden');
});

btnEndTurn.addEventListener('click', () => {
    nextTurn();
});

// --- UI / 設定構築 ---

function setupNameInputs() {
    nameInputsContainer.innerHTML = '';
    for (let i = 0; i < gameState.playerCount; i++) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = `player-name-${i}`;
        input.placeholder = `プレイヤー ${i + 1} の名前`;
        nameInputsContainer.appendChild(input);
    }
}

// --- 順番決め（あみだくじ / じゃんけん） ---

function runJanken() {
    document.getElementById('order-title').textContent = "じゃんけん (順番決定)";
    const amidaCtx = amidaCanvas.getContext('2d');
    amidaCtx.clearRect(0, 0, amidaCanvas.width, amidaCanvas.height);
    
    // 簡易的にランダム順番割り当て
    gameState.players.sort(() => Math.random() - 0.5);
    
    const resultDiv = document.getElementById('order-result');
    resultDiv.innerHTML = `先攻: <b>${gameState.players[0].name}</b><br>後攻: <b>${gameState.players[1].name}</b>`;
}

function runAmida() {
    document.getElementById('order-title').textContent = "あみだくじ (順番決定)";
    const count = gameState.playerCount;
    const ctxA = amidaCanvas.getContext('2d');
    ctxA.clearRect(0, 0, amidaCanvas.width, amidaCanvas.height);

    const w = amidaCanvas.width;
    const h = amidaCanvas.height;
    const padding = 30;
    const colSpacing = (w - padding * 2) / (count - 1);

    // シャッフルで順番決定
    const shuffled = [...gameState.players].sort(() => Math.random() - 0.5);

    // 縦線描画
    ctxA.strokeStyle = "#333";
    ctxA.lineWidth = 3;
    for (let i = 0; i < count; i++) {
        const x = padding + i * colSpacing;
        ctxA.beginPath();
        ctxA.moveTo(x, 20);
        ctxA.lineTo(x, h - 40);
        ctxA.stroke();
    }

    // 横線（ランダム作成）
    for (let i = 0; i < count - 1; i++) {
        const x1 = padding + i * colSpacing;
        const x2 = padding + (i + 1) * colSpacing;
        for (let j = 0; j < 2; j++) {
            const y = 50 + Math.random() * (h - 120);
            ctxA.beginPath();
            ctxA.moveTo(x1, y);
            ctxA.lineTo(x2, y);
            ctxA.stroke();
        }
    }

    // 結果の反映
    gameState.players = shuffled;

    let resultHtml = "<b>決定した順番:</b><br>";
    gameState.players.forEach((p, idx) => {
        resultHtml += `${idx + 1}番手: ${p.name}<br>`;
    });
    document.getElementById('order-result').innerHTML = resultHtml;
}

// --- ゲームロジック ---

function startSinglePlay() {
    gameState.isMultiplayer = false;
    gameState.playerCount = 1;
    gameState.players = [{ id: 0, name: 'Player', isAlive: true, oshitsukeTarget: null, oshitsukeTurns: 0, hasOshitsukeItem: false }];
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
            // 下部数行にランダム配置
            if (r >= BOARD_ROWS - 4) {
                row.push(Math.floor(Math.random() * COLORS.length));
            } else {
                row.push(-1); // 空白
            }
        }
        gameState.board.push(row);
    }
}

// ターン交代処理
function nextTurn() {
    if (!gameState.isMultiplayer) return;

    const curPlayer = gameState.players[gameState.turnIndex];

    // おしつけ効果ターンの減算 (全員のターンが一巡完了する概念に合わせてカウント)
    if (curPlayer.oshitsukeTurns > 0) {
        curPlayer.oshitsukeTurns--;
        if (curPlayer.oshitsukeTurns === 0) {
            curPlayer.oshitsukeTarget = null;
        }
    }

    // 生存している次のプレイヤーへ
    do {
        gameState.turnIndex = (gameState.turnIndex + 1) % gameState.players.length;
    } while (!gameState.players[gameState.turnIndex].isAlive);

    updateUI();
}

// 消去によるお邪魔玉の飛散処理
function processClearedBubbles(clearedCount) {
    if (clearedCount <= 0) return;

    // 基本生成数 (例: 消した数と同じ分だけお邪魔を生成)
    const ojamaAmount = clearedCount;
    const attacker = gameState.players[gameState.turnIndex];

    if (!gameState.isMultiplayer) return;

    // 他のプレイヤー全員に送信
    gameState.players.forEach((p) => {
        if (p.id === attacker.id || !p.isAlive) return;

        let targetPlayer = p;

        // 対象が「おしつけ」を発動している場合
        if (targetPlayer.oshitsukeTurns > 0 && targetPlayer.oshitsukeTarget !== null) {
            const redirectTarget = gameState.players.find(pt => pt.id === targetPlayer.oshitsukeTarget);
            if (redirectTarget && redirectTarget.isAlive) {
                // おしつけ先に送る
                sendOjamaToPlayer(redirectTarget, ojamaAmount);
                return;
            }
        }

        // 通常送付
        sendOjamaToPlayer(targetPlayer, ojamaAmount);
    });
}

function sendOjamaToPlayer(targetPlayer, count) {
    // 簡易的に自分ターンの画面にストック表示（複数人同時操作時に拡張可能）
    if (targetPlayer.id === gameState.players[gameState.turnIndex].id) {
        gameState.pendingOjama += count;
    }
    console.log(`${targetPlayer.name} に お邪魔玉 ${count} 個送信！`);
}

// --- おしつけアイテム処理 ---

function openOshitsukeTargetModal() {
    const targetButtons = document.getElementById('target-buttons');
    targetButtons.innerHTML = '';

    const curPlayer = gameState.players[gameState.turnIndex];

    gameState.players.forEach(p => {
        if (p.id !== curPlayer.id && p.isAlive) {
            const btn = document.createElement('button');
            btn.className = 'btn';
            btn.textContent = p.name;
            btn.onclick = () => {
                applyOshitsuke(p.id);
                targetScreen.classList.add('hidden');
            };
            targetButtons.appendChild(btn);
        }
    });

    targetScreen.classList.remove('hidden');
}

function applyOshitsuke(targetPlayerId) {
    const curPlayer = gameState.players[gameState.turnIndex];
    curPlayer.oshitsukeTarget = targetPlayerId;
    // 2ターン分（全員のターンが2周完了するまでのカウント相当：人数 × 2 ターン）
    curPlayer.oshitsukeTurns = gameState.players.filter(p => p.isAlive).length * 2;
    curPlayer.hasOshitsukeItem = false;

    updateUI();
    alert(`${gameState.players.find(p => p.id === targetPlayerId).name} に「おしつけ」を発動しました！(2周の間無効化)`);
}

// --- UI更新 ---

function updateUI() {
    const curPlayer = gameState.players[gameState.turnIndex];
    turnInfo.textContent = `手番: ${curPlayer ? curPlayer.name : '-'}`;
    statusInfo.textContent = `お邪魔: ${gameState.pendingOjama}`;

    // おしつけボタン制御 (3人以上 & 未使用 & 手番プレイヤーのみ)
    if (gameState.isMultiplayer && gameState.playerCount >= 3 && curPlayer.hasOshitsukeItem) {
        btnOshitsuke.disabled = false;
    } else {
        btnOshitsuke.disabled = true;
    }
}

// --- 描画処理 ---

function renderBoard() {
    ctx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);

    for (let r = 0; r < BOARD_ROWS; r++) {
        for (let c = 0; c < BOARD_COLS; c++) {
            const colorIdx = gameState.board[r][c];
            if (colorIdx >= 0) {
                ctx.beginPath();
                ctx.arc(
                    c * BUBBLE_SIZE + BUBBLE_SIZE / 2 + 10,
                    r * BUBBLE_SIZE + BUBBLE_SIZE / 2 + 10,
                    BUBBLE_SIZE / 2 - 2,
                    0,
                    Math.PI * 2
                );
                ctx.fillStyle = COLORS[colorIdx];
                ctx.fill();
                ctx.closePath();
            }
        }
    }
}

// タップ・消去サンプル（ボード操作の仮実装）
gameCanvas.addEventListener('click', (e) => {
    const rect = gameCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const col = Math.floor((x - 10) / BUBBLE_SIZE);
    const row = Math.floor((y - 10) / BUBBLE_SIZE);

    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
        if (gameState.board[row][col] !== -1) {
            // バブル消去
            gameState.board[row][col] = -1;
            renderBoard();
            
            // お邪魔処理の呼び出し (1個消去につき送信)
            processClearedBubbles(1);
        }
    }
});
