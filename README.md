# Mandarin — Scheduler & Work

The work app of the citrus family, split out of Citrus Maxima on 16/11/2026. Mandarin owns everything that comes from the rotas:

- **Today** — the shift you are on (or the next one) with a 24-hour dial, who is in hour by hour, your team and nurses, the morning briefing, Tonight (when to sleep for the next shift), the after-shift log, tomorrow's team the evening before, proposals from Claude, contract and licence dates.
- **Calendar** — the month with every day open as a day sheet: your shift, who shares it, all sites with the rota's planned staffing, on call, leave, corrections (swap, cover, cancel, leave) and the shift log. Export your shifts as `.ics`.
- **Team** — everyone in your schedules (GP, FSED and village specialists, nurses), the roster grid, who you work with most and when next, favourite colleagues.
- **Nurses** — the posting board (confirmed, heard, guessed), paste a leader's message, pulled-out nurses, staffing per site.
- **Month** — the month report, the Saudi labour-law check, leave planning, every swap and cover with who owes whom, the shift log in numbers.
- **Career** — jobs and contracts, end of service, payslips checked against the contract and the rota's overtime, licences and CME, offers weighed against your past jobs, a printable CV.

## How it fits with the other apps

One Google Drive tree for every app (see `HUB.md` in Citrus). Mandarin writes only `My Apps/hub/mandarin/`:

| File | For | What is in it |
|---|---|---|
| `state.json` | Mandarin on your other devices | everything Mandarin keeps (merged per record, newest edit wins) |
| `status.json` | Citrus (contract v2) | one-line summary, today / next, week hours, nights, pending items, deep links |
| `shifts.json` | Citrus, Clementine, Calamansi | your days from a week back to six weeks ahead, the roster by rota key, the shift legend |
| `backups/state-YYYY-MM-DD.json` | you | one copy a day, newest 14 |

Rota files live in `My Apps/Rotas/` (Mandarin imports, names and uploads them). Mandarin **reads** only: `hub/citrus/state.json` (once, to bring the work over; and for read-only contact cards until Clementine exists), `hub/citrus/plan.json` (blocks for the dial), `hub/claude/status.json` (proposals: posting, swap, nurse). Contact cards belong to Clementine; goals and planning belong to Citrus.

Deep links: `…/Mandarin/?from=citrus&do=today|calendar|nurses|team|month|career|log|leave|pay|licences`. Shared `.xlsx` files from WhatsApp arrive through the Web Share Target; a shared posting message opens Paste postings.

## Development

Vanilla ES modules in `docs/`, no build step; GitHub Pages serves `/docs` from `main`.

```
bash test/all.sh      # every test; deploy only when it passes
sh scripts-bump.sh    # before each deploy: module list and cache name in the service worker
```

Browser tests use Playwright and an in-memory Google (`test/fake-google.mjs`). Tests that need the real rota files read `test/data/*.xlsx`, which is git-ignored and never committed; they skip themselves without it. No real names, phone numbers or pay in the repo.
