# Mandarin — notes for Claude

- Owner's app: Scheduler & Work, split from Citrus Maxima (Amaerys/citrus-maxima) on 16/11/2026. Plain English in the UI, dates dd/mm/yyyy, metric.
- One data owner per kind: rotas, corrections, nurse postings, shift log, career → Mandarin. Contact cards → Clementine (read-only copy in `directory.js`). Goals and planning → Citrus. Never write into another app's Drive folder.
- Drive contract: `HUB.md` in the Citrus repo. Mandarin writes `My Apps/hub/mandarin/{state,status,shifts}.json` and `backups/`.
- Before every deploy: `bash test/all.sh` must pass, then `sh scripts-bump.sh` (service worker module list and cache name).
- Never commit real names, phone numbers, staff IDs or salaries: `test/data/` is git-ignored, tests pick "me" from the real file at run time.
- Real-data browser tests pin the clock (`page.clock.install`).
- Keep `tools/check-imports.mjs` green: every named import and `X.name` use must exist.
- Add seminal upgrades to the App Building Master Log (skill: app-master-log).
