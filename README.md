[![make.fun bounty](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/3215242167-create/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/3215242167-create/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar

A token launch radar for make.fun's [Build the best token launch radar](https://make.fun/bounty/token-radar-01) bounty ($1,325 in USDC). It reads one sealed snapshot of the protocol universe (758 protocols, DefiLlama data as of 2026-11-14) and ranks the protocols that still have no token by the valuation a comparables model implies they would launch at.

## The board

198 rows: all 40 protocols on the snapshot's watchlist, plus 158 early finds below the watchlist's $50M TVL floor. Every row passes one product rule, the watchlist's own: the protocol records no token, and it is not a wrapped, staked, bridged or versioned product of a token that already trades (categories Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX are out, as are version-marker names, names with the whole word wrapped/staked/staking, and exchange-prefixed names). That rule is why WBTC and USDT0 are not on the board even though they record no token of their own.

## The model

Fitted by the program on the snapshot itself, every run: a ridge regression of log market cap on log TVL, 7-day TVL growth (clamped), log listing age and log chain count, over the 128 traded protocols that record both a market cap and a TVL, plus one shrunken offset per category family. Two guardrails bound the growth factor to ×0.50–2.01 and the age factor to ×0.55–1.82, so no single week or birthday can dominate a price. Each row's implied value is printed as TVL × base multiple × growth factor × age factor, recomputed from the row itself.

Backtest, leave-one-out over the 128 traded protocols (the whole pipeline refit for each held-out protocol): **median factor error ×3.86, 41% of held-out market caps within ×3**, against ×5.09 median for the naive one-median-multiple baseline. The dashboard states these numbers next to the model, and every row carries a concrete six-step farm plan with costs and times derived from the protocol's own category, chain, size and age.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Node 22+, standard library only, no network. Reads `snapshot.json`, writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json`. Deterministic: two runs on the same snapshot write the same bytes. The dashboard is static and offline — open `out/dashboard/index.html` after copying `out/data.js` beside it (the page loads `../data.js`).
