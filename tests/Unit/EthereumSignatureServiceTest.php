<?php

namespace Tests\Unit;

use App\Services\EthereumSignatureService;
use PHPUnit\Framework\TestCase;

class EthereumSignatureServiceTest extends TestCase
{
    // Cross-checked against `cast` on 2026-11-12: `cast wallet sign
    // --private-key 0x01 "STANZA-TEST-MESSAGE"` produced this signature,
    // and `cast wallet address` for the same key is the address below.
    protected const CAST_MESSAGE = 'STANZA-TEST-MESSAGE';
    protected const CAST_SIGNATURE = '0x870ad6c2158ef8f0bc318e1d034b5ee627d88a4f8e0a5d110bee0f336bf1da1e60950a9db409d56afec13d3a3caf4c4685ea65f51bc2191507076b27045e6ba61b';
    protected const CAST_ADDRESS = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

    public function test_keccak256_matches_known_vectors(): void
    {
        $this->assertSame('0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', EthereumSignatureService::keccak256Hex(''));
        $this->assertSame('0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45', EthereumSignatureService::keccak256Hex('abc'));
    }

    public function test_recovers_cast_signature_to_cast_address(): void
    {
        $recovered = EthereumSignatureService::recoverAddress(self::CAST_MESSAGE, self::CAST_SIGNATURE);

        $this->assertSame(strtolower(self::CAST_ADDRESS), $recovered);
    }

    public function test_verify_accepts_cast_signature_for_cast_address(): void
    {
        $this->assertTrue(EthereumSignatureService::verify(self::CAST_MESSAGE, self::CAST_SIGNATURE, self::CAST_ADDRESS));
        $this->assertTrue(EthereumSignatureService::verify(self::CAST_MESSAGE, self::CAST_SIGNATURE, strtolower(self::CAST_ADDRESS)));
    }

    public function test_verify_rejects_wrong_message_and_wrong_signer(): void
    {
        $this->assertFalse(EthereumSignatureService::verify('STANZA-TEST-MESSAGE!', self::CAST_SIGNATURE, self::CAST_ADDRESS));
        $this->assertFalse(EthereumSignatureService::verify(self::CAST_MESSAGE, self::CAST_SIGNATURE, '0x2c432c901d5844431b027dd652fbfd3cc3dd6094'));
    }

    public function test_sign_and_recover_roundtrip(): void
    {
        $privateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';
        $message = 'Upload to STANZA by SpinWave as 0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf.';

        $signature = EthereumSignatureService::sign($privateKey, $message);

        $this->assertSame(strtolower(self::CAST_ADDRESS), EthereumSignatureService::recoverAddress($message, $signature));
        $this->assertTrue(EthereumSignatureService::verify($message, $signature, self::CAST_ADDRESS));
    }

    public function test_malformed_signatures_recover_to_null(): void
    {
        $this->assertNull(EthereumSignatureService::recoverAddress(self::CAST_MESSAGE, '0x1234'));
        $this->assertNull(EthereumSignatureService::recoverAddress(self::CAST_MESSAGE, 'not a signature'));
        $this->assertNull(EthereumSignatureService::recoverAddress(self::CAST_MESSAGE, ''));
        // Valid length, r = 0: out of range.
        $this->assertNull(EthereumSignatureService::recoverAddress(
            self::CAST_MESSAGE,
            '0x' . str_repeat('0', 64) . substr(self::CAST_SIGNATURE, 66, 64) . '1b'
        ));
        // Valid length, bad v (0x1c is 28, fine — 0x1f is not a recovery id).
        $this->assertNull(EthereumSignatureService::recoverAddress(
            self::CAST_MESSAGE,
            substr(self::CAST_SIGNATURE, 0, 130) . '1f'
        ));
    }
}
