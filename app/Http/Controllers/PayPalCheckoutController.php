<?php

namespace App\Http\Controllers;

use App\Jobs\SettlePayPalLicense;
use App\Models\License;
use App\Models\Work;
use App\Services\PayPalService;
use Exception;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Inertia\Inertia;
use Inertia\Response;

/**
 * PayPal checkout for the PayPal AI Hackathon slice.
 *
 * The buyer picks a manuscript + tier and pays with PayPal (Sandbox).
 * The money is HELD, not taken: the order is created with intent
 * AUTHORIZE, the buyer approves it on PayPal, we authorize it (funds held),
 * the attestation agent reviews the license, and only on release do we
 * capture. A hold voids the authorization — the buyer is never charged.
 *
 * Endpoints:
 *   POST /api/paypal/order  — create the license + PayPal order, return the
 *                             approval URL the browser redirects to.
 *   GET  /paypal/return     — PayPal sends the buyer back here after approval
 *                             (?token=<orderId>&license=<id>). We authorize
 *                             the order, mark the license 'authorized', and
 *                             dispatch SettlePayPalLicense (review → capture
 *                             → on-chain record). Then redirect to checkout
 *                             with the license loaded.
 *   GET  /paypal/cancel     — buyer cancelled on PayPal; mark failed, back
 *                             to checkout.
 *
 * If PayPal is not configured (no sandbox credentials), order creation
 * returns 503 paypal_not_configured — the form must show "not online yet",
 * never a fake success.
 */
class PayPalCheckoutController extends Controller
{
    /**
     * Create a PayPal license request + PayPal AUTHORIZE order.
     */
    public function createOrder(Request $request, PayPalService $paypal): JsonResponse
    {
        if (!$paypal->isConfigured()) {
            return response()->json(['ok' => false, 'error' => 'paypal_not_configured'], 503);
        }

        $validated = $request->validate([
            'work_id' => 'required|exists:works,id',
            'tier' => 'required|string|in:read,citation,commercial',
            'buyer_address' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
        ]);

        $work = Work::findOrFail($validated['work_id']);
        $tier = $validated['tier'];
        $price = (float) ($work->tiers[$tier] ?? 10.00);

        $license = License::create([
            'work_id' => $work->id,
            'buyer_address' => $validated['buyer_address'],
            'tier' => $tier,
            'price_usd' => $price,
            'payment_method' => 'paypal',
            'deposit_asset' => 'USD',
            'deposit_chain' => 'paypal',
            'status' => 'pending',
        ]);

        $returnUrl = route('paypal.return', ['license' => $license->id], true);
        $cancelUrl = route('paypal.cancel', ['license' => $license->id], true);

        try {
            $order = $paypal->createOrder(
                $price,
                "STANZA license — {$work->title} ({$tier} tier)",
                $returnUrl,
                $cancelUrl
            );
        } catch (Exception $e) {
            $license->update(['status' => 'failed', 'error_message' => $e->getMessage()]);
            Log::error("PayPal order creation failed for license #{$license->id}", ['error' => $e->getMessage()]);

            return response()->json(['ok' => false, 'error' => 'paypal_order_failed'], 502);
        }

        $orderId = $order['id'] ?? null;
        $approveUrl = PayPalService::approvalUrl($order);

        if ($orderId === null || $approveUrl === null) {
            $license->update(['status' => 'failed', 'error_message' => 'PayPal returned an order without an approval link.']);

            return response()->json(['ok' => false, 'error' => 'paypal_order_failed'], 502);
        }

        $license->update(['paypal_order_id' => $orderId]);

        return response()->json([
            'ok' => true,
            'license' => $license->load('work'),
            'paypal_order_id' => $orderId,
            'approve_url' => $approveUrl,
        ]);
    }

    /**
     * PayPal return URL: buyer approved the order on PayPal. Authorize it
     * (funds held), then hand off to the settle job (review → capture →
     * on-chain record). Redirects to checkout showing the license status.
     */
    public function return(Request $request, PayPalService $paypal): Response
    {
        $licenseId = (int) $request->query('license', 0);
        $orderId = (string) $request->query('token', '');
        $license = License::findOrFail($licenseId);

        if ($license->paypal_order_id !== $orderId) {
            $license->update(['status' => 'failed', 'error_message' => 'PayPal return token does not match this license.']);
        } elseif ($license->status === 'settled' || $license->status === 'captured') {
            // Already handled (e.g. double return) — do not authorize twice.
            Log::info("PayPal return for license #{$license->id} already {$license->status}; skipping.");
        } else {
            try {
                $auth = $paypal->authorizeOrder($orderId);
                $authorizationId = $this->findAuthorizationId($auth);

                if ($authorizationId === null) {
                    throw new Exception('PayPal authorize returned no authorization id.');
                }

                $license->update([
                    'status' => 'authorized',
                    'paypal_authorization_id' => $authorizationId,
                ]);

                SettlePayPalLicense::dispatch($license);
            } catch (Exception $e) {
                $license->update(['status' => 'failed', 'error_message' => $e->getMessage()]);
                Log::error("PayPal authorize failed for license #{$license->id}", ['error' => $e->getMessage()]);
            }
        }

        return Inertia::render('checkout', [
            'works' => Work::where('is_active', true)->get(),
            'returnLicenseId' => $license->id,
        ]);
    }

    /**
     * PayPal cancel URL: buyer cancelled on PayPal. Nothing was authorized,
     * nothing was charged.
     */
    public function cancel(Request $request): Response
    {
        $licenseId = (int) $request->query('license', 0);
        $license = License::findOrFail($licenseId);
        $license->update(['status' => 'failed', 'error_message' => 'Buyer cancelled the PayPal approval.']);

        return Inertia::render('checkout', [
            'works' => Work::where('is_active', true)->get(),
            'returnLicenseId' => $license->id,
        ]);
    }

    /** Pull the first authorization id out of an authorize-order payload. */
    protected function findAuthorizationId(array $auth): ?string
    {
        foreach ($auth['purchase_units'] ?? [] as $unit) {
            foreach ($unit['payments']['authorizations'] ?? [] as $authorization) {
                if (!empty($authorization['id'])) {
                    return (string) $authorization['id'];
                }
            }
        }

        return null;
    }
}
