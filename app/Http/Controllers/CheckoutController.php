<?php

namespace App\Http\Controllers;

use App\Jobs\RequestLicenseQuote;
use App\Models\License;
use App\Models\Work;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

class CheckoutController extends Controller
{
    /**
     * Render the guest-facing checkout page with active scholarly works.
     */
    public function index(): Response
    {
        $works = Work::where('is_active', true)->get();

        return Inertia::render('checkout', [
            'works' => $works,
        ]);
    }

    /**
     * Create a license request and dispatch the 1Click quote job.
     */
    public function createQuote(Request $request): JsonResponse
    {
        // The refund address must live on the ORIGIN chain: 1Click refunds
        // to refundType ORIGIN_CHAIN, and the live API rejects a refund
        // address from another chain (verified 2026-11-12: Solana origin +
        // EVM refundTo 400s "refundTo is not valid"; a NEAR refund to an
        // EVM address would be lost funds even though the quote succeeds).
        // buyer_address stays the EVM licensee recorded on Base.
        $refundRules = match ($request->input('deposit_chain')) {
            'near' => ['required', 'string', 'min:2', 'max:64', 'regex:/^(?!0x)([0-9a-f]{64}|[a-z0-9][a-z0-9_\-\.]*[a-z0-9])$/'],
            'solana' => ['required', 'string', 'regex:/^[1-9A-HJ-NP-Za-km-z]{32,44}$/'],
            default => ['nullable', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
        };

        $validated = $request->validate([
            'work_id' => 'required|exists:works,id',
            'tier' => 'required|string|in:read,citation,commercial,exclusive',
            'buyer_address' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
            'refund_address' => $refundRules,
            'deposit_asset' => 'required|string',
            'deposit_chain' => 'required|string|in:base,near,solana,arbitrum',
        ]);

        $work = Work::findOrFail($validated['work_id']);
        $tier = $validated['tier'];
        $price = $work->tierPrice($tier);

        $license = License::create([
            'work_id' => $work->id,
            'buyer_address' => $validated['buyer_address'],
            // EVM origins refund to the buyer address; NEAR/Solana refund
            // to the origin-chain address the buyer supplied.
            'refund_address' => $validated['refund_address'] ?? $validated['buyer_address'],
            'tier' => $tier,
            'price_usd' => $price,
            'deposit_asset' => $validated['deposit_asset'],
            'deposit_chain' => $validated['deposit_chain'],
            'status' => 'pending',
        ]);

        // Dispatch quote job
        RequestLicenseQuote::dispatch($license);

        $license->refresh();

        return response()->json([
            'success' => true,
            'license' => $license->load('work'),
        ]);
    }

    /**
     * Check the current live status of a license.
     */
    public function getStatus(License $license): JsonResponse
    {
        return response()->json([
            'license' => $license->load('work'),
        ]);
    }

    /**
     * Render the license lookup page.
     */
    public function lookupPage(Request $request): Response
    {
        $query = $request->input('q');
        $license = null;

        if ($query) {
            $license = License::with('work')
                ->where('deposit_tx_hash', $query)
                ->orWhere('proof_hash', $query)
                ->orWhere('settlement_tx_hash', $query)
                ->orWhere('deposit_address', $query)
                ->first();
        }

        return Inertia::render('lookup', [
            'initialQuery' => $query,
            'license' => $license,
        ]);
    }

    /**
     * JSON API lookup for deposit / tx hash resolution.
     */
    public function resolveHash(Request $request): JsonResponse
    {
        $hash = $request->input('hash');
        if (empty($hash)) {
            return response()->json(['error' => 'Query hash is required.'], 400);
        }

        $license = License::with('work')
            ->where('deposit_tx_hash', $hash)
            ->orWhere('proof_hash', $hash)
            ->orWhere('settlement_tx_hash', $hash)
            ->orWhere('deposit_address', $hash)
            ->first();

        if (!$license) {
            return response()->json([
                'found' => false,
                'message' => 'No license found matching the provided transaction or proof hash.',
            ], 404);
        }

        return response()->json([
            'found' => true,
            'license' => $license,
        ]);
    }
}
