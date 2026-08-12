/* ===================================================
   フレンド対戦 (2~5人対応 & おしつけアイテム) システム
   =================================================== */

// --- 変数定義 ---
let maxPlayers = 2;              // 対戦人数 (2〜5人)
let connections = {};            // ホスト用: { peerId: connection }
let playersData = [];            // プレイヤーデータ [{ peerId, name, order, isHost, oshitsukeTarget, oshitsukeTurnLeft }, ...]
let myPlayerName = "";
let myPeerId = "";
let currentTurnIndex = 0;        // 現在のターンのプレイヤーインデックス
let peer = null;
let conn = null;                 // ゲスト用接続オブジェクト
const PEER_PREFIX = 'pb-game-room-2026-v7-';

let battleType = 'タイムアタック';  // 'タイムアタック' or 'お邪魔対戦'
let targetwins = 1;              // 勝利条件 (1勝 or 2勝)
let myWins = 0;
let opponentWins = 0;
let battleRole = '';             // 'host' or 'guest'
let roomCode = '';

// --- 役割（ホスト / ゲスト）選択 ---
function selectRole(role) {
  battleRole = role;
  if (role === 'host') {
    showScreen('screen-host-mode-select'); // モード選択へ
  } else {
    showScreen('screen-guest-join');       // ID入力画面へ
  }
}

// --- ホスト：モード選択 ---
function setHostBattleType(type) {
  battleType = type;
  if (type === 'お邪魔対戦') {
    showScreen('screen-player-count');     // 何人で遊ぶかメニューを表示
  } else {
    maxPlayers = 2;                        // タイムアタックは自動的に2人
    showScreen('screen-win-rule-select');  // 勝利ルール選択へ
  }
}

// --- ホスト：人数選択（お邪魔対戦のみ） ---
function setPlayerCount(count) {
  maxPlayers = count;
  showScreen('screen-win-rule-select');    // 勝利ルール選択へ
}

// --- ホスト：勝利ルール選択＆部屋作成 ---
function setHostTargetWins(wins) {
  targetwins = wins;
  createHostRoom();                        // IDを発行して接続待機画面へ
}

// --- ホスト：部屋作成＆接続受け入れ ---
function createHostRoom() {
  roomCode = Math.floor(1000 + Math.random() * 9000).toString(); // 4桁の部屋ID
  connections = {};
  playersData = [];

  peer = new Peer(PEER_PREFIX + roomCode);
  peer.on('open', (id) => {
    myPeerId = id;
    document.getElementById('display-room-code').innerText = roomCode;
    updateHostWaitUI();
    showScreen('screen-host-wait');
  });

  peer.on('connection', (c) => {
    // 定員未満なら接続許可
    if (Object.keys(connections).length < maxPlayers - 1) {
      connections[c.peer] = c;
      setupHostConnectionListeners(c);
    } else {
      c.send({ type: 'room_full' });
      setTimeout(() => c.close(), 500);
    }
  });
}

function updateHostWaitUI() {
  const currentCount = Object.keys(connections).length + 1;
  const statusEl = document.getElementById('connected-count-text');
  if (statusEl) statusEl.innerText = `接続人数: ${currentCount} / ${maxPlayers} 人`;

  // 規定人数が揃ったら名前入力へ進行
  if (currentCount === maxPlayers) {
    broadcast({ type: 'goto_name_input' });
    setTimeout(() => {
      showScreen('screen-player-name');
    }, 500);
  }
}

// ホスト側の接続受信用リスナー
function setupHostConnectionListeners(c) {
  c.on('open', () => {
    updateHostWaitUI();
  });

  c.on('data', (data) => {
    if (data.type === 'submit_name') {
      let existing = playersData.find(p => p.peerId === data.peerId);
      if (!existing) {
        playersData.push({
          peerId: data.peerId,
          name: data.name,
          isHost: false,
          oshitsukeTarget: null,
          oshitsukeTurnLeft: 0
        });
      }
      checkAllPlayersReady();
    } else if (data.type === 'sync_turn_action') {
      executeOpponentAction(data);
    } else if (data.type === 'sync_item_oshitsuke') {
      // おしつけアイテム設定の同期
      let targetP = playersData.find(p => p.peerId === data.sourcePeerId);
      if (targetP) {
        targetP.oshitsukeTarget = data.targetName;
        targetP.oshitsukeTurnLeft = 2; // 全員が2周終了するまで
      }
      broadcast(data); // 他メンバーへ転送
    } else if (data.type === 'relay_ojama') {
      // ゲストから届いたお邪魔玉の転送処理
      processIncomingAttack(data.fromIndex, data.amount);
    }
  });

  c.on('close', () => {
    delete connections[c.peer];
    updateHostWaitUI();
  });
}

