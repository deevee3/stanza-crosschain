<?php

namespace App\Services;

use App\Models\License;
use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * The AI attestation agent — the AI half of the PayPal slice.
 *
 * The licensing agent holds a buyer's PayPal payment (AUTHORIZE, funds held)
 * and only releases it (capture) after this review passes. The review has
 * two layers, and the deterministic layer is authoritative:
 *
 *   1. Deterministic gates (always run, cannot be overridden): the work is
 *      active, the tier is real and its price matches the catalog, the
 *      authorized amount and currency match the tier price exactly, the
 *      buyer address is a valid EVM address, and no license for this PayPal
 *      order has already been captured or settled (replay protection).
 *      Any failure here is a HOLD, whatever the model says.
 *   2. LLM attestation review (only when an OpenAI-compatible key is
 *      configured via AI_API_KEY): the model reads the manuscript record,
 *      the license terms, and the payment evidence, and returns a JSON
 *      release/hold decision with a rationale. Its verdict is recorded on
 *      the license. When no key is configured, the agent runs in
 *      deterministic mode and says so in the stored verdict — it never
 *      pretends an LLM review happened.
 *
 * A HOLD voids the PayPal authorization (the buyer is never charged) and
 * the license is marked failed with the reason. A RELEASE lets
 * SettlePayPalLicense capture the authorization and record the license.
 */
class AttestationAgent
{
    protected ?string $apiKey;
    protected string $baseUrl;
    protected string $model;

    public function __construct(
        ?string $apiKey = null,
        ?string $baseUrl = null,
        ?string $model = null
    ) {
        $this->apiKey = $apiKey ?? config('services.ai.api_key', env('AI_API_KEY'));
        $this->baseUrl = rtrim($baseUrl ?? config('services.ai.base_url', env('AI_API_BASE_URL', 'https://api.openai.com/v1')), '/');
        $this->model = $model ?? config('services.ai.model', env('AI_MODEL', 'gpt-4o-mini'));
    }

    public function isLlmConfigured(): bool
    {
        return !empty($this->apiKey);
    }

    /**
     * Review a PayPal payment for release.
     *
     * @param  License  $license  The license under review.
     * @param  array    $payment  Payment evidence: amount (float USD),
     *                            currency (string), order_id, authorization_id.
     * @return array{decision: string, mode: string, rationale: string, checks: array, llm_raw: ?array}
     */
    public function review(License $license, array $payment): array
    {
        $work = $license->work;
        $checks = [];
        $failed = [];

        // --- Deterministic gates (authoritative) ---
        $check = $work !== null && (bool) $work->is_active;
        $checks[] = ['name' => 'work_active', 'pass' => $check];
        if (!$check) {
            $failed[] = 'work is missing or inactive';
        }

        $tierPrice = $work?->tiers[$license->tier] ?? null;
        $check = $tierPrice !== null && abs((float) $tierPrice - (float) $license->price_usd) < 0.005;
        $checks[] = ['name' => 'tier_price_matches_catalog', 'pass' => $check, 'catalog_price' => $tierPrice];
        if (!$check) {
            $failed[] = 'tier price does not match the catalog';
        }

        $check = strtoupper((string) ($payment['currency'] ?? '')) === 'USD'
            && abs((float) ($payment['amount'] ?? 0) - (float) $license->price_usd) < 0.005;
        $checks[] = ['name' => 'payment_amount_matches_tier', 'pass' => $check, 'amount' => $payment['amount'] ?? null];
        if (!$check) {
            $failed[] = 'authorized amount or currency does not match the tier price';
        }

        $check = (bool) preg_match('/^0x[a-fA-F0-9]{40}$/', (string) $license->buyer_address);
        $checks[] = ['name' => 'buyer_address_valid', 'pass' => $check];
        if (!$check) {
            $failed[] = 'buyer address is not a valid EVM address';
        }

        $already = License::where('paypal_order_id', $license->paypal_order_id)
            ->where('id', '!=', $license->id)
            ->whereIn('status', ['authorized', 'captured', 'settled'])
            ->exists();
        $check = !$already;
        $checks[] = ['name' => 'no_replay_for_this_order', 'pass' => $check];
        if (!$check) {
            $failed[] = 'this PayPal order already has a license in progress or settled';
        }

        if (!empty($failed)) {
            return [
                'decision' => 'hold',
                'mode' => $this->isLlmConfigured() ? 'llm+deterministic' : 'deterministic',
                'rationale' => 'Deterministic gates failed: ' . implode('; ', $failed) . '.',
                'checks' => $checks,
                'llm_raw' => null,
            ];
        }

        // --- LLM attestation review (only when configured) ---
        if (!$this->isLlmConfigured()) {
            return [
                'decision' => 'release',
                'mode' => 'deterministic',
                'rationale' => 'All deterministic gates passed. No LLM key configured, so the review ran on deterministic gates only (no model verdict).',
                'checks' => $checks,
                'llm_raw' => null,
            ];
        }

        $llm = $this->llmReview($license, $payment);

        if ($llm === null) {
            return [
                'decision' => 'release',
                'mode' => 'deterministic',
                'rationale' => 'All deterministic gates passed. The LLM review was requested but returned no usable verdict, so the release rests on deterministic gates only.',
                'checks' => $checks,
                'llm_raw' => null,
            ];
        }

        return [
            'decision' => $llm['decision'] === 'hold' ? 'hold' : 'release',
            'mode' => 'llm+deterministic',
            'rationale' => (string) ($llm['rationale'] ?? 'LLM attestation review completed.'),
            'checks' => $checks,
            'llm_raw' => $llm,
        ];
    }

