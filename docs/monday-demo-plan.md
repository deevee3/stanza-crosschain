# Demo Plan (Pre-Submission — Due Sat Nov 14, 6:59 PM EST)

Target: record before submission deadline (Sat Nov 14, 6:59 PM EST, one-shot).

## Current Live Status on `main`

- **LIVE:**
  - Catalog (3/3 manuscripts by D'Vaughn House, scholar address `0x2c432c901d5844431b027dd652fbfd3cc3dd6094`).
  - Live catalog tiers: **Read \$1.00 / Citation \$25.00 / Commercial \$150.00**.
  - `LicenseRegistry.sol` deployed on Base mainnet at `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00` with immutable `relayer` `0x4D538abf011e0885a6f87667Db466837B10b49f9`.
  - Live 1Click quotes (`14/14` PHPUnit tests + `4/4` Foundry tests green, real Base deposit addresses and exact USDC `amountIn` returned).
  - Seamless 1-tap wallet checkout (`Connect Wallet` → `Buy` → `Pay` via `viem` + `window.ethereum` on Base chain 8453).
  - Live MPC settlement code (`app/Services/MpcSettlementService.php` + `scripts/mpc-settle.cjs`) committed on `main` and NEAR access key registered on `stanza_glenride.near` for `v1.signer`.
- **SETTLE LEG STATUS (Honest Disclosure):**
  - The MPC settlement path is wired and verified in dry-run (`--dry-run` builds the Base EIP-1559 signing hash cleanly), **but no live settlement transaction has landed on Base mainnet yet (MPC relayer `0x4D538abf011e0885a6f87667Db466837B10b49f9` nonce is still `0`)**.
  - Note: calling `v1.signer::sign` on NEAR mainnet requires attaching `1 yoctoNEAR`, which NEAR runtime only permits with a `FullAccess` key (not a `FunctionCall` access key). If recording before a live settle is run, show Beats 1–3 live (`Connect Wallet` → `Buy` → `Pay` quote & wallet transfer prompt) and state plainly that the MPC settlement leg is wired with relayer nonce `0` — never fake a settlement.
- **Live Purchase Parameter:**
  - A **\$1.00 Read-tier** license (`~1.012526 USDC` on Base `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), paid via connected MetaMask or Coinbase Wallet. D'Vaughn's call when to execute a live paid purchase.

## Demo Video Script (~2.5 min, screen recording)

- **Beat 1 (0:00–0:20) — What it is.** "License It From Anywhere (`stanza-crosschain`). Buy a license for a scholarly work on-chain. The payment settles as USDC on Base via NEAR Intents 1Click, and the license is recorded on Base by NEAR Chain Signatures MPC — no EVM private key anywhere on the server."
- **Beat 2 (0:20–0:50) — Connect Wallet & Select Manuscript.** Open `http://127.0.0.1:8005/` (`/` or `/checkout`). Click **Connect Wallet** (MetaMask / Coinbase Wallet on Base 8453) — the Buyer EVM Address auto-fills and locks. Show the three manuscripts by D'Vaughn House. Select the Quadratic Funding replication and the **\$1.00 Read** tier.
- **Beat 3 (0:50–1:30) — One-Tap Buy & Pay.** Click **Buy** (`POST /api/quote`, polled via `GET /api/licenses/{id}`). Show the live 1Click quote returning `QUOTED` status and the exact USDC amount (`~1.012526 USDC`, with the manual deposit address visible underneath only as a small fallback line). Click **Pay** — the wallet opens a single ERC-20 `transfer(depositAddress, amountIn)` confirmation on Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
- **Beat 4 (1:30–2:10) — Settlement.** Show the 4-gate pre-signing verification and the NEAR MPC settlement path (`v1.signer`, path `ethereum-1`) relaying `recordLicense(buyer, workId, tier, proofHash)` to Base `LicenseRegistry` (`0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`) and verifying the `LicenseRecorded` event. (If no live settlement has been broadcast yet, show the `--dry-run` signing hash output and state plainly that relayer nonce is still `0`.)
- **Beat 5 (2:10–2:30) — Verify & Scholar Portfolio.** Open `/lookup` (lookup by deposit/proof/settlement hash) and `/scholar/0x2c432c901d5844431b027dd652fbfd3cc3dd6094` (scholar portfolio). Closing line: "The scholar gets paid in USDC. The license is verified on Base. The signature authority is NEAR MPC, not a server hot wallet."

## X Post (Draft — Do Not Post Until Demo Is Recorded)

> License It From Anywhere is live on Base.
>
> License scholarly works with one-tap checkout: NEAR Intents 1Click settles USDC on Base, and NEAR Chain Signatures MPC records the license — no server EVM private key.
>
> Contract: basescan.org/address/0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00
>
> Demo video coming next.

## Submission Payload (Draft)

- **Project:** License It From Anywhere (`stanza-crosschain`)
- **One-liner:** Autonomous scholarly licensing agent (crypto checkout + PayPal slice) where NEAR Intents 1Click settles USDC on Base and NEAR Chain Signatures MPC records the license on-chain.
- **Repo:** https://github.com/deevee3/stanza-crosschain
- **Contract (Base mainnet):**
  `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`
- **Relayer (MPC, NEAR `stanza_glenride.near` path `ethereum-1`):**
  `0x4D538abf011e0885a6f87667Db466837B10b49f9`
- **Demo video:** [link goes here after recording]
- **Team:** D'Vaughn House (Glenride)
- **NEAR features used:** 1Click (`POST /v0/quote`, `GET /v0/status`) and Chain Signatures MPC (`v1.signer`, `sign`, path `ethereum-1`).
