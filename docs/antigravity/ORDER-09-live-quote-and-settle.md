# Order 9: Live 1Click quote + live MPC settlement

## Context (verified 2026-11-07 ~19:00 ET by Janine)

- LicenseRegistry is DEPLOYED on Base mainnet (chain 8453) at
  `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`
  Deploy tx: `0xf2769b808992a69969a5909e1b5359cfc375a6400092e546845b2639695d4065`
  Basescan: https://basescan.org/address/0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00
  Constructor arg (immutable relayer): `0x4D538abf011e0885a6f87667Db466837B10b49f9`
  (NEAR `stanza_glenride.near`, path `ethereum-1`, mainnet `v1.signer`). Verified live:
  runtime code present, `relayer()` returns the MPC address.
- Funding: deployer `0xc09ae916febb1d51de1a6eb5f4353ae48c348f84` received 0.00132853 ETH;
  0.0005 ETH forwarded to the relayer; deploy cost ~0.0000048 ETH. Deployer balance
  now ~0.00082357 ETH, relayer 0.0005 ETH.
- `ONECLICK_JWT` is PRESENT in the iMac app `.env` (verified presence only, never
  read or printed). The live 1Click key gate is closed.
- `ONECLICK_API_URL` was stale (`https://api.near-intents.org`, dead) and is now
  `https://1click.chaindefuser.com` in `.env` (fixed by Janine; verified live:
  `POST /v0/quote` with bad params returns 400, i.e. the route exists).
- `LICENSE_REGISTRY_ADDRESS` is currently `stub` in `.env`. Janine set it to the
  deployed address, saw 3 test failures, and reverted it to `stub` — the failures
  turned out to be the 1Click quote payload (below), NOT the registry address.
  This order sets it to the deployed address as its final step.
- Test suite right now: **14 passed, 0 failed** (verified 2026-11-07 ~19:15 ET).
  Janine fixed the quote leg directly (commits `83d8240`, `a246670`, `b33703e`,
  `2fc3d17`, `c0dd25d`): required 1Click fields, live `nep141` asset IDs from
  `/v0/tokens`, EVM-origin deposits with valid addresses, and normalization of
  the live quote/status responses into the flat shape the jobs expect. The live
  quote returns a real deposit address; the live status returns
  `PENDING_DEPOSIT` for an unpaid quote. The job-chain test runs on the stub
  service by design (a live quote has no deposit, so WatchSettlement would
  requeue forever) — live quote coverage is the direct service test.
- Task 1 below is DONE. What remains is Task 2 (live MPC settle), Task 3, and
  the report. **Known limitation (flagged, not fixed):** a NEAR-origin deposit
  cannot be quoted — the job refunds to the EVM buyer address, and the live API
  only accepts a NEAR refund address for a NEAR origin. The demo pays from an
  EVM chain, so this does not block Monday; it needs a checkout change (collect
  the buyer's NEAR account) before NEAR-origin purchases are offered.

## Task 1 — Fix the 1Click quote payload to the current API — DONE (Janine, 2026-11-07)

Verified 14/14 green. Do not redo it; if a quote regresses, the fix history is
commits `83d8240`, `a246670`, `b33703e`, `2fc3d17`, `c0dd25d`.

## Task 2 — Implement the live MPC settlement path

`app/Services/MpcSettlementService.php::settleOnBase` currently THROWS for the
live path (`'Live MPC settlement requires NEAR credentials and deployed registry
address.'`, line ~125). The stub path is fine and must keep working when the
registry address is `stub` or empty.

Implement the production path, no stubs, no simulated hashes:

1. Build the unsigned EIP-1559 `recordLicense(buyer, workId, tier, proofHash)`
   transaction for the deployed registry (use the existing
   `encodeRecordLicenseCall`; selector `0x5c2b9e85`).
2. Hash the payload (keccak256 of the EIP-1559 signing payload) and call the
   NEAR Chain Signatures contract `sign` (`v1.signer`, mainnet). Verified
   2026-11-07 against the contract API: `sign(request)` takes
   `{payload: [u8; 32], path: String, key_version: u32}` — path `ethereum-1`,
   `key_version: 0` (currently the only valid version) — and returns
   `{big_r, s, recovery_id}`. A small per-signature deposit is required (fee
   varies with load; query the live `experimantal_signature_deposit()` view —
   do not hardcode the fee). Attach ~300 TGas. The caller's NEAR account pays
   gas + deposit, so the account needs a NEAR balance for both.
3. Assemble the signed transaction (r from `big_r`, s from `s`, `recovery_id`
   as the EIP-1559 `yParity`) and relay it to Base (chain 8453).
4. Wait for the receipt, verify the `LicenseRecorded` event, return
   `txHash` / `blockNumber` / `relayedViaMpc: true` / `isStub: false`.

NEAR credentials: use the app's NEAR account (`stanza_glenride.near`) and
whatever function-call key the app already has configured. **Inventory as of
2026-11-07 (Janine): there is NO signing key on file.** `.env` has
`NEAR_ACCOUNT_ID` but its value is EMPTY; there is no `NEAR_PRIVATE_KEY` (or
any signer/function-call key), no `~/.near-credentials` on the iMac, no NEAR
package in `composer.json`, and no signing code anywhere in the app. PHP on the
iMac has `sodium` (ed25519) and `bcmath` available, `gmp` is not installed.
Check `.env` for what is present; NEVER print a key or seed. **If the signing
key the MPC call needs is missing, STOP and report exactly which credential is
missing and the exact steps for D'Vaughn to create it** (a function-call key
for `stanza_glenride.near`, made from his seed phrase, which is on paper
offline) — do not stub around it and do not invent one.

## Task 3 — Go live in config and verify

1. Set `LICENSE_REGISTRY_ADDRESS=0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`
   in the iMac app `.env` (replace the `stub` line; do not touch any other line).
2. Run `php artisan config:clear`, then the FULL test suite: it must be
   **14 passed, 0 failed**. A live quote must return a real `depositAddress`
   and `quoteId` (not a stub).
3. Verify `isSettledOnChain` reads live against the deployed contract.
4. `git status` must show no application-code change you did not intend; do not
   touch the catalog, the seeder, or the contract (it is already deployed).

## Task 4 — Report back

Report: test output, the live quote's `quoteId` + `depositAddress` (deposit
addresses are public; never print keys), the registry address now configured,
and anything still blocked. Do NOT run a live paid purchase — that costs real
money and is D'Vaughn's call, not this order's.

## Hard rules

- If a step fails, stop and report. Do not change application code to make a
  failing test pass by weakening it, and do not stub a live path.
- Never print secrets (JWT, keys, seeds). Never commit `.env`.
- The contract is deployed; do not redeploy it.
