// ==========================================
// 1. 変数・状態管理の拡張 (複数人対戦 & 新アイテム)
// ==========================================
let maxPlayers = 2;              // 対戦人数 (2〜5人)
let playersList = [];            // 参加プレイヤー情報一覧 [{ id, peerId, name, turnOrder, winCount }]
let myPlayerName = "";           // 自分のプレイヤー名 (最大全角6文字)
let ojamaMultiplier = 1;         // お邪魔玉倍率設定 (1倍, 2倍, 3倍)

// 新規アイテム用状態 (自プレイヤー用)
let activePushTarget = null;     // 「おしつけ」対象プレイヤーID (2ターン/1周有効)
let pushEffectTurns = 0;         // 「おしつけ」効果残りターン数
let activeGuardTurns = 0;        // 「防御」効果残りターン数 (1周有効)
let isForcedShoot = false;       // 「発射」による強制発射フラグ

// ==========================================
// 2. メニュー・ホスト設定・名前入力フロー
// ==========================================
function setupMultiplayerRole(role) {
    battleRole = role;
    closeNetwork();
    
    if (role === 'host') {
        showScreen('screen-host-config'); // ホスト設定画面を表示
    } else {
        showScreen('screen-guest-join');
    }
}

// ホスト側の条件設定完了時
function confirmHostConfig() {
    maxPlayers = parseInt(document.getElementById('select-max-players').value);
    targetWins = parseInt(document.getElementById('select-target-wins').value);
    ojamaMultiplier = parseInt(document.getElementById('select-ojama-rate').value);
    
    roomCode = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('display-room-code').innerText = roomCode;
    
    showScreen('screen-host-wait-players');
    setupPeerAsHost();
}

// 名前入力完了後の送信処理
function submitPlayerName() {
    const inputEl = document.getElementById('input-player-name');
    let name = inputEl.value.trim();
    if (name.length === 0 || name.length > 6) {
        alert('名前は全角6文字以内で入力してください');
        return;
    }
    myPlayerName = name;
    
    if (conn && conn.open) {
        conn.send({ type: 'submit_name', name: myPlayerName });
    }
    showScreen('screen-wait-roulette-start');
}

// ==========================================
// 3. ルーレット順序決定 & 開始演出
// ==========================================
let myTurnNumber = 0;

function startOrderRoulette() {
    showScreen('screen-order-roulette');
    let rouletteBox = document.getElementById('roulette-number-box');
    let isStopped = false;
    
    let interval = setInterval(() => {
        if (!isStopped) {
            rouletteBox.innerText = Math.floor(Math.random() * maxPlayers) + 1;
        }
    }, 50);

    // 画面タップでルーレット停止
    document.getElementById('screen-order-roulette').onclick = () => {
        if (isStopped) return;
        isStopped = true;
        clearInterval(interval);
        
        // サーバー/ホストから割り振られた自ターンの番号を表示（かぶりなし）
        rouletteBox.innerText = `あなたは ${myTurnNumber} 番です`;
        
        setTimeout(() => {
            document.getElementById('btn-ready-start').style.display = 'block';
        }, 1000);
    };
}

// 全員の準備完了時に発火
function triggerGameStartNotice() {
    showScreen(''); // オーバーレイ解除
    let noticeEl = document.createElement('div');
    noticeEl.className = 'game-start-overlay';
    noticeEl.innerText = 'GAME START!';
    document.body.appendChild(noticeEl);
    
    setTimeout(() => {
        noticeEl.remove();
        gameState = 'playing';
        startBattleTurnLoop();
    }, 2000);
}

// ==========================================
// 4. お邪魔玉計算 ＆ 新規アイテム効果ロジック
// ==========================================

// 消去した玉数から飛ぶお邪魔玉数の基本計算
function calculateOjamaCount(clearedBubbles, itemMultiplier = 1) {
    // 【基本設定の倍率】 × 【消去数】 × 【アイテム(お邪魔2倍/3倍)】
    return clearedBubbles * ojamaMultiplier * itemMultiplier;
}

// 受信側でのお邪魔玉着弾前処理 (おしつけ・防御の反映)
function processIncomingOjama(amount, attackerId) {
    let finalAmount = amount;
    
    // 防御効果の適用（半減・端数切り捨て）
    if (activeGuardTurns > 0) {
        finalAmount = Math.floor(finalAmount / 2);
    }
    
    // おしつけ効果の適用（指定プレイヤーに転送）
    if (pushEffectTurns > 0 && activePushTarget) {
        sendOjamaToPlayer(activePushTarget, finalAmount);
        triggerMarqueeAnnouncement(`${myPlayerName} がお邪魔玉を転送！`);
        return; // 自分へのダメージは0
    }
    
    // 自分にお邪魔玉を発生させる
    if (finalAmount > 0) {
        launchOjamaProjectilesFromBottom(finalAmount);
    }
}

// ==========================================
// 5. 新規アイテム実行処理 (1:おしつけ, 2:発射, 3:防御)
// ==========================================
function useSpecialItem(itemType) {
    if (battleTurnState !== 'my_turn') return;

    if (itemType === 'push') {
        // 1. おしつけ：対象選択UIを表示
        showTargetSelectModal((targetPlayerId) => {
            activePushTarget = targetPlayerId;
            pushEffectTurns = maxPlayers; // 全員のターンが1周分（人件数分）持続
            alert(`2ターンの間、お邪魔玉を ${targetPlayerId} に押し付けます！`);
        });
    } 
    else if (itemType === 'forced_shoot') {
        // 2. 発射：対象選択UIを表示し、相手に強制発射命令を同期
        showTargetSelectModal((targetPlayerId) => {
            if (conn && conn.open) {
                conn.send({
                    type: 'apply_forced_shoot',
                    targetId: targetPlayerId
                });
            }
        });
    } 
    else if (itemType === 'guard') {
        // 3. 防御：1周分の間お邪魔玉を半減
        activeGuardTurns = maxPlayers;
        alert('1ターンの間、飛んでくるお邪魔玉を半減します！');
    }
}

// 強制発射ターンが回ってきた場合の処理
function handleMyTurnStart() {
    if (isForcedShoot) {
        isForcedShoot = false;
        alert('【発射】アイテムの効果！角度変更不可で強制発射されます！');
        
        // ランダムな角度で弾を発射
        let randomAngle = (Math.random() * 120 - 60) * (Math.PI / 180);
        bulletVX = Math.sin(randomAngle) * MAX_SPEED;
        bulletVY = -Math.cos(randomAngle) * MAX_SPEED;
        isMoving = true;
        
        // ターン終了へ移行
        switchTurnToNextPlayer();
        return;
    }
    
    startTurnTimer();
}
