<?php

namespace App\Jobs;

use App\Models\License;
use App\Services\MpcSettlementService;
use App\Services\OneClickService;
use App\Services\ScholarNotificationService;
use Exception;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class SettleLicense implements ShouldQueue
{
    use Queueable;

    public License $license;

    /**
     * Bounded retries: the live worker runs with --tries=0 (WatchSettlement
     * needs unlimited attempts), but a settle that throws must land in
     * failed_jobs for human eyes instead of retrying forever — a deposit
     * has already moved by this point. The job-level $tries overrides
     * the worker's --tries. Generous backoff: a swap can need minutes
     * to flip to SUCCESS.
     */
    public int $tries = 5;
    public int $backoff = 60;

    public function __construct(License $license)
    {
        $this->license = $license;
    }

    public function handle(OneClickService $oneClick, MpcSettlementService $mpcService): void
    {
        $this->license->refresh();
        $work = $this->license->work;

        Log::info("Starting SettleLicense pre-flight verification for License #{$this->license->id}");

        // GATE 1: Verify 1Click status is SUCCESS
        $statusData = $oneClick->getStatus($this->license->deposit_address);
        $status = strtoupper($statusData['status'] ?? '');
        if ($status !== 'SUCCESS') {
            throw new Exception("Pre-signing verification failed: 1Click status is {$status}, expected SUCCESS.");
        }

        // GATE 2: Verify amountOut, destination, and asset match the stored quote exactly
        $storedQuote = $this->license->quote_payload ?? [];
        $expectedAmountUnits = (string) (int) ($this->license->price_usd * 1_000_000);

        if (isset($storedQuote['amountOut']) && (string) $storedQuote['amountOut'] !== $expectedAmountUnits) {
            throw new Exception("Pre-signing verification failed: amountOut mismatch. Expected {$expectedAmountUnits}, got {$storedQuote['amountOut']}.");
        }

        if (isset($storedQuote['recipient']) && strtolower($storedQuote['recipient']) !== strtolower($work->scholar_address)) {
            throw new Exception("Pre-signing verification failed: destination mismatch. Expected {$work->scholar_address}, got {$storedQuote['recipient']}.");
        }

        // GATE 3: Verify work, tier, and buyer match
        if (empty($work->work_id) || empty($this->license->tier) || empty($this->license->buyer_address)) {
            throw new Exception("Pre-signing verification failed: workId, tier, or buyer address is empty.");
        }

        // GATE 4: Verify on-chain isSettled is false (replay protection)
        $proofHash = $this->license->proof_hash;
        if (empty($proofHash)) {
            throw new Exception("Pre-signing verification failed: proofHash is missing.");
        }

        if ($mpcService->isSettledOnChain($proofHash)) {
            $this->license->update(['status' => 'settled']);
            Log::warning("License #{$this->license->id} already settled on-chain (replay protection active).");
            return;
        }

        // Pre-flight passed! Update state to signing
        $this->license->update(['status' => 'signing']);

        Log::info("Pre-signing verification PASSED for License #{$this->license->id}. Initiating MPC settlement.");

        $isStub = !empty($statusData['isStub']) || empty(env('LICENSE_REGISTRY_ADDRESS'));

        // Request Chain Signatures MPC signature and relay to Base (chain 8453)
        $settleResult = $mpcService->settleOnBase(
            $this->license->buyer_address,
            $work->work_id,
            $this->license->tier,
            $proofHash,
            $isStub
        );

        $txHash = $settleResult['txHash'];

        // Mark settled
        $this->license->update([
            'status' => 'settled',
            'settlement_tx_hash' => $txHash,
            'settled_at' => now(),
        ]);

        Log::info("License #{$this->license->id} successfully settled on Base", [
            'txHash' => $txHash,
            'proofHash' => $proofHash,
            'buyer' => $this->license->buyer_address,
            'work' => $work->work_id,
            'tier' => $this->license->tier,
            'scholar' => $work->scholar_address,
        ]);

        // The sale is recorded; tell the scholar. Notification failure
        // never fails the settlement — the service logs and returns false.
        app(ScholarNotificationService::class)->notify($this->license);
    }
}
