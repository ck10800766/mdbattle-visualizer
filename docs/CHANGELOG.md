# Changelog

本文件依版本號記錄 `mdbattle-visualizer` 的所有更新歷程、功能交付與 Bug 修復。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本編號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

## [Unreleased]

## [7.5.6] - 2026-10-19

### Fixed
- **台詞前自然後撤與消除 0ms 瞬間移動（瞬移回位）**：
  - 修正 `lookaheadComboState`（`src/combo.js`）：當攻擊後續在同回合內夾帶角色台詞（`resolveDialogueSpeaker`）或奧義宣誓等停頓影格時，精確觸發 `shouldReturnToOrigin = true`。攻擊者在執行當前打擊時，便會透過既有的 `pStart -> pTarget -> p0` 完整動畫自然而平滑地後撤回原位，發言時早已在初始站位從容開口。
  - 在 `src/stage.js` 的台詞與場景旁白過渡中，針對任何殘留前衝位移之角色改以 200ms ease-out 平滑過渡動畫歸位，徹底消除 0ms 瞬間瞬移的視覺跳躍感。
- **乾坤大挪移同隊友誤傷（Friendly Fire）突進座標修正**：
  - 修復攻擊者與目標處於同側陣營（如張無忌乾坤大挪移將流螢攻擊轉向流螢2/流螢3）時，位移公式誤按跨場敵方計算 `-60px` 導致朝向螢幕外側反向衝刺的座標 Bug。
  - 於 `src/choreography.js` 與 `src/stageSync.js` 中新增同側陣營判定：同側誤傷時向場內前踏（`+35px` / `-35px`）並根據隊友 Y 軸垂直衝刺，受擊方產生向外側受擊後仰硬直，還原逼真的混亂牽引對撞感。
- **Boss 戰敗劇情台詞延後灰階化（告別殭屍發言）**：
  - 新增 `hasUpcomingDialogueInBattle` 語義判定（`src/cinematics.js`）：當角色或 Boss 陣亡（`isDeathEvent: true`）但後續仍有戰敗台詞、拱手行禮或最後遺言時（如張無忌戰敗後的認輸抱拳與保護明教眾人、流螢2/3的「任務……終止……」），在演出結束前不套用 `.dead` 灰階化屍體外觀。
  - 待該角色的最終台詞完全落幕後，再透過 CSS 0.3s 平滑淡入 `.dead` 戰敗狀態，確保戰役收尾莊重自然。

## [7.5.5] - 2026-10-18

### Fixed
- **召喚物結構性非戰鬥離場搜尋起點修復**（保護傘公司 53F 戰報）：
  - 修復 `computeStructuralSummonDepartures` 啟始搜尋下界錯誤（由 `Math.max(0, lastCombatIdx)` 修正為 `Math.max(spawnIdx, lastCombatIdx)`）：
    - 原先若召喚物登場後未曾直接受擊/出招即隨劇情離場（如獵殺者遭直升機吊離現場），因 `lastCombatIdx === -1` 導致搜尋迴圈從第 0 幀起算，誤匹配到開場前同名召喚物（第 26 幀）而預先標註離場的結構性 Bug。
    - 嚴格遵守「提到名字 + 後續無戰鬥互動」的純結構性不變量判定，完全不需增加或依賴硬編碼正則表達式，召喚物登場後於第 267 幀敘述提及並在後續無互動，即可精準識別離場並同步觸發退場動畫。
- **角色說話不再黏在敵人身上**：
  - 於 `stage.js` 台詞演出時強制將全員位置重置回原位（取消殘留突進動畫並清空 `style.transform`），確保角色絕不會在突進攻擊後站在敵人臉上說話。
- **召喚物退場完整滑出螢幕外緣與旁白誤殺退場動畫修復**：
  - 修復 `isSceneNarrationFrame` 場景旁白在重置角色位置時，因對所有元素無差別呼叫 `anim.cancel()` 而在第 267 幀一瞬間腰斬了獵殺者吊離退場動畫、導致原地無動畫蒸發的嚴重 Bug；加入 `.spawning` 與 `.despawning` 狀態防護，確保進退場動畫完整播映。
  - 將召喚物進退場位移距離由過短且落在螢幕中央的固定 180px，升級為自適應螢幕邊緣的 `calc(50vw + 160px)`，使召喚物真正平滑滑出視窗邊界外後再行隱藏，告別半途蒸發感。

