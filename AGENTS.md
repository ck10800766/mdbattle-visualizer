# Repository Development Guidelines & Git Workflow Rules

## 1. Git Workflow & Branching Discipline
- **NEVER commit directly to the `main` branch.**
- All new features, enhancements, and bug fixes MUST be implemented on a dedicated feature or bugfix branch:
  - Feature branches: `feat/<feature-name>` (e.g., `feat/cinematics-timing-and-timeline-preview`)
  - Bugfix branches: `fix/<bug-name>` (e.g., `fix/summon-universal-despawn`)
- Before pushing:
  1. Bump the version in `package.json` and `src/constants.js` (`APP_VERSION`).
  2. Document changes under the new version header in `docs/CHANGELOG.md`.
  3. Run `npm run build` to generate synchronized `dist/` distribution artifacts.
  4. Run `npm run check` to verify all regression snapshot tests pass with 0 failures and clean `dist/` consistency.
- Push the feature branch to `origin` (`git push origin <branch-name>`) for review and PR merging into `main`.
- **Do NOT push directly to `origin/main`** unless explicitly confirmed by the user.

## 2. Test Verification & Snapshot Integrity
- Every parser, calibrator, timeline, combo, or cinematics modification MUST pass `npm run check`.
- Snapshot tests verify deterministic headless simulation stability across all milestone battle fixtures. Do not modify snapshot expectations unless intentionally updating engine specifications.

## 3. Preservation of Existing Features
- Maintain documentation integrity.
- Never remove or break previously delivered functionality (e.g. fallen corpses remaining on stage, multi-phase revivals, ATB timeline, marriage bond visualizer, status tray orbs, strict combo damage tracking).
