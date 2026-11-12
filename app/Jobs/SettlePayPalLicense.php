<?php

namespace App\Jobs;

use App\Models\License;
use App\Services\AttestationAgent;
use App\Services\MpcSettlementService;
use App\Services\PayPalService;
use Exception;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

/**
 * Settles a PayPal license: the mirror of SettleLicense for the 1Click flow,
 * with PayPal gates instead of 1Click gates.
 *
 * Order of operations (money moves exactly once, and only after review):
 *   1. Verify the PayPal authorization is live and its amount matches the
 *      tier price exactly (re-fetch from PayPal — never trust stored state).
 *   2. Run the attestation review (AttestationAgent). On HOLD: void the
 *      authorization so the buyer is never charged, mark the license failed.
 *   3. On RELEASE: capture the authorization (final capture).
 *   4. Record the license on Base via the same MPC settlement path as the
 *      1Click flow (MpcSettlementService::settleOnBase). If the NEAR
 *      function-call key is not configured yet, the live MPC call throws —
 *      that is caught here: the payment stays captured, the license stays
 *      'captured', and the job records that settlement is waiting on the
 *      key. Re-dispatching this job later (after the key exists) finishes
 *      the on-chain leg; it never captures twice.
 *
 * proofHash for PayPal licenses is keccak256('paypal:' . orderId), which
 * gives the same replay protection in LicenseRegistry.settled as the
 * 1Click deposit-tx proof hash.
 */
class SettlePayPalLicense implements ShouldQueue
{
    use Queueable;

    public License $license;

    public function __construct(License $license)
    {
        $this->license = $license;
    }