### Changed
- **抑制奧義特寫（Cut-In）台詞的重複角色對話框演出**：
  - 新增 `isUltimateCutInQuoteFrame(frame)` 判定：當角色的詠唱/宣誓台詞（<= 20 字）已被選取並呈現在全螢幕垂直滾動 Cut-In 特寫中時，舞台即時演繹（`stage.js`）與時間軸拖曳同步（`stageSync.js`）將主動抑制該角色的頭頂打字機對話框（`renderSpeechBubble`），避免角色在全螢幕帥氣喊出台詞的同時，背後或兩側又露出一模一樣的對話框導致一句話演出兩次的視覺瑕疵。
  - 在 `playUltimateCutIn` 啟動瞬間自動清空場上殘留對話框，確保大招特寫乾淨俐落無雜訊干擾。
  - 長文本鋪陳（如 Gebura 巷子獨白）因被 `shouldDeferUltimateCutIn` 延後出招且不寫入 Cut-In，仍完整保留頭頂對話框供玩家閱讀。

## [7.5.4] - 2026-10-18

### Added
- **進度條滑鼠懸停即時幀數預覽**：
  - 於進度條軌道加入 `.seek-hover-tooltip` 浮動預覽，滑鼠移動時即時顯示 `第 X 幀 (TY)`（如 `第 81 幀 (T19)`），並於左右邊界自適應靠齊。
- **時間軸關鍵幀射線吸附（Proximity Hit-Testing）**：
  - 取消 `.seek-pin` 的 DOM 物理放大攔截（`pointer-events: none`），改採軌道水平最近鄰吸附。游標只要跨越兩點中點，毫秒級平滑無縫切換焦點與提示，徹底解決相鄰點放大互遮導致必須「移過頭再回頭」的問題。
- **大招台詞字數放寬與自適應排版**：
  - 將 Cut-In 台詞提取上限放寬至 20 字，完美呈現如流螢「我為自我而戰，直至一切……燃燒殆盡！」（18 字）等完整台詞，超過 12 字時動態掛載 `.long-quote` 緊湊排版。

### Changed
- **多行大招演出時機點（台詞前置，出招時才觸發特寫）**：
  - 實作 `shouldDeferUltimateCutIn`：針對有多行大招情境（如 Gebura 巷子獨白、流螢解開薩姆限制等），先在舞台上正常播完前置台詞對話框與鋪陳動作，直到播到真正出招行才瞬間觸發全螢幕垂直 Cut-In 特寫，徹底解決「開了大招後站在原地說了三句話」的節奏割裂感。
- **泛用招式名稱提取規則**：
  - 發現並驗證 MD 底層戰鬥模板規律：技能發動必然為動詞變量插值且帶有半形空格（`\S{1,4}了\s+` 或 `進入\s+`），普通敘述句則緊密相連不帶空格。
  - 徹底廢除寫死的 `使出了|進入|綻放了|解放了|發動了|施展了|演化出了|喚出了|召喚了` 動詞白名單，改採語法結構自動辨識。

### Fixed
- **亡者保留於場上與復活順暢擺脫死亡狀態**：
  - 死亡單位不再直接自戰場移除，而是留存為灰色亡者屍體；後續復活或多階段甦醒時平滑切換回存活狀態。
- **AOE 迎擊反擊（Counter）導致 Boss 被擊飛至螢幕外問題**（`oni-gunsou.json` 第 97 影格）：
  - 修復在連續正常播放時，若前段戰鬥有其他角色（如小櫻）施放 AOE 技能，殘留的 `aoeCenterX` 座標值未因環境脈衝（`ENVIRONMENTAL_SKILLS`）而清空，導致第 97 影格防守方對 Boss 手榴彈發動迎擊反擊時，誤套用前一位左側角色的正向位移數值（`+450px`），將右側的 Boss 往右側螢幕外邊界推飛。
  - 於 `playAOEWaveChoreography` 與 `playAOEWaveBatchChoreography` 中加入 `aoeCasterId` 一致性校驗、強制首影格重算、座標物理方向限制（右側角色必定往舞台中心負向位移、左側角色必定正向位移）與邊界防護鉗位（`maxDisplacement`），並於 AOE 結束時徹底清空暫態座標。
