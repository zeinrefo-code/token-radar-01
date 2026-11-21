# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zeinrefo-code/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zeinrefo-code/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar, model **radar-3**: every protocol that records no token in the sealed DefiLlama snapshot — all 40 watchlist protocols and the rest of the pre-token universe that is not a wrapped, staked or exchange product (197 rows) — ranked by what a launch would be worth. Earlier versions asserted a price (a flat multiple, then a category median). This one **fits** it, **tests the fit held-out twice**, and publishes the misses next to the board.

## The fitted model

The fit pool is the 95 protocols in the snapshot that record a market cap above zero and a listing date (a recorded zero is a dead token, not a price; a peer with no date cannot carry the age term). On that pool, log market cap is regressed by least squares on four terms the snapshot itself carries, plus a per-category adjustment — the category's mean residual, shrunk toward zero by 6 phantom peers and clamped to a quarter..four times (a category with no fit peers takes none). A protocol with no recorded date is scored at the pool's median age (1,000 days); the growth term is clamped to −60%..+30%, the range the live peers themselves span.

```
log value = 16.221 + 0.427 × (log TVL − 17.669) − 3.357 × growth − 0.896 × age + 0.238 × log(1 + chains) + log(category adjustment)
```

The fitted signs are the record's, not choices: value grows slower than TVL (size term below one, so big protocols price at lower multiples); the growth term is negative because market caps are sticky — a protocol whose TVL just spiked trades at a diluted multiple; the age term is negative because at equal TVL the peers' longer-listed protocols trade lower. The dashboard restates this fit in full (every coefficient, every category adjustment) and recomputes each row from it, checking the result against `board.json`.

## Held-out validation (computed on the sealed snapshot, not asserted)

The pool was split in two, twice, on two different deterministic splits; on each split the pipeline was fitted on one half and priced the other, in both directions. The previous model (radar-2: category median multiples with fixed growth and maturity terms) went through the same exercise on the same halves.

| Split | Halves | radar-3 median miss | radar-3 within 2× | radar-2 median miss | radar-2 within 2× |
| --- | --- | --- | --- | --- | --- |
| A | 45 / 50 | ×3.43 | 40% | ×4.45 | 28% |
| B | 44 / 51 | ×3.41 | 29% | ×3.96 | 28% |
| **Pooled** | 95 peers ×2 splits | **×3.57** | **35%** | **×4.26** | **28%** |

On the peers it was fitted on, radar-3's median miss is ×2.86. The honest reading, printed on the dashboard itself: this is a ranking with wide error bars, not a list of prices — but a fitted, tested model beats the asserted multiples it replaces on data neither model had seen.

## The rest of the board

- **The peers' record.** How often protocols like these record a token, by category and by TVL band (416 of 758 protocols in the snapshot record one; the share climbs from 229/439 under $50M TVL to 40/63 at $1B and up). Stated per protocol in its detail view as context — never as a forecast; the board prices what a launch would be worth *if* one came, and says a protocol "records no token", never that it has none.
- **Integrity strip.** Every row carries flags from its own record: a sharp 7-day move scored at the clamp, a missing 7-day figure, a missing listing date, no category, a single chain, or a category adjustment resting on fewer than three fit peers.
- **Costed farm verdicts.** Each protocol's farm plan (7–8 steps derived from its category, chains, TVL and age, each with a cost and a time) is totalled from its own steps — capital tied up plus gas burned, $52–$282 across the board — and given a verdict under one stated rule: a claim of $20M+ with at most one flag is a *Farm first*; $7.5M+ with at most two flags is a *Farm it*; $2.5M+ is a *Small farm only*; anything below, or any record with three or more flags, is a *Watch only*.
- **The dashboard** is a static page (no framework, no network): sortable and filterable board (search, category, verdict, watchlist-only), a live-token comparison set, the full fit with its validation tables, and a detail view per protocol with the term-by-term arithmetic, its record context, its flags, its verdict and plan cost, and its farm plan.

Node 22, standard library only, fully deterministic — two runs write identical bytes.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```