// --- ゲスト：部屋参加 ---
function joinRoom() {
  let code = document.getElementById('input-room-code').value;
  if (code.length !== 4) {
    document.getElementById('status-message').innerText = '4桁の数字を入力してください';
    return;
  }
  document.getElementById('status-message').innerText = '接続中...';
  
  peer = new Peer();
  peer.on('open', (id) => {
    myPeerId = id;
    conn = peer.connect(PEER_PREFIX + code);
    setupGuestConnectionListeners();
  });

  peer.on('error', () => {
    document.getElementById('status-message').innerText = '部屋が見つからないか、接続に失敗しました';
  });
}

function setupGuestConnectionListeners() {
  conn.on('open', () => {
    showScreen('screen-guest-wait-host'); // ホストの設定・人数揃い待ち
  });

  conn.on('data', (data) => {
    if (data.type === 'room_full') {
      alert('満員のため参加できませんでした');
      returnToTitle();
    } else if (data.type === 'goto_name_input') {
      showScreen('screen-player-name');
    } else if (data.type === 'game_start_sync') {
      playersData = data.players;
      battleType = data.rules.battleType;
      targetwins = data.rules.targetwins;
      maxPlayers = data.rules.maxPlayers;
      startRouletteSequence();
    } else if (data.type === 'receive_ojama') {
      spawnOjamaBallsInCanvas(data.amount);
    } else if (data.type === 'sync_item_oshitsuke') {
      let targetP = playersData.find(p => p.peerId === data.sourcePeerId);
      if (targetP) {
        targetP.oshitsukeTarget = data.targetName;
        targetP.oshitsukeTurnLeft = 2;
      }
    }
  });
}

// --- 名前入力 & 全員準備チェック ---
function submitPlayerName() {
  myPlayerName = document.getElementById('input-player-name').value.trim() || "名無し";
  document.getElementById('btn-submit-name').disabled = true;

  if (battleRole === 'host') {
    playersData.push({
      peerId: myPeerId,
      name: myPlayerName,
      isHost: true,
      oshitsukeTarget: null,
      oshitsukeTurnLeft: 0
    });
    checkAllPlayersReady();
  } else {
    conn.send({ type: 'submit_name', name: myPlayerName, peerId: myPeerId });
  }
}

function checkAllPlayersReady() {
  if (battleRole !== 'host') return;
  
  // 全員の名前が集まったら順番決め
  if (playersData.length === maxPlayers) {
    // 被りのない順番配列を生成 (0 ~ maxPlayers-1)
    let orderArray = Array.from({ length: maxPlayers }, (_, i) => i);
    orderArray.sort(() => Math.random() - 0.5);

    playersData.forEach((p, index) => {
      p.order = orderArray[index];
    });

    // 順番通りにソート
    playersData.sort((a, b) => a.order - b.order);

    // 全員に同期送信
    broadcast({
      type: 'game_start_sync',
      players: playersData,
      rules: { targetwins, battleType, maxPlayers }
    });

    startRouletteSequence();
  }
}

// 全員へのブロードキャスト用関数
function broadcast(data) {
  Object.values(connections).forEach(c => {
    if (c.open) c.send(data);
  });
}

// --- 順番決めルーレット演出 ---
function startRouletteSequence() {
  showScreen('screen-turn-order');
  
  let animText = document.getElementById('roulette-anim-text');
  let resultContainer = document.getElementById('turn-order-result-container');
  let resultText = document.getElementById('turn-order-large-text');

  if (animText) animText.style.display = 'block';
  if (resultContainer) resultContainer.style.display = 'none';

  // 自分の順番（1番手〜N番手）を特定
  let myOrderRank = playersData.findIndex(p => p.name === myPlayerName) + 1;

  // ルーレットのアニメーション演出
  let count = 0;
  let interval = setInterval(() => {
    if (animText) {
      animText.innerText = `順番を抽選中... [ ${Math.floor(Math.random() * maxPlayers) + 1} 番手 ]`;
    }
    count++;
    if (count > 15) {
      clearInterval(interval);
      if (animText) animText.style.display = 'none';
      if (resultContainer) resultContainer.style.display = 'block';
      
      // 画面中央に大きく表示
      if (resultText) {
        resultText.innerText = `【 ${myOrderRank} 番手 】`;
      }

      // 2.5秒後に対戦画面へ移行
      setTimeout(() => {
        executeBattleStart();
      }, 2500);
    }
  }, 100);
}