- **時間軸拖曳（Scrubbing）時小櫻奧義 Cut-in 顯示錯誤問題**：
  - 修復在時間軸拖曳或跳轉影格時，`actor.lastUltimateTurn` 被盲目清空為 `null`，導致當進度落於奧義多段打擊的子影格（如小櫻火之牌第 51/85 傷害影格）時，誤觸發次級 Cut-in 並退回英文 `FIREY` 與傷害數字的 Bug。
  - 在 `syncStageToAbsoluteState` 中依照目標影格重建準確的 `lastUltimateTurn` 狀態，避免跳轉到連續打擊途中引發幽靈 Cut-in；同時增強 `playUltimateCutIn` 的技能文本解析，使子影格向上搜尋同回合主要施法文案，確保始終顯示中文技能名稱（如「火之牌」）與意境敘述。
  - 優化時間軸拖曳體驗：在拖曳滑桿時自動暫停背景 Live 播放迴圈，以 60fps 順暢更新即時戰況靜態預覽，放開時再平滑銜接播放，徹底根除拖曳期間並行迴圈競爭的問題。

## [7.5.2] - 2026-10-17

### Added
- **架構決策紀錄（ADR）**：建立 [`docs/DECISIONS.md`](DECISIONS.md) 記錄核心機制決策（ADR-001 ~ ADR-007），防止未來重複循環修改。
- **版本號使用者端可見性**：於舞台頂部控制列右側加入醒目而低調的版號標籤（`vX.Y.Z`），方便回報與確認版本。

