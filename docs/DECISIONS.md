# Architecture Decision Records (ADR) & Design Log

本文件記錄 `mdbattle-visualizer` 核心架構決策與邏輯演進歷史，避免未來維護或重構時發生「A 改 B、後來又改回 A」的循環修改。

---

## ADR-001: 連擊（Combo）身體定位與回原位規則 (Combo Positioning & Return-to-Origin)

### 背景 (Context)
早期版本中，`lookaheadComboState` 將「連擊數累計 (`isNextFrameSameCombo`)」與「角色是否回到原位 (`shouldReturnToOrigin`)」過度耦合且加入嚴格的 `skillId` 相等比較。這導致多段連招（如迪盧克逆焰之刃 `diluc_onslaught_1/2/3`、普通攻擊 `diluc_sword_1/2/3/4`）因後綴不同被誤判為「不同技能」，造成角色每一擊都跑回原點重新衝刺。
同時，先前的前瞻邏輯忽略了場景旁白（`isSceneNarrationFrame`）、擲骰檢定（`diceCheck`）與一般文本，導致角色在連擊途中遇到 1~2 秒的劇情旁白時，依舊維持在目標臉上（`stayAtTarget = true`），產生「角色黏在目標身上」的視覺 Bug。

### 決策 (Decision)
1. **核心原則：同回合、同目標且無中斷的連擊，角色一律停留在目標前連續攻擊，不回到原位。**
   - 只要同一攻擊者在同回合內連續對同一目標發動單體攻擊（無論是同技能多段 `_1/_2/_3` 還是連續普通攻擊），角色即在目標身前連續揮擊（`stayAtTarget = true`），直至連擊結束才瀟灑後撤。
2. **必須後撤回原位（`shouldReturnToOrigin = true`）的中斷條件：**
   - **切換為 AOE 技能**（`lookahead.isAOE`）：需回原位或移至舞台中央發動全場攻擊。
   - **切換攻擊目標**（`lookahead.targetId !== frame.targetId`）：需位移至新目標。
   - **非戰鬥停頓事件**：
     - 場景旁白橫幅（`isSceneNarrationFrame`）
     - 擲骰／占卜／幸運檢定（`diceCheck`、`占卜判定`）
     - 隊友或自身施法、治療（`HEAL`、`SP_RECOVER`）
     - 召喚登場（`SUMMON`）
     - 幸運掉落物砸頭（`LUCK_EVENT`，避免與目標重疊受傷）
     - 反擊推開／中斷（`COUNTER`）
3. **場景旁白安全防護**：
   - 於 `stage.js` 的 `isSceneNarrationFrame` 渲染時，主動清除所有作戰單位的暫態位移動畫（除結婚格擋持有外），確保旁白播放期間全員必定回到標準陣型。

---

## ADR-002: 通用召喚物退場語義解析 (Universal Semantic Summon Despawn)

### 背景 (Context)
先前的 `SUMMON_DESPAWN_REGEX` 只寫死了沉睡騎士的「揮了揮手，回到.+?的隊伍裡」與「離開了戰場」，遇到克萊恩的歷史投影（「輪廓一點一點淡去，散回了灰霧裡」）無法辨識，導致召喚物在退場後仍留在舞台上成為幽靈單位（GitHub Issue #20）。

### 決策 (Decision)
1. **禁止針對特定角色或技能寫硬編碼偵測**。
2. 改採**通用語義特徵正則**，涵蓋自然消散、時間結束、解召、返回等通用動詞：
   `/(?:淡去|散回|散去|消散|消逝|消失|退場|離場|脫離戰場|離開(?:了?戰場)?|離去|撤退|隱沒|揮了揮手，回到|回到.+?(?:隊伍|身邊|身旁|空間|法陣|歸處|冥界|灰霧|陰影|原處|手牌|卡組|召喚)|返回.+?(?:隊伍|身邊|身旁|空間|法陣|冥界|界)|化(?:作|為).*(?:白煙|青煙|黑煙|煙霧|塵埃|光點|虛無|泡影|灰燼)|時間(?:結束|已到|用盡|到了)|解除.*召喚|召喚.*解除|召喚結束)/`
3. **多欄位實體解析**：依序由 `log.actorId`（主動離場的召喚物）、`log.targetId`（被解召的目標召喚物）與在場召喚物名稱文本匹配，精確定位退場實體。
4. **防止退場文本觸發敘事登場**：若伺服器在副本結束時對未登場的預載實體發出退場日誌，`SUMMON_DESPAWN_REGEX` 會攔截敘事自動登場，避免產生虛假的「🌀 召喚登場」標記。

---

## ADR-003: 版本號管理與使用者端可見性 (Version Management & UI Visibility)

### 背景 (Context)
先前多個 PR 迭代皆未推進 `package.json` 中的版本號，導致 Tampermonkey / Violentmonkey 無法偵測到更新，使用者回報 Issue 時也無從得知實際運行的補丁版本。

### 決策 (Decision)
1. 每次功能或修復 PR 均需遵循語意化版本（SemVer）推進 `package.json` 與 `src/constants.js`（`APP_VERSION`）。
2. `build.mjs` 自動將完整版本注入 Userscript `@version` 標頭。
3. 在舞台控制列右側顯示醒目而低調的版號標籤（`vX.Y.Z`），讓使用者截圖或回報時能即時確認當前加載的確切版號。

---

## ADR-004: 召喚物邊緣進出場動畫 (Screen-Edge Summon Animations)

### 背景 (Context)
當舊召喚物退場後緊接著下一隻同名或同外觀召喚物進場時（例如克萊恩連續拉出「有紀的歷史投影」），原地的縮放淡入淡出容易讓使用者誤以為同一隻角色在閃爍。

### 決策 (Decision)
1. **左側我方召喚物**：自螢幕左側外緣（`translateX(-180px)`）帶淡藍光暈滑入戰場；退場時向左側邊緣滑出淡出。
2. **右側敵方召喚物**：自螢幕右側外緣（`translateX(180px)`）帶灰霧緋紅光暈滑入戰場；退場時向右側邊緣滑出淡出。
3. 確保召喚進退場影格給予至少 `650ms` 展示時長，使連續換人具備明確的「向外退場、自外入場」方向軌跡。
