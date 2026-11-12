<?php

namespace Tests\Unit;

use App\Services\MpcSettlementService;
use PHPUnit\Framework\TestCase;

class MpcSettlementServiceTest extends TestCase
{
    public function test_parses_settlement_json_after_near_stdout_noise(): void
    {
        // Exact shape of the live failure (license #17, 2026-11-12): the
        // MPC sign call succeeded and the script printed its JSON, but
        // near-api-js receipt/signer lines on stdout broke whole-output
        // json_decode, so the job failed AFTER the license had settled.
        $raw = "Receipts: E5ngdLXziGWY2BLFZL3bAcqzYqP6qksW4NrANoKDpCaK, 4RFBTro7P6XZHMNPXRhE7Q6br9bHzXWJ8ysGz8k3y5x3\n"
            . "\tLog [v1.signer]: sign: predecessor=AccountId(\"stanza_glenride.near\"), request=SignRequestArgs { path: \"ethereum-1\" }\n"
            . '{"status":"settled","txHash":"0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22","blockNumber":56562938,"relayedViaMpc":true,"isStub":false}' . "\n";

        $output = MpcSettlementService::parseSettlementOutput($raw);

        $this->assertSame('0x4c63981c75e071a0bc9c0bc0765dbd750fb28ea37c08f4df775299acc6d33f22', $output['txHash']);
        $this->assertSame(56562938, $output['blockNumber']);
        $this->assertFalse($output['isStub']);
    }

    public function test_parses_clean_settlement_json(): void
    {
        $raw = '{"status":"settled","txHash":"0xabc","blockNumber":1,"relayedViaMpc":true,"isStub":false}';

        $output = MpcSettlementService::parseSettlementOutput($raw);

        $this->assertSame('0xabc', $output['txHash']);
    }

    public function test_returns_null_when_no_json_present(): void
    {
        $this->assertNull(MpcSettlementService::parseSettlementOutput("Receipts: abc\nLog [v1.signer]: sign: foo\n"));
        $this->assertNull(MpcSettlementService::parseSettlementOutput(''));
        $this->assertNull(MpcSettlementService::parseSettlementOutput('not json at all'));
    }
}
