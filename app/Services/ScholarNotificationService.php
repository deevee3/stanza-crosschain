<?php

namespace App\Services;

use App\Mail\LicenseSold;
use App\Models\License;
use Exception;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Scholar sale notifications (Resend). Called after a license settles, on
 * both rails. Never throws and never fails a settlement: mail problems
 * are logged, and the license keeps its settled state with
 * notification_sent_at left null so the gap is visible.
 *
 * Recipient: the work's scholar_email when set, else STANZA_NOTIFY_EMAIL
 * (the operator fallback — today that is D'Vaughn, who owns the seeded
 * catalog). No recipient, no send. No Resend key while the resend mailer
 * is configured, no send — the notification waits for the key instead of
 * erroring the settle job.
 */
class ScholarNotificationService
{
    public function notify(License $license): bool
    {
        $license->refresh();
        $work = $license->work;

        if ($license->notification_sent_at !== null) {
            return true;
        }

        $recipient = $work?->scholar_email
            ?? config('services.stanza.notify_email');

        if (empty($recipient)) {
            Log::info("No scholar notification recipient for license #{$license->id}; skipping.", [
                'work_id' => $work?->id,
            ]);

            return false;
        }

        if (config('mail.default') === 'resend' && empty(config('services.resend.key'))) {
            Log::warning("Scholar notification for license #{$license->id} skipped: resend mailer configured but RESEND_KEY is not set.");

            return false;
        }

        try {
            Mail::to($recipient)->send(new LicenseSold($license));
        } catch (Exception $e) {
            Log::error("Scholar notification for license #{$license->id} failed to send.", [
                'recipient' => $recipient,
                'error' => $e->getMessage(),
            ]);

            return false;
        }

        $license->update(['notification_sent_at' => now()]);

        Log::info("Scholar notification sent for license #{$license->id}.", ['recipient' => $recipient]);

        return true;
    }
}
