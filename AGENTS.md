# Repository Development Guidelines & Git Workflow Rules

## 1. Git Workflow & Branching Discipline
- **NEVER commit directly to the `main` branch.**
- **New Task Initiation Protocol**:
  - Before starting any new task or feature, ALWAYS verify that the previous Pull Request on GitHub has been merged into `main`.
  - Switch back to `main` (`git checkout main`) and pull the latest upstream commits (`git pull`).
  - Create a fresh dedicated feature or bugfix branch branched from the synced `main`:
    - Feature branches: `feat/<feature-name>` (e.g., `feat/cinematics-timing-and-timeline-preview`)
    - Bugfix branches: `fix/<bug-name>` (e.g., `fix/summon-structural-despawn-and-cutin-speech`)
- **Pre-Push Protocol & User Confirmation**:
  1. Bump the version in `package.json` and `src/constants.js` (`APP_VERSION`).
  2. Document changes under the new version header in `docs/CHANGELOG.md`.
  3. Run `npm run build` to generate synchronized `dist/` distribution artifacts.
  4. Run `npm run check` to verify all regression snapshot tests pass with 0 failures and clean `dist/` consistency.
  5. **ALWAYS ASK THE USER FOR PERMISSION BEFORE PUSHING TO ORIGIN.** Do NOT run `git push` autonomously without explicit user confirmation.
- **NEVER push directly to `origin/main`** unless explicitly confirmed by the user.

## 2. Universal Structural Heuristics Over Regular Expressions
- Do NOT add endless hardcoded regex keywords or specific vocabulary whitelists (e.g. 不要為了特例在正則中隨意堆砌「吊離/撤離/帶離」等字眼).
- Rely on general structural invariants (e.g. 召喚物離場：登場後提及名字且後續在戰鬥中不再有任何互動；大招名稱提取：動詞變量後帶空格；多階段甦醒：死亡後重啟戰鬥互動).

## 3. Test Verification & Snapshot Integrity
- Every parser, calibrator, timeline, combo, or cinematics modification MUST pass `npm run check`.
- Snapshot tests verify deterministic headless simulation stability across all milestone battle fixtures. Do not modify snapshot expectations unless intentionally updating engine specifications.

## 4. Preservation of Existing Features & Choreography Standards
- Maintain documentation integrity.
- Never remove or break previously delivered functionality (e.g. fallen corpses remaining on stage, multi-phase revivals, ATB timeline, marriage bond visualizer, status tray orbs, strict combo damage tracking).
- Combatants must cleanly return to origin before delivering dialogue or during scene narration (characters must NEVER stick to or speak right on top of enemies).
- Summon entrances and departures must smoothly slide to/from the outer edge of the screen (`50vw+`), not vanish mid-screen.
