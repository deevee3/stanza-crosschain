<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * PayPal Sandbox client (Orders API v2) for the PayPal AI Hackathon slice.
 *
 * Flow (funds are HELD, never taken outright):
 *   1. createOrder() — intent AUTHORIZE, amount = the license tier price in USD.
 *      The buyer approves the order on PayPal (sandbox) via the returned
 *      approval link. No money moves yet.
 *   2. authorizeOrder() — authorizes the approved order. PayPal now HOLDS the
 *      funds. The license is NOT issued yet.
 *   3. The licensing agent runs its attestation review (see AttestationAgent).
 *      Only when the review releases the payment do we call
 *      captureAuthorization(). On a hold/failed review we call
 *      voidAuthorization() instead, so the hold is released and the buyer is
 *      never charged.
 *   4. After a successful capture, SettlePayPalLicense records the license on
 *      Base via the same MPC settlement path as the 1Click flow.
 *
 * Sandbox only by default (PAYPAL_MODE=sandbox). Live mode is never enabled
 * by this code — switching to live requires an explicit PAYPAL_MODE=live and
 * live credentials, which this hackathon build does not use.
 *
 * No credentials are ever stored in this repository. Client id/secret come
 * from the environment (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET).
 */
class PayPalService
{
    protected string $baseUrl;
    protected ?string $clientId;
    protected ?string $clientSecret;
    protected ?string $accessToken = null;

    public function __construct(
        ?string $baseUrl = null,
        ?string $clientId = null,
        ?string $clientSecret = null
    ) {
        $mode = config('services.paypal.mode', env('PAYPAL_MODE', 'sandbox'));
        $defaultBase = $mode === 'live'
            ? 'https://api-m.paypal.com'
            : 'https://api-m.sandbox.paypal.com';
        $resolvedBase = $baseUrl ?? config('services.paypal.base_url');
        // config() returns null (not the default) when the key exists but
        // PAYPAL_API_BASE is unset, so fall back explicitly — otherwise
        // every PayPal URL is relative and Guzzle rejects it.
        $this->baseUrl = rtrim($resolvedBase ?: $defaultBase, '/');
        $this->clientId = $clientId ?? config('services.paypal.client_id', env('PAYPAL_CLIENT_ID'));
        $this->clientSecret = $clientSecret ?? config('services.paypal.client_secret', env('PAYPAL_CLIENT_SECRET'));
    }

    public function isConfigured(): bool
    {
        return !empty($this->clientId) && !empty($this->clientSecret);
    }

    /**
     * OAuth2 client-credentials token for the PayPal API.
     */
    public function accessToken(): string
    {
        if ($this->accessToken !== null) {
            return $this->accessToken;
        }

        if (!$this->isConfigured()) {
            throw new Exception('PayPal is not configured: set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET.');
        }

        $response = Http::asForm()
            ->withBasicAuth($this->clientId, $this->clientSecret)
            ->post("{$this->baseUrl}/v1/oauth2/token", ['grant_type' => 'client_credentials']);

        if ($response->failed()) {
            Log::error('PayPal OAuth token request failed', ['status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal OAuth error ({$response->status()}).");
        }

        $this->accessToken = (string) $response->json('access_token');

        if ($this->accessToken === '') {
            throw new Exception('PayPal OAuth returned an empty access token.');
        }

        return $this->accessToken;
    }

    protected function authed()
    {
        return Http::withToken($this->accessToken())
            ->withHeaders(['Content-Type' => 'application/json']);
    }

    /**
     * Create an order with intent AUTHORIZE. Returns the raw PayPal order
     * payload, including id, status, and the payer approval link.
     */
    public function createOrder(float $amountUsd, string $description, string $returnUrl, string $cancelUrl): array
    {
        $response = $this->authed()->post("{$this->baseUrl}/v2/checkout/orders", [
            'intent' => 'AUTHORIZE',
            'purchase_units' => [
                [
                    'description' => $description,
                    'amount' => [
                        'currency_code' => 'USD',
                        'value' => number_format($amountUsd, 2, '.', ''),
                    ],
                ],
            ],
            'application_context' => [
                'return_url' => $returnUrl,
                'cancel_url' => $cancelUrl,
                'brand_name' => 'Stanza Cross-Chain Licensing',
                'user_action' => 'CONTINUE',
            ],
        ]);

        if ($response->failed()) {
            Log::error('PayPal create order failed', ['status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal create order error ({$response->status()}).");
        }

        return $response->json();
    }

    /** Approval link (rel=approve) from a create-order payload, or null. */
    public static function approvalUrl(array $order): ?string
    {
        foreach ($order['links'] ?? [] as $link) {
            if (($link['rel'] ?? '') === 'approve') {
                return $link['href'];
            }
        }

        return null;
    }

    /** Fetch the current state of an order. */
    public function getOrder(string $orderId): array
    {
        $response = $this->authed()->get("{$this->baseUrl}/v2/checkout/orders/{$orderId}");

        if ($response->failed()) {
            Log::error('PayPal get order failed', ['order' => $orderId, 'status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal get order error ({$response->status()}).");
        }

        return $response->json();
    }

    /**
     * Authorize an APPROVED order. Returns the authorization payload
     * (id + status, expected AUTHORIZATION.status = CREATED).
     */
    public function authorizeOrder(string $orderId): array
    {
        $response = $this->authed()->post("{$this->baseUrl}/v2/checkout/orders/{$orderId}/authorize", new \stdClass());

        if ($response->failed()) {
            Log::error('PayPal authorize order failed', ['order' => $orderId, 'status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal authorize order error ({$response->status()}).");
        }

        return $response->json();
    }

    /**
     * Capture a previously created authorization. This is the moment money
     * actually moves — it is only called after the attestation review
     * releases the payment.
     */
    public function captureAuthorization(string $authorizationId, ?float $amountUsd = null): array
    {
        $body = new \stdClass();
        if ($amountUsd !== null) {
            $body = [
                'amount' => [
                    'currency_code' => 'USD',
                    'value' => number_format($amountUsd, 2, '.', ''),
                ],
                'final_capture' => true,
            ];
        }

        $response = $this->authed()->post("{$this->baseUrl}/v2/payments/authorizations/{$authorizationId}/capture", $body);

        if ($response->failed()) {
            Log::error('PayPal capture authorization failed', ['authorization' => $authorizationId, 'status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal capture error ({$response->status()}).");
        }

        return $response->json();
    }

    /** Release a held authorization without capturing it. */
    public function voidAuthorization(string $authorizationId): array
    {
        $response = $this->authed()->post("{$this->baseUrl}/v2/payments/authorizations/{$authorizationId}/void", new \stdClass());

        if ($response->failed()) {
            Log::error('PayPal void authorization failed', ['authorization' => $authorizationId, 'status' => $response->status(), 'body' => $response->body()]);
            throw new Exception("PayPal void error ({$response->status()}).");
        }

        // PayPal void returns 204 No Content: json() is null, so fall back to [].
        return $response->json() ?? [];
    }
}