    public function handle(PayPalService $paypal, AttestationAgent $agent, MpcSettlementService $mpc): void
    {
        $this->license->refresh();
        $work = $this->license->work;

        if ($this->license->status === 'settled') {
            Log::info("PayPal license #{$this->license->id} already settled; nothing to do.");

            return;
        }

        if (!in_array($this->license->status, ['authorized', 'captured'], true)) {
            throw new Exception("PayPal settlement requires an authorized license; license #{$this->license->id} is {$this->license->status}.");
        }

        // GATE 1: re-fetch the authorization from PayPal and verify amount.
        // Skipped when the payment is already captured (re-dispatch path).
        if ($this->license->status === 'authorized') {
            $order = $paypal->getOrder((string) $this->license->paypal_order_id);
            $authorization = $this->findAuthorization($order, (string) $this->license->paypal_authorization_id);

            if ($authorization === null) {
                throw new Exception("PayPal authorization {$this->license->paypal_authorization_id} not found on order {$this->license->paypal_order_id}.");
            }

            if (($authorization['status'] ?? '') !== 'CREATED') {
                throw new Exception("PayPal authorization is " . ($authorization['status'] ?? 'unknown') . ", expected CREATED.");
            }

            $amount = (float) ($authorization['amount']['value'] ?? 0);
            $currency = strtoupper((string) ($authorization['amount']['currency_code'] ?? ''));
            if ($currency !== 'USD' || abs($amount - (float) $this->license->price_usd) > 0.005) {
                $this->voidAndFail($paypal, "Authorized amount {$currency} {$amount} does not match tier price USD {$this->license->price_usd}.");

                return;
            }

            // GATE 2: attestation review (deterministic gates + LLM when configured).
            $verdict = $agent->review($this->license, [
                'amount' => $amount,
                'currency' => $currency,
                'order_id' => $this->license->paypal_order_id,
                'authorization_id' => $this->license->paypal_authorization_id,
            ]);

            $this->license->update(['attestation_payload' => $verdict]);
            Log::info("Attestation verdict for PayPal license #{$this->license->id}", ['decision' => $verdict['decision'], 'mode' => $verdict['mode']]);

            if ($verdict['decision'] !== 'release') {
                $this->voidAndFail($paypal, 'Attestation review held the payment: ' . $verdict['rationale']);

                return;
            }

            // GATE 3: capture (final). This is the only point money moves.
            $capture = $paypal->captureAuthorization((string) $this->license->paypal_authorization_id, (float) $this->license->price_usd);
            $captureId = $capture['id'] ?? null;
            $captureStatus = strtoupper((string) ($capture['status'] ?? ''));

            if ($captureId === null || !in_array($captureStatus, ['COMPLETED', 'PENDING'], true)) {
                throw new Exception("PayPal capture did not complete (status: {$captureStatus}).");
            }

            $this->license->update([
                'status' => 'captured',
                'paypal_capture_id' => $captureId,
            ]);
            Log::info("PayPal license #{$this->license->id} captured", ['capture_id' => $captureId]);
        }

        // GATE 4: on-chain replay protection, then MPC settlement.
        $proofHash = '0x' . hash('sha256', 'paypal:' . $this->license->paypal_order_id);
        $this->license->update(['proof_hash' => $proofHash]);

        if (empty($work->work_id) || empty($this->license->tier) || empty($this->license->buyer_address)) {
            throw new Exception('Settlement verification failed: workId, tier, or buyer address is empty.');
        }

        if ($mpc->isSettledOnChain($proofHash)) {
            $this->license->update(['status' => 'settled']);
            Log::warning("PayPal license #{$this->license->id} already settled on-chain (replay protection active).");

            return;
        }

        $this->license->update(['status' => 'signing']);

        $isStub = empty(env('LICENSE_REGISTRY_ADDRESS')) || env('LICENSE_REGISTRY_ADDRESS') === 'stub';

        try {
            $result = $mpc->settleOnBase(
                $this->license->buyer_address,
                $work->work_id,
                $this->license->tier,
                $proofHash,
                $isStub
            );
        } catch (Exception $e) {
            // Live MPC path without the NEAR function-call key: the payment is
            // already captured, so do NOT fail the license or retry forever.
            // Park it as captured and say plainly what is missing; a later
            // re-dispatch finishes the on-chain leg.
            if (str_contains($e->getMessage(), 'NEAR credentials')) {
                $this->license->update([
                    'status' => 'captured',
                    'error_message' => 'Payment captured. On-chain settlement is waiting on the NEAR function-call key for stanza_glenride.near (only D\'Vaughn can create it from his seed phrase). Re-dispatch this job once the key is configured.',
                ]);
                Log::warning("PayPal license #{$this->license->id} captured; MPC settlement deferred (no NEAR key).");

                return;
            }

            throw $e;
        }

        $this->license->update([
            'status' => 'settled',
            'settlement_tx_hash' => $result['txHash'],
            'settled_at' => now(),
            'error_message' => null,
        ]);

        Log::info("PayPal license #{$this->license->id} settled on Base", [
            'txHash' => $result['txHash'],
            'proofHash' => $proofHash,
        ]);
    }

    /** Find the authorization with the given id inside a PayPal order payload. */
    protected function findAuthorization(array $order, string $authorizationId): ?array
    {
        foreach ($order['purchase_units'] ?? [] as $unit) {
            foreach ($unit['payments']['authorizations'] ?? [] as $authorization) {
                if (($authorization['id'] ?? '') === $authorizationId) {
                    return $authorization;
                }
            }
        }

        return null;
    }

    /** Void the held authorization (buyer never charged) and fail the license. */
    protected function voidAndFail(PayPalService $paypal, string $reason): void
    {
        try {
            $paypal->voidAuthorization((string) $this->license->paypal_authorization_id);
        } catch (Exception $e) {
            Log::warning("Could not void PayPal authorization for license #{$this->license->id}", ['error' => $e->getMessage()]);
        }

        $this->license->update([
            'status' => 'failed',
            'error_message' => $reason,
        ]);

        Log::warning("PayPal license #{$this->license->id} failed: {$reason}");
    }
}
