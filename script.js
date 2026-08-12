// ==========================================
// バブルシューター マルチ・フレンド対戦拡張モジュール
// ==========================================

// 対戦設定の状態保持用オブジェクト
const friendMatchConfig = {
    playerCount: 2,       // 2～5
    mode: 'ojama',        // 'timeattack' または 'ojama' (2人のみ選択可)
    winTarget: 1,         // 1勝または2勝
    playerName: '',       // 自分の名前
    playerOrder: [],      // 参加者全員の順番リスト ([{id, name}, ...])
    myIndex: 0,           // 自分の順番インデックス
    currentTurnIndex: 0,  // 現在のターンのインデックス
    itemOshitsukeTarget: null, // 「おしつけ」対象のプレイヤーID
    itemOshitsukeTurnsLeft: 0  // 「おしつけ」効果の残りターン数（全員のターンが2周）
};

// PeerJS関連のマルチ接続管理（ホスト/ゲスト共通）
let multiConnections = {}; // 接続ピアのリスト { peerId: dataConnection }
let isMultiHost = false;
let myPeerId = '';
let peerInstance = null;

// 1. 【GUIフロー開始】フレンド対戦メニューの初期化・表示
function initFriendMatchMenu() {
    // 既存のメインメニュー（ホストorゲスト選択など）を非表示にし、人数選択画面を表示
    showPlayerCountSelectUI();
}

// 2. 何人で遊ぶか選択 (2〜5人)
function selectPlayerCount(count) {
    friendMatchConfig.playerCount = count;
    
    if (count === 2) {
        // 2人の場合は対戦モード（タイムアタック or お邪魔）を選択
        showModeSelectUI();
    } else {
        // 3〜5人の場合は「お邪魔対戦」固定、勝利ルール選択へ進む
        friendMatchConfig.mode = 'ojama';
        showWinTargetSelectUI();
    }
}

// 3. 2人対戦時のモード選択 (タイムアタック or お邪魔対戦)
function selectGameMode(mode) {
    friendMatchConfig.mode = mode;
    showWinTargetSelectUI();
}

// 4. 勝利ルール選択 (先に1勝 or 先に2勝)
function selectWinTarget(target) {
    friendMatchConfig.winTarget = target;
    showPlayerNameInputUI();
}

// 5. プレイヤー名前入力完了時
function submitPlayerName(name) {
    friendMatchConfig.playerName = name || 'プレイヤー';
    
    // ホスト or ゲストの接続処理へ移行
    setupPeerConnectionFlow();
}

// 6. 順番決め処理（2人ならジャンケン、3人以上ならあみだくじランダム生成）
function determineTurnOrder(allPlayers) {
    // allPlayers は [{id: 'peerId1', name: '名前1'}, ...] の配列
    if (friendMatchConfig.playerCount === 2) {
        // 2人の場合は既存のジャンケン処理へ
        startJankenBattle(allPlayers);
    } else {
        // 3人以上はあみだくじ風のランダム生成で順番を決める
        let shuffled = [...allPlayers].sort(() => Math.random() - 0.5);
        friendMatchConfig.playerOrder = shuffled;
        
        // 自分のインデックスを特定
        friendMatchConfig.myIndex = shuffled.findIndex(p => p.id === myPeerId);
        friendMatchConfig.currentTurnIndex = 0;
        
        // 順番決定結果を全員に同期 (ホストの場合)
        if (isMultiHost) {
            broadcastToAll({
                type: 'SET_ORDER',
                order: shuffled
            });
        }
        
        // 画面中央に大きく順番を表示する演出を実行
        showTurnOrderAnnouncement(friendMatchConfig.myIndex + 1);
    }
}

