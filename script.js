// パズルボブル風お邪魔対戦 メインスクリプト
(function() {
    // 状態管理用変数
    let gameState = {
        mode: null,          // 'single', 'friend'
        playerCount: 2,      // 2 ~ 5
        subMode: 'ojama',    // 'time', 'ojama'
        winRule: 1,          // 1勝 または 2勝
        playerName: 'プレイヤー1',
        turnOrder: 1,        // 自分の順番 (1〜playerCount)
        totalPlayers: 2,
        winsNeeded: 1,
        currentWins: 0,
        itemActiveTurns: 0,  // おしつけアイテムの効果残ターン数
        itemTargetName: null // おしつけ先プレイヤー名
    };

    // DOM要素の取得
    const screens = {
        menu: document.getElementById('menu-screen'),
        playerCount: document.getElementById('player-count-screen'),
        friendMode: document.getElementById('friend-mode-screen'),
        modeSelect: document.getElementById('mode-select-screen'),
        winRule: document.getElementById('win-rule-screen'),
        nameInput: document.getElementById('name-input-screen'),
        order: document.getElementById('order-screen'),
        game: document.getElementById('game-screen'),
        result: document.getElementById('result-screen')
    };

    function showScreen(screenKey) {
        Object.keys(screens).forEach(key => {
            if (screens[key]) {
                screens[key].classList.add('hidden');
            }
        });
        if (screens[screenKey]) {
            screens[screenKey].classList.remove('hidden');
        }
    }

    // イベントリスナー設定
    document.getElementById('btn-single').addEventListener('click', () => {
        gameState.mode = 'single';
        gameState.playerCount = 1;
        showScreen('nameInput');
    });

    document.getElementById('btn-friend').addEventListener('click', () => {
        gameState.mode = 'friend';
        showScreen('playerCount');
    });

    // 人数選択
    document.querySelectorAll('.btn-count').forEach(btn => {
        btn.addEventListener('click', (e) => {
            gameState.playerCount = parseInt(e.target.getAttribute('data-count'));
            if (gameState.playerCount === 2) {
                showScreen('friendMode');
            } else {
                // 3人以上はお邪魔対戦固定なので勝利ルールへ
                gameState.subMode = 'ojama';
                showScreen('winRule');
            }
        });
    });

    document.getElementById('btn-count-back').addEventListener('click', () => showScreen('menu'));
    document.getElementById('btn-friend-back').addEventListener('click', () => showScreen('playerCount'));

    // ホスト / ゲスト選択 (2人の場合)
    document.getElementById('btn-host').addEventListener('click', () => {
        showScreen('modeSelect');
    });
    document.getElementById('btn-join').addEventListener('click', () => {
        showScreen('modeSelect');
    });

    document.getElementById('btn-mode-back').addEventListener('click', () => showScreen('friendMode'));

    // 対戦モード選択 (2人)
    document.getElementById('btn-mode-time').addEventListener('click', () => {
        gameState.subMode = 'time';
        showScreen('winRule');
    });
    document.getElementById('btn-mode-ojama').addEventListener('click', () => {
        gameState.subMode = 'ojama';
        showScreen('winRule');
    });

    document.getElementById('btn-win-back').addEventListener('click', () => {
        if (gameState.playerCount === 2) {
            showScreen('modeSelect');
        } else {
            showScreen('playerCount');
        }
    });

    // 勝利ルール選択
    document.querySelectorAll('.btn-win').forEach(btn => {
        btn.addEventListener('click', (e) => {
            gameState.winRule = parseInt(e.target.getAttribute('data-wins'));
            gameState.winsNeeded = gameState.winRule;
            showScreen('nameInput');
        });
    });

    // 名前入力OK
    document.getElementById('btn-name-ok').addEventListener('click', () => {
        const inputVal = document.getElementById('player-name-input').value.trim();
        if (inputVal) {
            gameState.playerName = inputVal;
        }
        startOrderPhase();
    });
    document.getElementById('btn-name-back').addEventListener('click', () => showScreen('winRule'));

    // 順番決めフェーズ
    function startOrderPhase() {
        showScreen('order');
        const orderContent = document.getElementById('order-content');
        const startBtn = document.getElementById('btn-start-battle');
        startBtn.classList.add('hidden');
        orderContent.innerHTML = '';

        if (gameState.playerCount === 1) {
            // ひとりの場合は即時開始
            gameState.turnOrder = 1;
            startGamePlay();
            return;
        }

        if (gameState.playerCount === 2) {
            // 2名：今まで通りのじゃんけん
            orderContent.innerHTML = `
                <p>ジャンケンで先攻・後攻を決めます！</p>
                <div style="margin: 20px 0;">
                    <button class="btn" id="btn-janken-rock">グー</button>
                    <button class="btn" id="btn-janken-paper">パー</button>
                    <button class="btn" id="btn-janken-scissors">チョキ</button>
                </div>
                <div id="janken-result"></div>
            `;
            const playJanken = (myHand) => {
                const hands = ['グー', 'チョキ', 'パー'];
                const cpuHand = hands[Math.floor(Math.random() * 3)];
                let resText = `CPUの手: ${cpuHand}<br>`;
                if (myHand === cpuHand) {
                    resText += 'あいこ！もう一度！';
                } else if (
                    (myHand === 'グー' && cpuHand === 'チョキ') ||
                    (myHand === 'チョキ' && cpuHand === 'パー') ||
                    (myHand === 'パー' && cpuHand === 'グー')
                ) {
                    resText += 'あなたの勝ち！ (1番手)';
                    gameState.turnOrder = 1;
                    document.getElementById('btn-start-battle').classList.remove('hidden');
                } else {
                    resText += 'あなたの負け！ (2番手)';
                    gameState.turnOrder = 2;
                    document.getElementById('btn-start-battle').classList.remove('hidden');
                }
                document.getElementById('janken-result').innerHTML = resText;
            };
            document.getElementById('btn-janken-rock').onclick = () => playJanken('グー');
            document.getElementById('btn-janken-paper').onclick = () => playJanken('パー');
            document.getElementById('btn-janken-scissors').onclick = () => playJanken('チョキ');
        } else {
            // 3名以上：あみだくじによるランダム順番生成
            orderContent.innerHTML = `
                <p>あみだくじで順番を抽選中...</p>
                <button class="btn" id="btn-amida-draw">あみだくじを引く</button>
                <div id="amida-result" style="margin-top: 20px; font-size: 1.2rem;"></div>
            `;
            document.getElementById('btn-amida-draw').onclick = () => {
                // 1からplayerCountまでの数値をランダムにシャッフル
                let orders = Array.from({length: gameState.playerCount}, (_, i) => i + 1);
                orders.sort(() => Math.random() - 0.5);
                gameState.turnOrder = orders[0]; // プレイヤーの順番

                let html = `参加者 ${gameState.playerCount} 名のあみだくじ結果：<br>`;
                orders.forEach((ord, idx) => {
                    let name = idx === 0 ? `${gameState.playerName} (あなた)` : `プレイヤー${idx + 1}`;
                    html += `・${name} ⇒ ${ord}番手<br>`;
                });
                document.getElementById('amida-result').innerHTML = html;
                document.getElementById('btn-amida-draw').style.display = 'none';
                document.getElementById('btn-start-battle').classList.remove('hidden');
            };
        }
    }

    document.getElementById('btn-start-battle').addEventListener('click', () => {
        showTurnAnnounceOverlay(() => {
            startGamePlay();
        });
    });

    // 画面中央に大きく順番を表示する演出
    function showTurnAnnounceOverlay(callback) {
        const overlay = document.getElementById('turn-announce-overlay');
        const text = document.getElementById('turn-announce-text');
        text.innerText = `${gameState.turnOrder}番手！ 対戦開始！`;
        overlay.classList.remove('hidden');
        setTimeout(() => {
            overlay.classList.add('hidden');
            if (callback) callback();
        }, 2000);
    }

    // ゲームプレイ開始・初期化
    function startGamePlay() {
        showScreen('game');
        
        // 3人以上の場合はアイテムパネルを表示
        const itemPanel = document.getElementById('item-panel');
        if (gameState.playerCount >= 3) {
            itemPanel.classList.remove('hidden');
            setupItemPanel();
        } else {
            itemPanel.classList.add('hidden');
        }

        initGameCanvas();
    }

    // 3人以上用アイテム設定
    function setupItemPanel() {
        const targetsDiv = document.getElementById('item-targets');
        targetsDiv.innerHTML = '';
        // ターゲット候補（自分以外のプレイヤー名）
        for (let i = 1; i <= gameState.playerCount; i++) {
            if (i !== gameState.turnOrder) {
                let targetName = `プレイヤー${i}`;
                let btn = document.createElement('button');
                btn.className = 'btn-small';
                btn.innerText = `${targetName}におしつける`;
                btn.onclick = () => {
                    gameState.itemActiveTurns = 4; // 全員のターン2周分（1周あたり2ターン換算など、規定の2ターンの期間を維持）
                    gameState.itemTargetName = targetName;
                    alert(`${targetName} に「おしつけ」アイテムを発動しました！（2ターンの間お邪魔玉が集中します）`);
                };
                targetsDiv.appendChild(btn);
            }
        }
    }

    // キャンバス・ゲームロジックの簡易実装
    function initGameCanvas() {
        const canvas = document.getElementById('game-canvas');
        const ctx = canvas.getContext('2d');
        canvas.width = 300;
        canvas.height = 400;

        let score = 0;
        document.getElementById('score-info').innerText = `スコア: ${score}`;

        // 基本ループや描画のプレースホルダー
        function loop() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            // 簡単なパズルボブル風描画
            ctx.fillStyle = '#ff5722';
            ctx.beginPath();
            ctx.arc(canvas.width / 2, canvas.height - 30, 15, 0, Math.PI * 2);
            ctx.fill();
            requestAnimationFrame(loop);
        }
        loop();
    }

    // ボタン操作などのプレースホルダー
    document.getElementById('btn-shoot').onclick = () => {
        // 玉を消したときのロジック（全員に同一数のお邪魔玉）
        // 3人以上で「おしつけ」が発動中の場合の処理
        if (gameState.playerCount >= 3 && gameState.itemActiveTurns > 0) {
            console.log(`おしつけ発動中: ${gameState.itemTargetName} に全お邪魔玉が飛んでいきました！自分には飛んきません。`);
            gameState.itemActiveTurns--;
            document.getElementById('item-turn-count').innerText = gameState.itemActiveTurns;
        } else {
            console.log('通常ルール: 全員に同一数のお邪魔玉が飛んでいきました。');
        }
    };

    document.getElementById('btn-pause').onclick = () => {
        showScreen('result');
        document.getElementById('result-title').innerText = '一時停止';
        document.getElementById('result-text').innerText = 'ゲームを中断しました。';
    };

    document.getElementById('btn-restart').onclick = () => {
        showScreen('menu');
    };

})();
