# Champions Pubquiz

Live pubquiz for the *Dinner of Champions* Christmas party (Friday 11 December 2026).
The quiz master runs the beamer from a laptop; five teams answer on one phone each.

## Addresses

| Who | Address |
|---|---|
| Teams (in the QR code) | `https://peetbos2003-sudo.github.io/champions-quiz/` |
| Quiz master: choose screen | `…/champions-quiz/#host` |
| Beamer | `…/champions-quiz/#beamer` |
| Remote | `…/champions-quiz/#remote` |

The quiz master pages ask for the host PIN once; the device remembers it.

## One-time setup

1. **Database:** in Supabase, open *SQL Editor*, paste the whole of `setup.sql`, click *Run*.
2. **Host PIN:** in the same SQL Editor, run (with your own PIN, at least 8 characters):
   ```sql
   select private.set_host_pin('your-own-pin');
   ```
   Never put the PIN in this repository: it is public.
3. **Website:** on GitHub, *Settings → Pages → Branch: main, folder: / (root) → Save*.

## Questions

Load them from the remote (`#remote`): paste a JSON list and click *Vragen opslaan*.
Questions and answers are stored in the private part of the database, not in this repository.

```json
[
  {"round": "Ronde 1", "type": "mc", "nl": "Vraag?", "en": "Question?",
   "options": [{"nl": "A", "en": "A"}, {"nl": "B"}, {"nl": "C"}, {"nl": "D"}],
   "answer": 1, "points": 1, "seconds": 30},
  {"round": "Ronde 1", "type": "open", "nl": "…", "answer": "Rudolph", "accept": ["Rudolf"]},
  {"round": "Ronde 2", "type": "estimate", "nl": "…", "answer": 8849, "unit": "m", "points": 2, "seconds": 40}
]
```

- `type`: `mc` (multiple choice, `answer` = option number starting at 0), `open` (typed answer; exact matches score automatically, the quiz master can mark others right or wrong), `estimate` (closest wins).
- Correct answer = `points`; the fastest correct team gets +1 extra (not on estimates).
- A new `round` name triggers the standings screen before the round starts.

## Before the party

Supabase pauses free projects after about a week without use. Do the dry run in the week before
11 December, and open the dashboard once on the day itself to make sure the project is awake.