    /**
     * Ask the configured LLM for a release/hold verdict. Returns the parsed
     * JSON verdict, or null when the call fails or the reply is unusable.
     */
    protected function llmReview(License $license, array $payment): ?array
    {
        $work = $license->work;

        $payload = [
            'work_title' => $work?->title,
            'work_id' => $work?->work_id,
            'scholar' => $work?->scholar_name,
            'scholar_address' => $work?->scholar_address,
            'metadata_uri' => $work?->metadata_uri,
            'tier' => $license->tier,
            'tier_price_usd' => (float) $license->price_usd,
            'buyer_address' => $license->buyer_address,
            'paypal_order_id' => $license->paypal_order_id,
            'paypal_authorization_id' => $license->paypal_authorization_id,
            'authorized_amount_usd' => (float) ($payment['amount'] ?? 0),
            'authorized_currency' => $payment['currency'] ?? null,
        ];

        try {
            $response = Http::withToken($this->apiKey)
                ->withHeaders(['Content-Type' => 'application/json'])
                ->timeout(30)
                ->post("{$this->baseUrl}/chat/completions", [
                    'model' => $this->model,
                    'response_format' => ['type' => 'json_object'],
                    'messages' => [
                        [
                            'role' => 'system',
                            'content' => 'You are the attestation reviewer for a scholarly licensing agent. A buyer paid via PayPal (funds held, not yet captured) to license a manuscript. The deterministic checks already passed: the work is active, the tier price matches the catalog, the authorized amount matches the tier price, the buyer address is valid, and there is no replay. Your job: review the license terms against the manuscript record and decide whether the payment may be released. HOLD only when two specific field values in the payload contradict each other, and quote both values in your rationale. The buyer and the scholar are different parties, so buyer_address and scholar_address are expected to differ. A name cannot be checked against an address from these fields alone, so never hold on name/address matching. Punctuation in a title, a title that cites or replicates another work, and a metadata URI pointing at a public repository are NOT inconsistencies and are never a reason to hold. If no two field values contradict each other, RELEASE. Reply with JSON only: {"decision": "release" | "hold", "rationale": "...", "checks": ["..."]}.',
                        ],
                        [
                            'role' => 'user',
                            'content' => json_encode($payload),
                        ],
                    ],
                ]);

            if ($response->failed()) {
                Log::warning('Attestation LLM call failed', ['status' => $response->status(), 'body' => $response->body()]);

                return null;
            }

            $content = $response->json('choices.0.message.content');
            if (!is_string($content) || $content === '') {
                return null;
            }

            $parsed = json_decode($content, true);
            if (!is_array($parsed) || !in_array($parsed['decision'] ?? null, ['release', 'hold'], true)) {
                Log::warning('Attestation LLM returned an unusable verdict', ['content' => $content]);

                return null;
            }

            return $parsed;
        } catch (Exception $e) {
            Log::warning('Attestation LLM call threw', ['error' => $e->getMessage()]);

            return null;
        }
    }
}
