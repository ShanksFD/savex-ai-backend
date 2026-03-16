# Changelog

All notable changes to this project will be documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Fixed

- `totalUsdRaised` in admin transaction stats now only aggregates `COMPLETED` and `CONFIRMED` transactions — previously included `FAILED` and other statuses
- `totalTokensSold` in admin transaction stats applies the same status filter as `totalUsdRaised`
- Sweep cron no longer loops indefinitely when gas topup is confirmed but the deposit wallet balance is still zero (drained wallet / wrong mnemonic). The sweep operation is now marked `FAILED` so the retry cap applies
- `totalTarget` in presale stage stats now returns the active stage's target instead of summing all 50 stages — fixes incorrect `$188M+` value and ensures the metric updates when a different stage is activated
- `getUserStats` (`GET /api/transactions/my-stats`) now includes admin-granted `addedAmount` in `totalTokens` — previously only summed tokens from completed transactions

### Changed

- `MIN_CONFIRMATIONS_SWEEP` is now configurable via env (default `1`). Previously hardcoded to `1` in both the gas topup confirmation check and the sweep tx confirmation check
