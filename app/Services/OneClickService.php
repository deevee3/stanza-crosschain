<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class OneClickService
{
    protected string $baseUrl;
    protected ?string $jwt;

    /**
     * Deposit addresses quoted through THIS instance, with their status
     * poll counts. Instance-level on purpose: each job resolves a fresh
     * service, so a poll from a fresh instance — e.g. WatchSettlement
     * checking an address quoted by RequestLicenseQuote's instance — sees
     * the terminal SUCCESS state, while a poll on the instance that
     * created the quote sees the fresh-quote PENDING_DEPOSIT state first.
     * Do NOT make this static: under the sync queue driver a release()
     * never re-executes the job, so WatchSettlement gets exactly one poll
     * and it must see SUCCESS.
     */
    protected array $stubQuotedAddresses = [];

    public function __construct(?string $baseUrl = null, ?string $jwt = null)
    {
        $this->baseUrl = rtrim($baseUrl ?? config('services.oneclick.base_url', env('ONECLICK_API_URL', 'https://1click.chaindefuser.com')), '/');
        $this->jwt = $jwt ?? config('services.oneclick.jwt', env('ONECLICK_JWT'));
    }

    /**
     * Request a cross-chain quote and unique deposit address from 1Click API.
     *
     * @param array $params
     * @return array
     * @throws Exception
     */
    public function requestQuote(array $params): array
    {
        // 1Click rejects EVM-style origin assets ("tokenIn is not valid").
        // Normalize erc20:<chain>:0x... to the nep141 omft form the live API
        // accepts (verified against live /v0/tokens 2026-11-07 for USDC Base).
        $params['originAsset'] = $this->normalizeOriginAsset($params['originAsset'] ?? null);

        // If running in stub mode (when ONECLICK_JWT is absent or set to stub)
        if (empty($this->jwt) || $this->jwt === 'stub') {
            return $this->getStubQuote($params);
        }

        $url = "{$this->baseUrl}/v0/quote";

        $response = Http::withHeaders([
            'Content-Type' => 'application/json',
            'X-API-Key' => $this->jwt,
            'Authorization' => "Bearer {$this->jwt}",
        ])->post($url, $params);

        if ($response->failed()) {
            Log::error('OneClick quote request failed', [
                'status' => $response->status(),
                'body' => $response->body(),
                'params' => $params,
            ]);

            throw new Exception("1Click API quote error ({$response->status()}): {$response->body()}");
        }

        return $this->normalizeQuoteResponse($response->json(), $params);
    }

    /**
     * Normalize the live 1Click quote into the flat shape the jobs expect.
     * Live API (verified 2026-11-07) returns {correlationId, quote: {...},
     * quoteRequest, signature, timestamp} — no top-level quoteId/depositAddress.
     */
    protected function normalizeQuoteResponse(array $json, array $params): array
    {
        if (!isset($json['quote']) || !is_array($json['quote'])) {
            return $json;
        }

        $quote = $json['quote'];
        $request = $json['quoteRequest'] ?? [];

        return [
            'quoteId' => $json['correlationId'] ?? null,
            'depositAddress' => $quote['depositAddress'] ?? null,
            'originAsset' => $request['originAsset'] ?? $params['originAsset'] ?? null,
            'destinationAsset' => $request['destinationAsset'] ?? $params['destinationAsset'] ?? null,
            'amount' => $request['amount'] ?? $params['amount'] ?? null,
            'amountIn' => $quote['amountIn'] ?? null,
            'amountInFormatted' => $quote['amountInFormatted'] ?? null,
            'amountInUsd' => $quote['amountInUsd'] ?? null,
            'amountOut' => $quote['amountOut'] ?? null,
            'amountOutFormatted' => $quote['amountOutFormatted'] ?? null,
            'amountOutUsd' => $quote['amountOutUsd'] ?? null,
            'recipient' => $request['recipient'] ?? $params['recipient'] ?? null,
            'refundTo' => $request['refundTo'] ?? $params['refundTo'] ?? null,
            'deadline' => $quote['deadline'] ?? null,
            'timeEstimate' => $quote['timeEstimate'] ?? null,
            'status' => 'PENDING_DEPOSIT',
            'isStub' => false,
            'raw' => $json,
        ];
    }

    /**
     * Poll the status of a cross-chain swap by its deposit address.
     *
     * @param string $depositAddress
     * @param string|null $depositMemo
     * @return array
     * @throws Exception
     */
    public function getStatus(string $depositAddress, ?string $depositMemo = null): array
    {
        // Stub mode
        if (empty($this->jwt) || $this->jwt === 'stub') {
            return $this->getStubStatus($depositAddress);
        }

        $url = "{$this->baseUrl}/v0/status";
        $queryParams = ['depositAddress' => $depositAddress];
        if ($depositMemo) {
            $queryParams['depositMemo'] = $depositMemo;
        }

        $response = Http::withHeaders([
            'X-API-Key' => $this->jwt,
            'Authorization' => "Bearer {$this->jwt}",
        ])->get($url, $queryParams);

        if ($response->failed()) {
            Log::error('OneClick status check failed', [
                'status' => $response->status(),
                'body' => $response->body(),
                'depositAddress' => $depositAddress,
            ]);

            throw new Exception("1Click API status error ({$response->status()}): {$response->body()}");
        }

        return $this->normalizeStatusResponse($response->json(), $depositAddress);
    }

    /**
     * Normalize the live 1Click status into the flat shape the jobs expect.
     * Live API (verified 2026-11-07) returns {status, swapDetails: {...},
     * quoteResponse, correlationId, updatedAt} — tx hashes live in
     * swapDetails.originChainTxHashes / destinationChainTxHashes.
     */
    protected function normalizeStatusResponse(array $json, string $depositAddress): array
    {
        if (!isset($json['swapDetails']) || !is_array($json['swapDetails'])) {
            return $json;
        }

        $details = $json['swapDetails'];

        return [
            'status' => $json['status'] ?? 'PENDING',
            'depositAddress' => $depositAddress,
            'depositTxHash' => $details['originChainTxHashes'][0] ?? null,
            'settledTxHash' => $details['destinationChainTxHashes'][0] ?? null,
            'amountIn' => $details['amountIn'] ?? null,
            'amountOut' => $details['amountOut'] ?? null,
            'amountInUsd' => $details['amountInUsd'] ?? null,
            'amountOutUsd' => $details['amountOutUsd'] ?? null,
            'isStub' => false,
            'raw' => $json,
        ];
    }

    /**
     * Normalize an origin asset ID to the form the live 1Click API accepts.
     * The checkout UI sends EVM-style IDs (erc20:base:0x...); the live API
     * only accepts the nep141 omft form for those tokens. The legacy
     * `solana:native` / `arbitrum:native` IDs are likewise rejected
     * ("tokenIn is not valid", verified live 2026-11-12) — the live
     * /v0/tokens IDs are the nep141 omft forms. Anything else passes
     * through untouched.
     */
    protected function normalizeOriginAsset(?string $asset): ?string
    {
        if ($asset === null) {
            return null;
        }
        $legacyNative = [
            'solana:native' => 'nep141:sol.omft.near',
            'arbitrum:native' => 'nep141:arb.omft.near',
        ];
        if (isset($legacyNative[$asset])) {
            return $legacyNative[$asset];
        }
        if (preg_match('/^erc20:([a-z0-9]+):(0x[a-fA-F0-9]{40})$/', $asset, $m)) {
            return 'nep141:' . $m[1] . '-' . strtolower($m[2]) . '.omft.near';
        }
        return $asset;
    }

    /**
     * Deterministic stub quote for local development, CI, and test mode.
     */
    protected function getStubQuote(array $params): array
    {
        $depositAsset = $params['originAsset'] ?? 'nep141:wrap.near';
        $destinationAsset = $params['destinationAsset'] ?? 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
        $amountIn = $params['amount'] ?? '5000000';
        $amountOut = $params['amountOut'] ?? $amountIn;
        $recipient = $params['recipient'] ?? '0x5C10a12345678901234567890123456789012345';
        $quoteId = 'stub_quote_' . bin2hex(random_bytes(8));
        $depositAddress = '0x' . hash('sha256', $quoteId . $recipient);

        // Remember the quote on this instance: its first status poll
        // reports PENDING_DEPOSIT, like a fresh live quote.
        $this->stubQuotedAddresses[$depositAddress] = 0;

        return [
            'quoteId' => $quoteId,
            'depositAddress' => $depositAddress,
            'originAsset' => $depositAsset,
            'destinationAsset' => $destinationAsset,
            'amountIn' => (string) $amountIn,
            'amountOut' => (string) $amountOut,
            'recipient' => $recipient,
            'status' => 'PENDING_DEPOSIT',
            'isStub' => true,
        ];
    }

    /**
     * Stateful stub status for testing.
     *
     * An address quoted through THIS instance reports PENDING_DEPOSIT on
     * its first poll — a fresh quote has no deposit yet, like the live
     * API — and SUCCESS on later polls, simulating the deposit landing
     * between polls. An address this instance never quoted reports
     * SUCCESS, preserving the stub's long-standing behavior for the job
     * chain (each job resolves a fresh service instance, and under the
     * sync queue driver WatchSettlement gets exactly one poll).
     */
    protected function getStubStatus(string $depositAddress): array
    {
        if (array_key_exists($depositAddress, $this->stubQuotedAddresses)) {
            $polls = $this->stubQuotedAddresses[$depositAddress];
            $this->stubQuotedAddresses[$depositAddress] = $polls + 1;

            if ($polls === 0) {
                return [
                    'depositAddress' => $depositAddress,
                    'status' => 'PENDING_DEPOSIT',
                    'depositTxHash' => null,
                    'settledTxHash' => null,
                    'isStub' => true,
                ];
            }
        }

        return [
            'depositAddress' => $depositAddress,
            'status' => 'SUCCESS',
            'depositTxHash' => '0x' . hash('sha256', "deposit_{$depositAddress}"),
            'settledTxHash' => '0x' . hash('sha256', "settled_{$depositAddress}"),
            'isStub' => true,
        ];
    }
}
