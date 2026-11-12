<?php

namespace Tests\Feature;

use App\Jobs\SettlePayPalLicense;
use App\Mail\LicenseSold;
use App\Models\License;
use App\Models\Work;
use App\Services\ScholarNotificationService;
use Exception;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class ScholarNotificationTest extends TestCase
{
    use RefreshDatabase;

    protected function makeSettledLicense(array $workAttributes = []): License
    {
        $work = Work::create(array_merge([
            'work_id' => '0x' . hash('sha256', 'notify-test-work'),
            'title' => 'Notify Test Work',
            'slug' => 'notify-test-work',
            'scholar_name' => 'Prof. Katherine Vance',
            'scholar_address' => '0x5C10a12345678901234567890123456789012345',
            'metadata_uri' => 'https://example.com/notify-test-work',
            'tiers' => ['read' => 10.00, 'citation' => 25.00, 'commercial' => 150.00, 'exclusive' => 500.00],
            'is_active' => true,
        ], $workAttributes));

        return License::create([
            'work_id' => $work->id,
            'tier' => 'read',
            'price_usd' => 10.00,
            'buyer_address' => '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf',
            'buyer_email' => 'buyer@example.com',
            'deposit_chain' => 'base',
            'deposit_asset' => 'nep141:base-0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            'deposit_address' => '0x0000000000000000000000000000000000000001',
            'deposit_amount' => '10.12526',
            'status' => 'settled',
            'settled_at' => now(),
            'settlement_tx_hash' => '0x' . str_repeat('ab', 32),
        ]);
    }

    public function test_notification_sends_to_scholar_email(): void
    {
        Mail::fake();

        $license = $this->makeSettledLicense(['scholar_email' => 'scholar@example.com']);

        $this->assertTrue((new ScholarNotificationService)->notify($license));

        Mail::assertSent(LicenseSold::class, function (LicenseSold $mail) use ($license) {
            return $mail->hasTo('scholar@example.com')
                && $mail->license->id === $license->id;
        });
        $this->assertNotNull($license->fresh()->notification_sent_at);
    }

    public function test_notification_falls_back_to_configured_notify_email(): void
    {
        Mail::fake();
        config()->set('services.stanza.notify_email', 'fallback@example.com');

        $license = $this->makeSettledLicense();

        $this->assertTrue((new ScholarNotificationService)->notify($license));

        Mail::assertSent(LicenseSold::class, fn (LicenseSold $mail) => $mail->hasTo('fallback@example.com'));
        $this->assertNotNull($license->fresh()->notification_sent_at);
    }

    public function test_notification_skips_when_no_recipient_configured(): void
    {
        Mail::fake();
        config()->set('services.stanza.notify_email', null);

        $license = $this->makeSettledLicense();

        $this->assertFalse((new ScholarNotificationService)->notify($license));

        Mail::assertNothingSent();
        $this->assertNull($license->fresh()->notification_sent_at);
    }

    public function test_notification_skips_when_resend_mailer_has_no_key(): void
    {
        Mail::fake();
        config()->set('mail.default', 'resend');
        config()->set('services.resend.key', null);

        $license = $this->makeSettledLicense(['scholar_email' => 'scholar@example.com']);

        $this->assertFalse((new ScholarNotificationService)->notify($license));

        Mail::assertNothingSent();
        $this->assertNull($license->fresh()->notification_sent_at);
    }

    public function test_notification_is_idempotent(): void
    {
        Mail::fake();

        $license = $this->makeSettledLicense(['scholar_email' => 'scholar@example.com']);
        $service = new ScholarNotificationService;

        $this->assertTrue($service->notify($license));
        $this->assertTrue($service->notify($license->fresh()));

        Mail::assertSent(LicenseSold::class, 1);
    }

    public function test_settle_paypal_license_job_is_bounded(): void
    {
        $license = $this->makeSettledLicense();
        $job = new SettlePayPalLicense($license);

        $this->assertSame(5, $job->tries);
        $this->assertSame(60, $job->backoff);
    }

    public function test_settle_paypal_license_failed_hook_marks_license_failed(): void
    {
        $license = $this->makeSettledLicense();
        $license->update(['status' => 'signing', 'paypal_capture_id' => 'CAPTURE123']);

        (new SettlePayPalLicense($license))->failed(new Exception('MPC timeout'));

        $fresh = $license->fresh();
        $this->assertSame('failed', $fresh->status);
        $this->assertStringContainsString('MPC timeout', $fresh->error_message);
        $this->assertStringContainsString('CAPTURE123', $fresh->error_message);
        $this->assertSame('CAPTURE123', $fresh->paypal_capture_id);
    }

    public function test_settle_paypal_license_failed_hook_leaves_settled_licenses_alone(): void
    {
        $license = $this->makeSettledLicense();

        (new SettlePayPalLicense($license))->failed(new Exception('late failure'));

        $this->assertSame('settled', $license->fresh()->status);
    }
}
