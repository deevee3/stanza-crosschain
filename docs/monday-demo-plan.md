# Demo Plan (Pre-Submission — Due Sat Nov 14, 6:59 PM EST)

Target: record before submission deadline (Sat Nov 14, 6:59 PM EST, one-shot) against the live production site `https://crosschain.spinwave.tech`.

## Current Live Status on `main`

- **Live Production URL:** `https://crosschain.spinwave.tech`
- **Catalog & Scholar:** 3/3 manuscripts by D'Vaughn House (scholar address `0x2c432c901d5844431b027dd652fbfd3cc3dd6094`), all registered on-chain on Base mainnet via `scripts/mpc-register.cjs`:
  - Work 4: [`0x783e48b5…`](https://basescan.org/tx/0x783e48b56ddfdc271b3933683639bc4a973cbc5017d2d7bdf5788b672b27a9aa) (block `56560780`)
  - Work 5: [`0xa2c1b99a…`](https://basescan.org/tx/0xa2c1b99a3478f742213c742491262fe98b8eb6df508e5455a6a3101c639960a3) (block `56561967`)
  - Work 6: [`0xb2f8f424…`](https://basescan.org/tx/0xb2f8f42403bb714541a36a119897d99603366afa0a29d96555ba97ad426a8c79) (block `56562192`)
- **Four License Tiers:** **Read \$1.00 / Citation \$25.00 / Commercial \$150.00 / Exclusive \$500.00**.
- **On-Chain Registry & MPC Authority:** `LicenseRegistry.sol` deployed on Base mainnet at `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00` with immutable `relayer` `0x4D538abf011e0885a6f87667Db466837B10b49f9` (derived from NEAR `stanza_glenride.near` + `v1.signer` path `ethereum-1`; zero EVM private keys on the server).
- **End-to-End Settlement Proven on Base Mainnet (License #17):**
  - License #17 settled live on Base mainnet via NEAR Chain Signatures MPC (`v1.signer`, path `ethereum-1`): tx [`0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22`](https://basescan.org/tx/0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22) (block `56562938`, status `1`, `LicenseRecorded` + `ScholarCredited` events verified on BaseScan).
  - All 4 chains return live 1Click quotes; a **\$1.00 Read-tier** crypto purchase on Base is ready for the live recording when D'Vaughn chooses to run it.
- **Multi-Chain Checkout ("Pay From" Picker) + PayPal Slice:**
  - **Pay From picker:** **Base**, **NEAR**, **Solana**, **Arbitrum** (plus **PayPal Sandbox** toggle on the same checkout page).
  - **Base:** One-tap wallet checkout (`Connect Wallet` → `Buy` → `Pay` via `viem` + `window.ethereum` on Base chain `8453`).
  - **NEAR, Solana, Arbitrum:** Clicking `Get Deposit Address` requests a live 1Click quote and displays a deposit address with the exact quoted amount in the origin asset and a quote deadline.
  - **Refund-address rules:** NEAR requires an existing NEAR account (`you.near`), Solana requires a Solana address, and EVM chains (Base, Arbitrum) default the refund address to the buyer's EVM address.
  - **Dynamic Quotes:** Every quote refreshes live from NEAR Intents 1Click (`POST /v0/quote`) and returns the live `amountIn` and `deadline`.
- **Suite & Build Status on `main`:**
  - `php artisan test`: `79 passed, 2 failed (362 assertions)` out of `81` tests when `.env` has a live `ONECLICK_JWT` (the 2 failures in `ChainPickerTest` occur because `RequestLicenseQuote::handle($mock)` synchronously dispatches `WatchSettlement`, which resolves the container's live `OneClickService` against `0xfakedeposit`; `81/81` pass (`365` assertions) when `ONECLICK_JWT` is unset).
  - `forge test`: `4 passed, 0 failed, 0 skipped` (`LicenseRegistryTest`).
  - `npm run build`: clean (`1406` modules transformed).

## Demo Video Script (~2.5 min, screen recording)

- **Beat 1 (0:00–0:20) — What it is.** Open `https://crosschain.spinwave.tech`. "License It From Anywhere (`stanza-crosschain`). Buy a verifiable on-chain license for a scholarly work from Base, NEAR, Solana, Arbitrum, or PayPal. Cross-chain payments settle as USDC on Base via NEAR Intents 1Click, and the license is recorded on Base by NEAR Chain Signatures MPC — with no EVM private key anywhere on the server."
- **Beat 2 (0:20–0:55) — Manuscript, Four Tiers, and Chain Picker.** Show the three registered manuscripts by D'Vaughn House and the four license tiers (**Read \$1.00 / Citation \$25.00 / Commercial \$150.00 / Exclusive \$500.00**). Show the **Pay From** chain picker (**Base**, **NEAR**, **Solana**, **Arbitrum**) and how the refund-address rules adapt: NEAR prompts for an existing NEAR account (`you.near`), Solana prompts for a Solana address, and EVM chains (Base, Arbitrum) default the refund address to the buyer's EVM address. Connect wallet on Base (`8453`) so the Buyer EVM Address auto-fills and locks.
- **Beat 3 (0:55–1:35) — Quote & Payment Flow (One-Tap Base vs Cross-Chain Deposit Address).**
  - On **NEAR / Solana / Arbitrum**, clicking **Get Deposit Address** returns a live 1Click deposit address with the exact quoted amount in the origin asset and a quote deadline.
  - On **Base**, select the **\$1.00 Read** tier and click **Buy** (`POST /api/quote`, polled via `GET /api/licenses/{id}`). Show the live 1Click quote returning `QUOTED` status with the live quoted USDC amount and deadline. Click **Pay** for one-tap ERC-20 `transfer(depositAddress, amountIn)` confirmation on Base USDC (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
- **Beat 4 (1:35–2:10) — Proven NEAR MPC Settlement on BaseScan.** Show the settled license (License #17) and open BaseScan for settlement transaction `0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22` on `LicenseRegistry` (`0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`, block `56562938`). Highlight the relayer address `0x4D538abf011e0885a6f87667Db466837B10b49f9` (signed via NEAR `v1.signer` on `stanza_glenride.near`, path `ethereum-1` after 4-gate pre-signing verification) and the emitted `LicenseRecorded` and `ScholarCredited` events.
- **Beat 5 (2:10–2:30) — Verify, Signed Upload, & Scholar Portfolio.** Open `https://crosschain.spinwave.tech/lookup` (verify License #17 by deposit/proof/settlement hash) and `https://crosschain.spinwave.tech/scholar/0x2c432c901d5844431b027dd652fbfd3cc3dd6094` (scholar portfolio + EIP-191 wallet-signed manuscript publishing). Closing line: "The scholar gets paid in USDC. The license is verified on Base. The signature authority is NEAR MPC, not a server hot wallet."

## X Post (Draft — Do Not Post Until Demo Is Recorded)

> License It From Anywhere is live at crosschain.spinwave.tech.
>
> License scholarly works across 4 tiers (\$1 / \$25 / \$150 / \$500) from Base, NEAR, Solana, Arbitrum, or PayPal: NEAR Intents 1Click settles USDC on Base, and NEAR Chain Signatures MPC records the license on-chain — zero server EVM private keys.
>
> Proven Base settlement tx: basescan.org/tx/0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22
> Contract: basescan.org/address/0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00
>
> Demo video coming next.

## Submission Payload (Draft)

- **Project:** License It From Anywhere (`stanza-crosschain`)
- **Live URL:** https://crosschain.spinwave.tech
- **One-liner:** Cross-chain scholarly licensing platform (Base, NEAR, Solana, Arbitrum + PayPal across \$1 / \$25 / \$150 / \$500 tiers) where NEAR Intents 1Click settles USDC on Base and NEAR Chain Signatures MPC records the license on-chain.
- **Repo:** https://github.com/deevee3/stanza-crosschain
- **Contract (Base mainnet):**
  `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`
- **Relayer (MPC, NEAR `stanza_glenride.near` path `ethereum-1`):**
  `0x4D538abf011e0885a6f87667Db466837B10b49f9`
- **Proven Settlement Tx (Base mainnet, License #17):**
  `0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22`
- **Demo video:** [link goes here after recording]
- **Team:** D'Vaughn House (Glenride)
- **NEAR features used:** 1Click (`POST /v0/quote`, `GET /v0/status`) and Chain Signatures MPC (`v1.signer`, `sign`, path `ethereum-1`).
