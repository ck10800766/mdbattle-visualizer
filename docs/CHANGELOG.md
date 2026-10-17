# Changelog

本文件依版本號記錄 `mdbattle-visualizer` 的所有更新歷程、功能交付與 Bug 修復。

格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.0.0/)，版本編號遵循 [Semantic Versioning](https://semver.org/lang/zh-TW/)。

---

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

