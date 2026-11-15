# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/zeinrefo-code/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/zeinrefo-code/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar: every protocol that records no token in the sealed DefiLlama snapshot — all 40 watchlist protocols and the rest of the pre-token universe that is not a wrapped, staked or exchange product — ranked by what a launch would be worth. Each protocol is priced at the multiple its own category's live tokens actually trade at (median market cap / TVL, winsorised and shrunk toward the global median), adjusted for seven-day growth and time without a token. The static dashboard shows the board, the calibration table, a live-token comparison set, a detail view per protocol with the full arithmetic, and a concrete farm plan with costs and times. Node 22, standard library only, fully deterministic.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```