// --- 対戦開始処理 ---
function executeBattleStart() {
  gameMode = 'battle';
  gameState = 'playing';
  currentTurnIndex = 0;

  // 3人以上のお邪魔対戦の場合のみ「おしつけアイテム」UIを表示
  let itemUI = document.getElementById('ingame-ui');
  if (itemUI) {
    if (battleType === 'お邪魔対戦' && maxPlayers >= 3) {
      itemUI.style.display = 'flex';
    } else {
      itemUI.style.display = 'none';
    }
  }

  showScreen(''); // ゲーム画面を表示
  initGridForStage(1);
  spawnBullet();
  playRandomBGM();
}

// --- お邪魔玉送信 ＆ 「おしつけ」効果判定 ---
function sendOjamaToOthers(amount) {
  if (amount <= 0 || battleType !== 'お邪魔対戦') return;

  let senderIndex = currentTurnIndex;

  // 自分以外の各プレイヤーへお邪魔玉の処理を行う
  playersData.forEach((targetPlayer, idx) => {
    if (idx === senderIndex) return; // 自分自身には直接送らない

    let finalAmount = amount;
    let finalTarget = targetPlayer;

    // 「おしつけ」アイテムが発動中か判定
    if (targetPlayer.oshitsukeTurnLeft > 0 && targetPlayer.oshitsukeTarget) {
      // 指定されたターゲット（被害者）を検索
      let victim = playersData.find(p => p.name === targetPlayer.oshitsukeTarget);
      if (victim) {
        // お邪魔玉は指定したプレイヤー（victim）へ転送される
        finalTarget = victim;
      }
    }

    // 転送先が自分（ローカル）の場合
    if (finalTarget.name === myPlayerName) {
      spawnOjamaBallsInCanvas(finalAmount);
    } else if (battleRole === 'host') {
      // ホストから該当のゲストへ直接送信
      let c = connections[finalTarget.peerId];
      if (c && c.open) {
        c.send({ type: 'receive_ojama', amount: finalAmount });
      }
    } else {
      // ゲストからホストへ中継要求
      conn.send({
        type: 'relay_ojama',
        fromIndex: senderIndex,
        targetPeer: finalTarget.peerId,
        amount: finalAmount
      });
    }
  });
}

// 中継用（ホスト側で実行）
function processIncomingAttack(fromIndex, amount) {
  sendOjamaToOthers(amount);
}

// --- 「おしつけ」アイテム使用ダイアログ ---
function useOshitsukeItem() {
  let me = playersData.find(p => p.name === myPlayerName);
  if (me && me.oshitsukeTurnLeft > 0) {
    alert("「おしつけ」効果はすでに発動中です！");
    return;
  }

  let list = document.getElementById('target-player-list');
  if (!list) return;
  list.innerHTML = "";

  playersData.forEach(p => {
    if (p.name !== myPlayerName) {
      let btn = document.createElement('button');
      btn.className = "menu-btn sub";
      btn.innerText = `${p.name} に押し付ける`;
      btn.onclick = () => {
        applyOshitsuke(p.name);
      };
      list.appendChild(btn);
    }
  });

  showScreen('screen-item-target');
}

function applyOshitsuke(targetName) {
  let me = playersData.find(p => p.name === myPlayerName);
  if (me) {
    me.oshitsukeTarget = targetName;
    me.oshitsukeTurnLeft = 2; // 全員のターンが2周終了するまで有効
  }

  // 同期送信
  if (battleRole === 'host') {
    broadcast({
      type: 'sync_item_oshitsuke',
      sourcePeerId: myPeerId,
      targetName: targetName
    });
  } else {
    conn.send({
      type: 'sync_item_oshitsuke',
      sourcePeerId: myPeerId,
      targetName: targetName
    });
  }

  alert(`${targetName} さんに「おしつけ」を設定しました！（2ターンの間無効化）`);
  showScreen(''); // ダイアログを閉じる
}

// --- ターン経過と「おしつけ」ターン数管理 ---
function advanceTurn() {
  currentTurnIndex = (currentTurnIndex + 1) % maxPlayers;

  // 1周（全員が1回ずつターンを終えて最初のプレイヤーに戻ったタイミング）で周数を消化
  if (currentTurnIndex === 0) {
    playersData.forEach(p => {
      if (p.oshitsukeTurnLeft > 0) {
        p.oshitsukeTurnLeft--;
        if (p.oshitsukeTurnLeft === 0) {
          p.oshitsukeTarget = null; // 効果終了
        }
      }
    });
  }
}
