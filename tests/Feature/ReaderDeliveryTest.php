<?php

namespace Tests\Feature;

use App\Mail\LicenseDelivered;
use App\Models\License;
use App\Models\Work;
use App\Services\ReaderDeliveryService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class ReaderDeliveryTest extends TestCase
{
    use RefreshDatabase;

    protected function makeSettledLicense(array $licenseAttributes = []): License
    {
        $work = Work::create([
            'work_id' => '0x' . hash('sha256', 'delivery-test-work'),
            'title' => 'Delivery Test Work',
            'slug' => 'delivery-test-work',
            'scholar_name' => 'Prof. Katherine Vance',
            'scholar_address' => '0x5C10a12345678901234567890123456789012345',
            'metadata_uri' => 'https://example.com/delivery-test-work',
            'tiers' => ['read' => 10.00, 'citation' => 25.00, 'commercial' => 150.00, 'exclusive' => 500.00],
            'is_active' => true,
        ]);

        return License::create(array_merge([
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
        ], $licenseAttributes));
    }

    public function test_delivery_sends_to_buyer_email(): void
    {
        Mail::fake();

        $license = $this->makeSettledLicense();

        $this->assertTrue((new ReaderDeliveryService)->deliver($license));

        Mail::assertSent(LicenseDelivered::class, function (LicenseDelivered $mail) use ($license) {
            return $mail->hasTo('buyer@example.com')
                && $mail->license->id === $license->id;
        });
        $this->assertNotNull($license->fresh()->delivery_sent_at);
    }

    public function test_delivery_skips_when_no_buyer_email(): void
    {
        Mail::fake();

        $license = $this->makeSettledLicense(['buyer_email' => null]);

        $this->assertFalse((new ReaderDeliveryService)->deliver($license));

        Mail::assertNothingSent();
        $this->assertNull($license->fresh()->delivery_sent_at);
    }

    public function test_delivery_skips_when_resend_mailer_has_no_key(): void
    {
        Mail::fake();
        config()->set('mail.default', 'resend');
        config()->set('services.resend.key', null);

        $license = $this->makeSettledLicense();

        $this->assertFalse((new ReaderDeliveryService)->deliver($license));

        Mail::assertNothingSent();
        $this->assertNull($license->fresh()->delivery_sent_at);
    }

    public function test_delivery_is_idempotent(): void
    {
        Mail::fake();

        $license = $this->makeSettledLicense();
        $service = new ReaderDeliveryService;

        $this->assertTrue($service->deliver($license));
        $this->assertTrue($service->deliver($license->fresh()));

        Mail::assertSent(LicenseDelivered::class, 1);
    }
}
