<?php

namespace App\Jobs;

use App\Models\License;
use App\Services\OneClickService;
use Carbon\Carbon;
use Exception;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\Log;

class WatchSettlement implements ShouldQueue
{
    use Queueable;

    public License $license;

    // No $tries on purpose: this job release(5)-polls itself until the
    // swap reaches a terminal status, so it needs the worker's --tries=0
    // (unlimited). The quote-expiry guard below is what stops it polling
    // a dead quote forever — never run this job under --tries=1 (the
    // second run dies MaxAttemptsExceeded; Nov 9 lesson, standing rule).

    public function __construct(License $license)
    {
        $this->license = $license;
    }

    public function handle(OneClickService $oneClick): void
    {
        if (empty($this->license->deposit_address)) {
            throw new Exception("License #{$this->license->id} has no deposit address to watch.");
        }

        // A quote nobody paid for must retire instead of polling forever:
        // the 1Click deposit window is 30 minutes, and a deposit after it
        // closes is refunded, not settled. Retire the watcher (and the
        // license) once the window is well past; the buyer requests a
        // fresh quote to try again.
        if ($this->quoteExpired()) {
            $this->license->update([
                'status' => 'failed',
                'error_message' => 'Deposit window expired before any deposit was detected. Request a fresh quote to try again.',
            ]);

            Log::warning("WatchSettlement retiring expired quote for License #{$this->license->id}.");

            return;
        }

        $statusData = $oneClick->getStatus($this->license->deposit_address);
        $status = strtoupper($statusData['status'] ?? 'PENDING');

        Log::info("WatchSettlement check for License #{$this->license->id}", [
            'status' => $status,
            'depositAddress' => $this->license->deposit_address,
        ]);

        if ($status === 'SUCCESS') {
            $depositTx = $statusData['depositTxHash'] ?? ('0x' . hash('sha256', "dep_{$this->license->deposit_address}"));
            $proofHash = '0x' . hash('sha256', $depositTx);

            $this->license->update([
                'deposit_tx_hash' => $depositTx,
                'proof_hash' => $proofHash,
                'status' => 'deposited',
            ]);

            Log::info("Deposit confirmed for License #{$this->license->id}. Handing off to SettleLicense.");
            SettleLicense::dispatch($this->license);
            return;
        }

        if (in_array($status, ['FAILED', 'REFUNDED'])) {
            $this->license->update([
                'status' => 'failed',
                'error_message' => "1Click swap resulted in {$status}.",
            ]);

            Log::warning("1Click payment {$status} for License #{$this->license->id}");
            return;
        }

        // Still pending or processing: release back to queue for next check
        $this->release(5);
    }

    /**
     * True once no deposit can still settle this quote: the quote's own
     * deadline passed 30+ minutes ago, or (backstop for quotes with no
     * stored deadline) the license is over 2 hours old with no deposit
     * recorded. A deposit already seen keeps polling until the swap
     * resolves — the guard only retires quotes nobody paid.
     */
    protected function quoteExpired(): bool
    {
        if (!empty($this->license->deposit_tx_hash)) {
            return false;
        }

        $quote = $this->license->quote_payload ?? [];
        if (!empty($quote['deadline'])) {
            try {
                $deadline = Carbon::parse($quote['deadline']);
                if (now()->greaterThan($deadline->copy()->addMinutes(30))) {
                    return true;
                }
            } catch (\Throwable) {
                // Unparseable deadline: fall through to the age backstop.
            }
        }

        $created = $this->license->created_at;
        if ($created && now()->greaterThan($created->copy()->addHours(2))) {
            return true;
        }

        return false;
    }
}
