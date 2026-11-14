<?php

namespace App\Services;

use App\Mail\LicenseDelivered;
use App\Models\License;
use Exception;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Reader delivery emails (Resend). Called after a license settles, on
 * both rails. Never throws and never fails a settlement: mail problems
 * are logged, and the license keeps its settled state with
 * delivery_sent_at left null so the gap is visible.
 *
 * Recipient: the license's buyer_email only. Wallet buyers who skip the
 * optional email field get no delivery email — the on-page instructions
 * point them at License Lookup instead. No Resend key while the resend
 * mailer is configured, no send — the delivery waits for the key
 * instead of erroring the settle job.
 */
class ReaderDeliveryService
{
    public function deliver(License $license): bool
    {
        $license->refresh();

        if ($license->delivery_sent_at !== null) {
            return true;
        }

        $recipient = $license->buyer_email;

        if (empty($recipient)) {
            Log::info("No reader delivery recipient for license #{$license->id}; skipping.", [
                'work_id' => $license->work_id,
            ]);

            return false;
        }

        if (config('mail.default') === 'resend' && empty(config('services.resend.key'))) {
            Log::warning("Reader delivery for license #{$license->id} skipped: resend mailer configured but RESEND_KEY is not set.");

            return false;
        }

        try {
            Mail::to($recipient)->send(new LicenseDelivered($license));
        } catch (Exception $e) {
            Log::error("Reader delivery for license #{$license->id} failed to send.", [
                'recipient' => $recipient,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        $license->update(['delivery_sent_at' => now()]);

        Log::info("Reader delivery sent for license #{$license->id}.", ['recipient' => $recipient]);

        return true;
    }
}
