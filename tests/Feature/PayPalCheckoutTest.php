<?php

namespace Tests\Feature;

use App\Jobs\SettlePayPalLicense;
use App\Models\License;
use App\Models\Work;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PayPalCheckoutTest extends TestCase
{
    use RefreshDatabase;

    protected Work $work;

    protected function setUp(): void
    {
        parent::setUp();

        $this->work = Work::create([
            'work_id' => '0x' . hash('sha256', 'paypal-sample-work-1'),
            'title' => 'PayPal Sample Manuscript',
            'slug' => 'paypal-sample-manuscript',
            'scholar_name' => "D'Vaughn House",
            'scholar_address' => '0x2c432c901d5844431b027dd652fbfd3cc3dd6094',
            'metadata_uri' => 'https://example.com/manuscript.md',
            'tiers' => [
                'read' => 10.00,
                'citation' => 25.00,
                'commercial' => 150.00,
            ],
            'is_active' => true,
        ]);
    }

    /** Fake the PayPal Sandbox API (token, orders, authorize, capture, void). */
    protected function fakePayPal(string $authorizedAmount = '10.00'): void
    {
        config([
            'services.paypal.client_id' => 'test-client-id',
            'services.paypal.client_secret' => 'test-client-secret',
        ]);

        Http::fake([
            '*oauth2/token*' => Http::response(['access_token' => 'fake-token', 'expires_in' => 3600], 200),
            '*v2/checkout/orders/*/authorize' => Http::response([
                'id' => 'ORDER-123',
                'status' => 'COMPLETED',
                'purchase_units' => [[
                    'payments' => ['authorizations' => [[
                        'id' => 'AUTH-1',
                        'status' => 'CREATED',
                        'amount' => ['currency_code' => 'USD', 'value' => $authorizedAmount],
                    ]]],
                ]],
            ], 200),
            '*v2/checkout/orders*' => Http::response([
                'id' => 'ORDER-123',
                'status' => 'APPROVED',
                'links' => [[
                    'rel' => 'approve',
                    'href' => 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-123',
                ]],
                'purchase_units' => [[
                    'payments' => ['authorizations' => [[
                        'id' => 'AUTH-1',
                        'status' => 'CREATED',
                        'amount' => ['currency_code' => 'USD', 'value' => $authorizedAmount],
                    ]]],
                ]],
            ], 200),
            '*authorizations/*/capture' => Http::response(['id' => 'CAP-1', 'status' => 'COMPLETED'], 200),
            '*authorizations/*/void' => Http::response([], 200),
        ]);
    }

    protected function createPayPalLicense(): License
    {
        $this->fakePayPal();

        $response = $this->postJson('/api/paypal/order', [
            'work_id' => $this->work->id,
            'tier' => 'read',
            'buyer_address' => '0xc09ae916febb1d51de1a6eb5f4353ae48c348f84',
        ]);

        $response->assertStatus(200);

        return License::findOrFail($response->json('license.id'));
    }

    public function test_paypal_order_requires_configuration(): void
    {
        $response = $this->postJson('/api/paypal/order', [
            'work_id' => $this->work->id,
            'tier' => 'read',
            'buyer_address' => '0xc09ae916febb1d51de1a6eb5f4353ae48c348f84',
        ]);

        $response->assertStatus(503);
        $response->assertJsonPath('error', 'paypal_not_configured');
    }

    public function test_paypal_order_returns_approval_url_and_stores_license(): void
    {
        $this->fakePayPal();

        $response = $this->postJson('/api/paypal/order', [
            'work_id' => $this->work->id,
            'tier' => 'read',
            'buyer_address' => '0xc09ae916febb1d51de1a6eb5f4353ae48c348f84',
        ]);

        $response->assertStatus(200);
        $response->assertJsonPath('ok', true);
        $response->assertJsonPath('paypal_order_id', 'ORDER-123');
        $this->assertStringContainsString('sandbox.paypal.com', $response->json('approve_url'));

        $this->assertDatabaseHas('licenses', [
            'id' => $response->json('license.id'),
            'payment_method' => 'paypal',
            'paypal_order_id' => 'ORDER-123',
            'tier' => 'read',
            'status' => 'pending',
        ]);
    }

    public function test_paypal_return_authorizes_captures_and_settles(): void
    {
        $license = $this->createPayPalLicense();

        $response = $this->get("/paypal/return?token=ORDER-123&license={$license->id}");
        $response->assertStatus(200);

        $license->refresh();

        // Queue is sync in tests, so the settle job ran inline. The MPC leg
        // runs on the stub path here (no registry address in test env).
        $this->assertEquals('settled', $license->status);
        $this->assertEquals('AUTH-1', $license->paypal_authorization_id);
        $this->assertEquals('CAP-1', $license->paypal_capture_id);
        $this->assertNotEmpty($license->settlement_tx_hash);
        $this->assertEquals('0x' . hash('sha256', 'paypal:ORDER-123'), $license->proof_hash);
        $this->assertEquals('release', $license->attestation_payload['decision']);
        $this->assertEquals('deterministic', $license->attestation_payload['mode']);
    }

    public function test_paypal_amount_mismatch_voids_and_fails_without_capture(): void
    {
        // Build the authorized license directly: the PayPal fake is
        // registered once, with a mismatched authorized amount (999.00 vs
        // the $10.00 read tier). (Re-registering Http::fake would NOT take
        // effect — the first matching stub wins — so the mismatch must be
        // in place before the job runs.)
        $this->fakePayPal('999.00');

        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => '0xc09ae916febb1d51de1a6eb5f4353ae48c348f84',
            'tier' => 'read',
            'price_usd' => 10.00,
            'payment_method' => 'paypal',
            'paypal_order_id' => 'ORDER-123',
            'paypal_authorization_id' => 'AUTH-1',
            'status' => 'authorized',
        ]);

        (new SettlePayPalLicense($license))->handle(
            app(\App\Services\PayPalService::class),
            app(\App\Services\AttestationAgent::class),
            app(\App\Services\MpcSettlementService::class)
        );

        $license->refresh();
        $this->assertEquals('failed', $license->status);
        $this->assertNull($license->paypal_capture_id);
        $this->assertStringContainsString('does not match tier price', $license->error_message);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/void'));
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/capture'));
    }

    public function test_paypal_attestation_hold_voids_and_never_captures(): void
    {
        $license = $this->createPayPalLicense();

        // LLM configured and returning HOLD (stubUrl adds to the existing
        // PayPal fakes instead of replacing them).
        config([
            'services.ai.api_key' => 'test-ai-key',
            'services.ai.base_url' => 'https://ai.example.test/v1',
        ]);
        Http::stubUrl('*chat/completions*', Http::response([
            'choices' => [[
                'message' => ['content' => json_encode([
                    'decision' => 'hold',
                    'rationale' => 'Test hold: manuscript record mismatch.',
                    'checks' => ['record mismatch'],
                ])],
            ]],
        ], 200));

        $license->update([
            'status' => 'authorized',
            'paypal_authorization_id' => 'AUTH-1',
        ]);

        (new SettlePayPalLicense($license))->handle(
            app(\App\Services\PayPalService::class),
            app(\App\Services\AttestationAgent::class),
            app(\App\Services\MpcSettlementService::class)
        );

        $license->refresh();
        $this->assertEquals('failed', $license->status);
        $this->assertNull($license->paypal_capture_id);
        $this->assertStringContainsString('Test hold', $license->error_message);
        $this->assertEquals('hold', $license->attestation_payload['decision']);
        $this->assertEquals('llm+deterministic', $license->attestation_payload['mode']);

        Http::assertSent(fn ($request) => str_contains($request->url(), '/void'));
        Http::assertNotSent(fn ($request) => str_contains($request->url(), '/capture'));
    }

    public function test_paypal_return_is_idempotent(): void
    {
        $license = $this->createPayPalLicense();

        $this->get("/paypal/return?token=ORDER-123&license={$license->id}")->assertStatus(200);
        $this->get("/paypal/return?token=ORDER-123&license={$license->id}")->assertStatus(200);

        $license->refresh();
        $this->assertEquals('settled', $license->status);

        $captures = collect(Http::recorded())
            ->filter(fn ($recorded) => str_contains($recorded[0]->url(), '/capture'));
        $this->assertCount(1, $captures, 'Capture must run exactly once across duplicate returns.');
    }
}