### Fixed
- **同目標連續 Combo 位移中斷問題**（[PR #21](https://github.com/ck10800766/mdbattle-visualizer/pull/21) / ADR-001）：
  - 移除過度嚴格的 `skillId` 相等比較；同一攻擊者在同回合內對同一目標的連續攻擊（如迪盧克逆焰之刃三連擊 `diluc_onslaught_1/2/3`、牙紀反擊平砍、普攻連段），攻擊者維持在目標身前連續揮擊（`stayAtTarget = true`），不再於每一擊之間後撤回原位重新衝刺。
  - 嚴格限制僅在「切換 AOE」、「切換目標」或「遭遇非戰鬥停頓（劇情旁白、擲骰檢定、治療、召喚、幸運砸頭）」時才後撤回原位。
- **場景旁白角色黏滯問題**（[PR #21](https://github.com/ck10800766/mdbattle-visualizer/pull/21) / ADR-001）：
  - `combo.js` 前瞻邏輯偵測到旁白（`isSceneNarrationFrame`）或檢定時設定 `shouldReturnToOrigin = true`，使攻擊者即時後撤。
  - `stage.js` 旁白渲染時主動取消作戰單位的暫態位移動畫（除結婚持有者外），確保旁白播放期間全員必定回到標準陣型。

---

## [7.5.1] - 2026-10-17

### Added
- **召喚物進退場螢幕外緣滑動動畫**（[PR #21](https://github.com/ck10800766/mdbattle-visualizer/pull/21) / ADR-004）：
  - 左側我方召喚物自螢幕左外緣滑入、向左滑出退場。
  - 右側敵方召喚物自螢幕右外緣滑入、向右滑出退場。
  - 進退場動畫確保至少 650ms 展示時長，避免連續換人時產生原地閃爍錯覺。

### Fixed
- **通用召喚物語義退場解析**（[Issue #20](https://github.com/ck10800766/mdbattle-visualizer/issues/20) / [PR #21](https://github.com/ck10800766/mdbattle-visualizer/pull/21) / ADR-002）：
  - 解決克萊恩歷史投影（「輪廓一點一點淡去，散回了灰霧裡」）未被辨識導致留在戰場的幽靈召喚物 Bug。
  - 採用通用語義正則匹配消散、散回、解除、時間到期、撤退等動詞，禁止針對特定角色寫硬編碼偵測。
  - 攔截伺服器預載退場文本，防止誤觸發虛假召喚登場。

---

## [7.5.0] - 2026-10-17

### Added
- **常駐 Buff/Debuff 狀態列與頭像光暈**（[PR #19](https://github.com/ck10800766/mdbattle-visualizer/pull/19)）：
  - 於角色頭像外側（左側角色靠頭像左方、右側角色靠頭像右方）新增 `.status-tray` 狀態欄，展示 Buff / Debuff 徽章並帶有發光效果。
  - 多個狀態同時存在時，頭像外框緩慢循環交替閃爍對應色光。
- **護盾狀態視覺化**（[PR #19](https://github.com/ck10800766/mdbattle-visualizer/pull/19)）：
  - 解析護盾持續區間，卡片邊框於護盾期間自動發出水藍色光暈（`shield-active`）。
- **點擊戰鬥日誌行跳轉幀數**（[PR #18](https://github.com/ck10800766/mdbattle-visualizer/pull/18)）：
  - 點擊底部日誌面板任一行（`data-frame-index`），劇場立即瞬移跳轉至該幀播放。
- **場景旁白與台詞氣泡加強**（[PR #17](https://github.com/ck10800766/mdbattle-visualizer/pull/17)）：
  - 新增全螢幕半透明場景旁白橫幅與準確的對話講者歸屬。
- **角色技能設定設定檔解耦**（[PR #16](https://github.com/ck10800766/mdbattle-visualizer/pull/16)）：
  - 於 `profiles.js` 抽象化技能設定與匹配器，支援陣列、正則與自訂匹配函數。

---

## [7.4.2] - 2026-10-16

### Added
- **時間軸關鍵事件懸浮標記（Timeline Pins）**（[PR #12](https://github.com/ck10800766/mdbattle-visualizer/pull/12)）：
  - 進度條上方自動生成 `🔥 二階段甦醒`、`💀 角色陣亡`、`🌟 奧義發動`、`💍 契約締結` 標記點，滑鼠懸停顯示預覽，點擊直達該幀。
- **全鍵盤快捷鍵支援**（[PR #12](https://github.com/ck10800766/mdbattle-visualizer/pull/12)）：
  - `Space`（播放/暫停）、`←/→`（單步）、`Shift+←/→` 或 `↑/↓`（回合）、`1/2/3/4`（倍速）、`S`（跳過）、`E`（匯出）、`O`（載入）、`Esc`（關閉）。
- **戰報 JSON 匯出與離線載入重播**（[PR #12](https://github.com/ck10800766/mdbattle-visualizer/pull/12)）：
  - 支援一鍵匯出 `.json` 戰報（自動內聯補充 Max HP），支援本地檔案選擇與拖放（Drag-and-Drop）載入。
- **GitHub Actions CI/CD**（[PR #13](https://github.com/ck10800766/mdbattle-visualizer/pull/13)）：
  - 新增 `.github/workflows/ci.yml`，每次 Push / PR 自動驗證黃金快照與打包產物一致性。

---

## [7.4.1] - 2026-10-16

### Added
- **倍速記憶持久化**：支援 `0.5x`、`1x`、`2x`、`4x`，設定儲存於 `localStorage`。
- **AOE 扇形波次與齊射排版**：合併連續多目標打擊為流暢 AOE 演出。
- **牙紀專屬演出**（[PR #7](https://github.com/ck10800766/mdbattle-visualizer/pull/7)）：
  - SAO 結婚申請契約 Cut-in、婚紗護衛擋刀（3 人站位演出）、聖母聖詠 11 劍十字刻印與貫穿、心虛抓領搖晃、絕劍連勝徽章。
- **木之本櫻 & 源氏專屬演出**（[PR #9](https://github.com/ck10800766/mdbattle-visualizer/pull/9)）：
  - 小櫻牌轉換與護盾、源氏手裏劍、神龍拔刀與綠影疾影襲。

---

## [7.4.0] - 2026-10-15

### Added
- **模組化重構基準版**：
  - 將早期單檔重構為 16+ 原生 ES Modules（`src/*.js`）。
  - 引進無頭黃金快照測試系統（`scripts/snapshot-runner.mjs`）與 `esbuild` 打包流程。
  - 實作防劇透遮罩（`spoilerGuard.js`）與多錨點 HP 校正器（`calibrator.js`）。

