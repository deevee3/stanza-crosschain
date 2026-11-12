<?php

namespace Tests\Feature;

use App\Jobs\RequestLicenseQuote;
use App\Jobs\WatchSettlement;
use App\Models\License;
use App\Models\Work;
use App\Services\OneClickService;
use Exception;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ChainPickerTest extends TestCase
{
    use RefreshDatabase;

    protected Work $work;

    protected string $evmBuyer = '0xc09ae916febb1d51de1a6eb5f4353ae48c348f84';

    protected function setUp(): void
    {
        parent::setUp();

        $this->work = Work::create([
            'work_id' => '0x' . hash('sha256', 'chain-picker-work-1'),
            'title' => 'Chain Picker Manuscript',
            'slug' => 'chain-picker-manuscript',
            'scholar_name' => 'Dr. Jane Scholar',
            'scholar_address' => '0x2c432c901d5844431b027dd652fbfd3cc3dd6094',
            'metadata_uri' => 'ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            'description' => 'Manuscript for chain-picker tests.',
            'tiers' => [
                'read' => 5.00,
                'citation' => 25.00,
                'commercial' => 100.00,
            ],
            'is_active' => true,
        ]);
    }

    protected function quotePayload(array $overrides = []): array
    {
        return array_merge([
            'work_id' => $this->work->id,
            'tier' => 'read',
            'buyer_address' => $this->evmBuyer,
            'deposit_asset' => 'erc20:base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            'deposit_chain' => 'base',
        ], $overrides);
    }

    public function test_near_quote_requires_near_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'refund_address' => 'alice.near',
        ]));

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'deposit_chain' => 'near',
            'refund_address' => 'alice.near',
        ]);
    }

    public function test_near_quote_rejects_missing_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('refund_address');
    }

    public function test_near_quote_rejects_evm_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'refund_address' => $this->evmBuyer,
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('refund_address');
    }

    public function test_near_quote_rejects_uppercase_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'refund_address' => 'ALICE.near',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('refund_address');
    }

    public function test_solana_quote_requires_solana_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:sol.omft.near',
            'deposit_chain' => 'solana',
            'refund_address' => '78NTE8dBG924aDeW6VmAutZbRPtddhvH87zYuRxx2XQw',
        ]));

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'deposit_chain' => 'solana',
            'refund_address' => '78NTE8dBG924aDeW6VmAutZbRPtddhvH87zYuRxx2XQw',
        ]);
    }

    public function test_solana_quote_rejects_evm_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:sol.omft.near',
            'deposit_chain' => 'solana',
            'refund_address' => $this->evmBuyer,
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('refund_address');
    }

    public function test_solana_quote_rejects_short_refund_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:sol.omft.near',
            'deposit_chain' => 'solana',
            'refund_address' => 'abc',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('refund_address');
    }

    public function test_base_quote_defaults_refund_to_buyer_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload());

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'deposit_chain' => 'base',
            'refund_address' => $this->evmBuyer,
        ]);
    }

    public function test_arbitrum_quote_defaults_refund_to_buyer_address(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_asset' => 'nep141:arb.omft.near',
            'deposit_chain' => 'arbitrum',
        ]));

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'deposit_chain' => 'arbitrum',
            'refund_address' => $this->evmBuyer,
        ]);
    }

    public function test_quote_rejects_unknown_chain(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload([
            'deposit_chain' => 'dogecoin',
        ]));

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('deposit_chain');
    }

    public function test_quote_job_sends_refund_address_as_refund_to(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'refund_address' => 'alice.near',
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'status' => 'pending',
        ]);

        $captured = null;
        $mock = $this->createMock(OneClickService::class);
        $mock->method('requestQuote')->willReturnCallback(function (array $params) use (&$captured) {
            $captured = $params;

            return [
                'quoteId' => 'fake_quote_1',
                'depositAddress' => '0xfakedeposit',
                'originAsset' => $params['originAsset'],
                'destinationAsset' => $params['destinationAsset'],
                'amountIn' => '290000000000000000000000',
                'amountOut' => $params['amount'],
                'recipient' => $params['recipient'],
                'refundTo' => $params['refundTo'],
                'status' => 'PENDING_DEPOSIT',
                'isStub' => true,
            ];
        });

        $job = new RequestLicenseQuote($license);
        $job->handle($mock);

        $this->assertSame('alice.near', $captured['refundTo']);
        $this->assertSame('nep141:wrap.near', $captured['originAsset']);
    }

    public function test_quote_job_falls_back_to_buyer_address_without_refund_address(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'refund_address' => null,
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:arb.omft.near',
            'deposit_chain' => 'arbitrum',
            'status' => 'pending',
        ]);

        $captured = null;
        $mock = $this->createMock(OneClickService::class);
        $mock->method('requestQuote')->willReturnCallback(function (array $params) use (&$captured) {
            $captured = $params;

            return [
                'quoteId' => 'fake_quote_2',
                'depositAddress' => '0xfakedeposit2',
                'originAsset' => $params['originAsset'],
                'destinationAsset' => $params['destinationAsset'],
                'amountIn' => '1000000000000000',
                'amountOut' => $params['amount'],
                'recipient' => $params['recipient'],
                'refundTo' => $params['refundTo'],
                'status' => 'PENDING_DEPOSIT',
                'isStub' => true,
            ];
        });

        $job = new RequestLicenseQuote($license);
        $job->handle($mock);

        $this->assertSame($this->evmBuyer, $captured['refundTo']);
    }

    public function test_origin_asset_normalization_maps_legacy_native_ids(): void
    {
        $service = new OneClickService(null, 'stub');

        $sol = $service->requestQuote([
            'originAsset' => 'solana:native',
            'destinationAsset' => 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
            'amount' => '1000000',
            'recipient' => $this->work->scholar_address,
            'refundTo' => '78NTE8dBG924aDeW6VmAutZbRPtddhvH87zYuRxx2XQw',
        ]);
        $this->assertSame('nep141:sol.omft.near', $sol['originAsset']);

        $arb = $service->requestQuote([
            'originAsset' => 'arbitrum:native',
            'destinationAsset' => 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
            'amount' => '1000000',
            'recipient' => $this->work->scholar_address,
            'refundTo' => $this->evmBuyer,
        ]);
        $this->assertSame('nep141:arb.omft.near', $arb['originAsset']);

        $base = $service->requestQuote([
            'originAsset' => 'erc20:base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            'destinationAsset' => 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
            'amount' => '1000000',
            'recipient' => $this->work->scholar_address,
            'refundTo' => $this->evmBuyer,
        ]);
        $this->assertSame('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near', $base['originAsset']);
    }

    public function test_watcher_retires_expired_quote_without_polling(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'deposit_address' => '0xexpireddeposit',
            'quote_payload' => ['deadline' => now()->subHour()->toIso8601String()],
            'status' => 'quoted',
        ]);

        $mock = $this->createMock(OneClickService::class);
        $mock->expects($this->never())->method('getStatus');

        $job = new WatchSettlement($license);
        $job->handle($mock);

        $license->refresh();
        $this->assertEquals('failed', $license->status);
        $this->assertStringContainsString('expired', $license->error_message);
    }

    public function test_watcher_retires_ancient_quote_without_deadline(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'deposit_address' => '0xancientdeposit',
            'quote_payload' => [],
            'status' => 'quoted',
        ]);
        License::where('id', $license->id)->update(['created_at' => now()->subHours(3)]);
        $license->refresh();

        $mock = $this->createMock(OneClickService::class);
        $mock->expects($this->never())->method('getStatus');

        $job = new WatchSettlement($license);
        $job->handle($mock);

        $license->refresh();
        $this->assertEquals('failed', $license->status);
    }

    public function test_watcher_polls_fresh_quote(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'deposit_address' => '0xfreshdeposit',
            'quote_payload' => ['deadline' => now()->addMinutes(30)->toIso8601String()],
            'status' => 'quoted',
        ]);

        $mock = $this->createMock(OneClickService::class);
        $mock->expects($this->once())->method('getStatus')->with('0xfreshdeposit')->willReturn([
            'status' => 'PENDING_DEPOSIT',
            'isStub' => true,
        ]);

        $job = new WatchSettlement($license);
        $job->handle($mock);

        $license->refresh();
        $this->assertEquals('quoted', $license->status);
    }

    public function test_quote_job_failed_hook_marks_license_failed(): void
    {
        $license = License::create([
            'work_id' => $this->work->id,
            'buyer_address' => $this->evmBuyer,
            'tier' => 'read',
            'price_usd' => 5.00,
            'deposit_asset' => 'nep141:wrap.near',
            'deposit_chain' => 'near',
            'status' => 'pending',
        ]);

        $job = new RequestLicenseQuote($license);
        $job->failed(new Exception('1Click API quote error (400): refundTo is not valid'));

        $license->refresh();
        $this->assertEquals('failed', $license->status);
        $this->assertStringContainsString('refundTo is not valid', $license->error_message);
    }

    public function test_exclusive_quote_uses_catalog_default_when_work_has_no_exclusive_price(): void
    {
        $response = $this->postJson('/api/quote', $this->quotePayload(['tier' => 'exclusive']));

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'work_id' => $this->work->id,
            'tier' => 'exclusive',
            'price_usd' => 500.00,
        ]);
    }

    public function test_exclusive_quote_uses_stored_price_when_present(): void
    {
        $this->work->update(['tiers' => array_merge($this->work->tiers, ['exclusive' => 900.00])]);

        $response = $this->postJson('/api/quote', $this->quotePayload(['tier' => 'exclusive']));

        $response->assertStatus(200);
        $this->assertDatabaseHas('licenses', [
            'work_id' => $this->work->id,
            'tier' => 'exclusive',
            'price_usd' => 900.00,
        ]);
    }
}
