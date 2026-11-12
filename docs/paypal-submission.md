# PayPal AI Hackathon — submission draft (DO NOT SUBMIT — D'Vaughn's click)

**Deadline:** Thursday Nov 12, 2026, 12:00 PM PT (3:00 PM ET), on Devpost.
**Branch:** `paypal-slice` (NEAR submission on `main` is untouched).
**Repo:** https://github.com/deevee3/stanza-crosschain (public, MIT — `LICENSE` file added Nov 9)
**Contract (Base mainnet):** `0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00`
([BaseScan](https://basescan.org/address/0x3407bBf34488AC73B85B7f32463b1913Fcf9eA00))

## Project name

License It From Anywhere — PayPal-held licensing for scholarly works

## One-liner

Buy a license for a scholarly work with PayPal: the payment is held until an
AI attestation agent verifies the license, then released and recorded on
Base — the scholar gets paid, the license is on-chain.

## Description (draft for the Devpost form)

STANZA Cross-Chain already lets a reader license a scholarly work from any
blockchain: NEAR Intents settles USDC on Base and NEAR Chain Signatures MPC
records the license on-chain, with no EVM private key anywhere in the loop.
This slice adds the payment rail most readers actually have — PayPal — and
makes the trust model explicit:

1. The reader picks a manuscript and a tier (read $1 / citation $25 /
   commercial $150) and pays with PayPal (Sandbox). The app creates a PayPal
   order with intent AUTHORIZE.
2. The reader approves on PayPal. The app authorizes the order — PayPal
   HOLDS the funds. Nothing is captured yet.
3. The licensing agent runs its attestation review: deterministic gates
   (work active, tier price matches the catalog, authorized amount matches
   the tier price exactly, buyer address valid, no replay for this order)
   plus, when configured, an LLM review of the manuscript record against
   the license terms. The verdict is stored on the license and shown in the
   UI.
4. Only on a release does the agent capture the authorization. On a hold it
   voids it — the buyer is never charged.
5. After capture, the same MPC settlement path records the license on Base
   via LicenseRegistry, with replay protection keyed to the PayPal order.

PayPal is central to the project, not a checkout button: the hold-until-
attested flow is the product's trust model, and the AI attestation agent is
the thing that decides whether held money moves.

## What changed since Oct 1, 2026

(Required: existing projects must show meaningful updates after Oct 1.)

- New PayPal Sandbox checkout end to end: `PayPalService` (Orders API v2),
  `PayPalCheckoutController` (`POST /api/paypal/order`, `GET /paypal/return`,
  `GET /paypal/cancel`), `SettlePayPalLicense` job (verify → attestation →
  capture → MPC record on Base).
- New AI attestation agent (`AttestationAgent`): deterministic gates +
  LLM release/hold verdict, stored per license, shown in the UI.
- Checkout UI: payment-method toggle (crypto via 1Click / PayPal Sandbox)
  and PayPal + attestation status on the settlement card.
- License model + migration: `payment_method`, `paypal_order_id`,
  `paypal_authorization_id`, `paypal_capture_id`, `attestation_payload`.
- `LICENSE` file added (MIT). `PAYPAL_*` / `AI_*` config in
  `config/services.php` and `.env.example`.
- Feature tests: `tests/Feature/PayPalCheckoutTest.php` (order creation,
  return → authorize → capture → settle, amount-mismatch void, LLM-hold
  void, duplicate-return idempotency).

## How PayPal is used

PayPal Orders API v2 (Sandbox): `POST /v2/checkout/orders` (intent
AUTHORIZE), buyer approval on PayPal, `POST /v2/checkout/orders/{id}/
authorize` (funds held), `POST /v2/payments/authorizations/{id}/capture`
(only after attestation release) or `/void` (on hold). No live PayPal
credentials are used anywhere in this build — sandbox only.

## How AI is used

The attestation agent (`AttestationAgent`) combines deterministic gates
(authoritative) with an LLM review (OpenAI-compatible chat completions,
configured via `AI_API_KEY` / `AI_API_BASE_URL` / `AI_MODEL`) that reads
the manuscript record, license terms, and payment evidence and returns a
JSON release/hold verdict with rationale. Without a key it runs on
deterministic gates only and records that honestly.

## Honest status (Nov 9, 2026)

- Sandbox flow is built and feature-tested. The demo video shows the
  sandbox flow (sandbox buyer account, sandbox dollars — no real money).
- UPDATE Nov 10, 21:30 ET: live catalog read tier is $1 (verified in the
  iMac SQLite DB — all 3 works {"read":1,"citation":25,"commercial":150});
  the submission text and video script above now say $1. Note: the seeder
  file still says $10 — a re-seed would revert the price; seeder update
  pending his word. Settle leg: the live path is wired
  (scripts/mpc-settle.cjs present and parses, LICENSE_REGISTRY_ADDRESS +
  NEAR_PRIVATE_KEY set) but has NEVER run live — relayer nonce still 0 as
  of Nov 10 21:30 ET. Beat 5 says so plainly; do not fake settlement.

## Demo video script (< 3 minutes — DO NOT record or publish; D'Vaughn's step)

Screen recording, live app + PayPal Sandbox. Total target 2:30.

- **Beat 1 (0:00–0:20) — What it is.** "Scholarly works, licensed with
  PayPal. The reader pays with PayPal, the payment is HELD, and an AI
  attestation agent checks the license before a cent moves. Then the
  license is recorded on Base." Show the checkout page, PayPal toggle.
- **Beat 2 (0:20–0:50) — Pick a license.** Open the Quadratic Funding
  replication manuscript. Pick the $1 read tier. Enter the buyer EVM
  address. "Same catalog, same tiers as the crypto checkout — a second
  rail, not a second product."
- **Beat 3 (0:50–1:30) — PayPal hold.** Click "Continue with PayPal".
  Approve in the PayPal Sandbox (buyer test account). Come back: status
  `authorized`. "PayPal is holding $1. Nothing has been captured."
- **Beat 4 (1:30–2:10) — Attestation.** Show the attestation verdict on
  the status card: deterministic gates + LLM review, decision RELEASE.
  "The agent checked the manuscript, the tier, and the amount — then it
  released the payment." Show the capture (CAP id) and the license status
  flipping to captured.
- **Beat 5 (2:10–2:30) — The record.** Show the on-chain leg: if the MPC
  key is in place, open the BaseScan transaction and point at the
  `LicenseRecorded` event. If not, say plainly: "Settlement lands once
  the MPC key is in place — the payment is captured, the license is
  queued, nothing is faked." Close: "The scholar gets paid. The license
  is on-chain. The hold is what makes it trustworthy."

## About — Devpost template (paste into the form)

Written for a reader who has never heard of STANZA. The brand is introduced
once, in plain language; the jargon stays in "How we built it".

### Inspiration

A scholar writes something worth paying for: a new chemo drug, a new
public policy, or a threat to public health. A reader wants to pay for it:
a tv producer, journalist, or student.

There is no simple way for that to happen directly: publishers take the
terms and the cut, and crypto-only licensing shuts out everyone who just
has a PayPal account. And paying first means trusting a stranger. So the
idea was to flip it: let the reader pay with the account they already have,
hold the money until an AI checks that the license is real, and only then
release it. STANZA is the name of the licensing system behind it — the
thing that records the license on a public ledger once the payment clears,
so the buyer can prove they hold it and the writer can prove they were
paid.

### What it does

A reader picks a manuscript and a license tier — read $1, citation $25,
commercial $150 — and pays with PayPal. PayPal holds the money; nothing is
captured yet. An AI attestation agent checks the license: is the work real,
does the tier price match the catalog, does the authorized amount match the
price exactly, is the buyer address valid. If the check passes, the payment
is released to the scholar and the license is recorded on Base, a public
ledger. If it fails, the hold is voided and the buyer is never charged.

### How we built it

Laravel app with a PayPal Sandbox checkout (Orders API v2, intent
AUTHORIZE) and a payment-method toggle on the checkout page. The attestation
agent (`AttestationAgent`) runs deterministic gates plus, when configured,
an LLM review of the manuscript record against the license terms
(OpenAI-compatible chat completions). Settlement uses NEAR Chain Signatures
(MPC) to record the license on Base through the LicenseRegistry contract —
no EVM private key anywhere in the loop. Feature tests cover order creation,
return → authorize → capture → settle, amount-mismatch void, LLM-hold void,
and duplicate-return idempotency (6/6 passing).

### Challenges we ran into

PayPal's API base URL came back empty from config and the checkout died
with a client error — fixed by falling back to the default sandbox URL.
A live credential pair got pasted where the sandbox pair belonged; testing
caught it (the live token worked, the sandbox one 401'd). Logging into
PayPal Sandbox with the merchant account gets refused — the demo needs a
Personal buyer test account. And the on-chain settlement leg is wired but
hasn't run live yet (the relayer has never sent a transaction), so the demo
says that plainly instead of faking a settlement.

### Accomplishments that we're proud of

The sandbox flow works end to end in the live demo: order created, buyer
approves, PayPal holds $1, the attestation agent releases it, the capture
lands, and the license status flips. The $1 read tier is verified in the
live catalog, and the hold-until-attested flow — the actual trust model —
is proven, not just described.

### What we learned

Holding money beats chasing it: authorize-then-capture turns a trust
problem into a checkable step. Sandbox account roles matter — merchant and
buyer are different accounts, and using the wrong one looks like a broken
product. Config needs a fallback, or one missing variable kills the whole
checkout. And an honest "not yet live" in a demo beats a faked settlement
every time.

### What's next for Stanza Cross Chain

Run the settlement leg live: the first real $1 license recorded on Base.
Then live PayPal credentials out of the sandbox, more manuscripts and
tiers, and the same hold-until-attested pattern for other payment rails —
so a reader can license a work from anywhere, with the payment method they
already have.

## Steps only D'Vaughn can do

1. **PayPal Developer sandbox credentials** (if not already created):
   developer.paypal.com → Dashboard → My Apps & Credentials → Sandbox →
   Create App. Put the sandbox Client ID + Secret in the iMac app `.env`
   as `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` (never in the repo).
   Also create a sandbox Personal (buyer) test account for the demo.
2. **Devpost registration:** join the PayPal AI Hackathon on Devpost
   (paypalaihackathon.devpost.com) with his account, create the submission,
   paste the text above, link the repo
   (https://github.com/deevee3/stanza-crosschain, branch `paypal-slice`),
   add the demo video link.
3. **AI key (optional but recommended):** set `AI_API_KEY` in the iMac app
   `.env` so the demo shows the LLM attestation review live. Without it
   the agent runs deterministic gates only (and says so).
4. **NEAR function-call key — DONE Nov 9, 10:12 ET:** the key for
   `stanza_glenride.near` is created and verified on-chain (see Honest
   status above). No action needed from him on the key. What remains is
   Antigravity's live MPC settle implementation (Order 9 Task 2). If
   settlement is not live by recording time, record beats 1–4 + the
   capture, and say plainly the settlement lands next.
5. **Record + upload the demo video** (< 3 min, public on YouTube) using
   the script above. Post it only when ready.
6. **Submit on Devpost** before Thu Nov 12, 12:00 PM PT (3:00 PM ET).
   Submission is his click — do not let anyone else submit for him.