// 画面中央に大きく「〇番手」を表示する関数
function showTurnOrderAnnouncement(orderNumber) {
    const announcementEl = document.createElement('div');
    announcementEl.id = 'turn-announcement';
    announcementEl.style.cssText = `
        position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.85); color: #fff; padding: 30px 50px;
        font-size: 48px; font-weight: bold; border-radius: 15px; z-index: 9999;
        text-align: center; box-shadow: 0 0 20px rgba(255,255,255,0.5);
        animation: fadeInOut 2.5s forwards;
    `;
    announcementEl.innerHTML = `あなたは<br><span style="color: #ffeb3b; font-size: 64px;">${orderNumber}番手</span> です！`;
    document.body.appendChild(announcementEl);

    setTimeout(() => {
        announcementEl.remove();
        startBattleGame(); // 対戦開始へ
    }, 2500);
}

// 7. ゲームロジック：自分のターンで玉を消した時のお邪魔玉処理 ＆ 特殊アイテム「おしつけ」
function onMyTurnClearBubbles(clearedCount) {
    if (clearedCount <= 0) return;

    // 基本ルール：全員に同一数のお邪魔玉が飛んでいく
    let targetList = [];
    
    if (friendMatchConfig.playerCount >= 3) {
        // 3名以上の場合の「おしつけ」アイテム判定
        if (friendMatchConfig.itemOshitsukeTurnsLeft > 0 && friendMatchConfig.itemOshitsukeTarget) {
            // おしつけ発動中：指定されたプレイヤーに自分の分もすべて集中させる
            targetList = [friendMatchConfig.itemOshitsukeTarget];
            
            // 残りターン（全員のターンが周回する単位）の減算処理はターン終了時に行う
        } else {
            // 通常時：自分以外の全員に飛んでいく
            targetList = friendMatchConfig.playerOrder
                .filter(p => p.id !== myPeerId)
                .map(p => p.id);
        }
    } else {
        // 2人対戦時
        targetList = friendMatchConfig.playerOrder
            .filter(p => p.id !== myPeerId)
            .map(p => p.id);
    }

    // ネットワーク経由で相手にお邪魔玉データを送信
    sendOjamaData(targetList, clearedCount);
}

// 特殊アイテム「おしつけ」の使用処理（3名以上限定）
// targetPlayerId: おしつける相手のプレイヤーID
function useItemOshitsuke(targetPlayerId) {
    if (friendMatchConfig.playerCount < 3) return;
    
    friendMatchConfig.itemOshitsukeTarget = targetPlayerId;
    // 「全員のターンが2周終了するまで」 = (参加人数 * 2) ターンの間効果継続
    friendMatchConfig.itemOshitsukeTurnsLeft = friendMatchConfig.playerCount * 2;

    // ほかのプレイヤーにもおしつけ発動を通知
    broadcastToAll({
        type: 'USE_OSHITSUKE',
        from: myPeerId,
        target: targetPlayerId,
        durationTurns: friendMatchConfig.itemOshitsukeTurnsLeft
    });
}

// ターン交代時の処理（周回管理）
function nextTurn() {
    friendMatchConfig.currentTurnIndex = (friendMatchConfig.currentTurnIndex + 1) % friendMatchConfig.playerOrder.length;
    
    // もし1周まわったら「おしつけ」の残りターンを減少させる
    if (friendMatchConfig.currentTurnIndex === 0 && friendMatchConfig.itemOshitsukeTurnsLeft > 0) {
        friendMatchConfig.itemOshitsukeTurnsLeft--;
        if (friendMatchConfig.itemOshitsukeTurnsLeft <= 0) {
            friendMatchConfig.itemOshitsukeTarget = null;
        }
    }
}

// ネットワーク同期用ヘルパー
function broadcastToAll(data) {
    Object.values(multiConnections).forEach(conn => {
        if (conn && conn.open) {
            conn.send(data);
        }
    });
}

function sendOjamaData(targets, count) {
    targets.forEach(targetId => {
        if (targetId === myPeerId) return;
        const conn = multiConnections[targetId];
        if (conn && conn.open) {
            conn.send({
                type: 'ADD_OJAMA',
                from: myPeerId,
                count: count
            });
        }
    });
}
