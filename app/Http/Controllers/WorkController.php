<?php

namespace App\Http\Controllers;

use App\Models\Work;
use App\Services\EthereumSignatureService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class WorkController extends Controller
{
    /**
     * Display the scholar manuscript upload page.
     */
    public function create(): Response
    {
        return Inertia::render('upload', [
            'tierDefaults' => Work::TIER_DEFAULTS,
            'defaultTerms' => Work::DEFAULT_TERMS,
        ]);
    }

    /**
     * Display the shareable, guest-facing work page.
     */
    public function show(string $slug): Response
    {
        $work = Work::where('slug', $slug)->where('is_active', true)->firstOrFail();

        return Inertia::render('work', [
            'work' => $work,
        ]);
    }

    /**
     * Issue a one-time upload challenge for a scholar address. The scholar
     * signs the returned message with the wallet that will own the work
     * (EIP-191 personal_sign) and posts the signature with the upload.
     * Challenges live 10 minutes and are single-use.
     */
    public function challenge(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'address' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
        ]);

        $address = strtolower($validated['address']);
        $nonce = bin2hex(random_bytes(16));

        $message = "STANZA upload authorization\n\nScholar: {$address}\nNonce: {$nonce}\n\nSign to prove you control this wallet. This does not move funds.";

        Cache::put($this->challengeKey($address, $nonce), true, now()->addMinutes(10));

        return response()->json([
            'message' => $message,
            'nonce' => $nonce,
            'expires_in_seconds' => 600,
        ]);
    }

    /**
     * Accept a scholar manuscript upload and create the catalog work.
     *
     * Attribution is PROVEN, not asserted: the request must carry the
     * challenge message and an EIP-191 signature from the scholar_address
     * wallet. The challenge is single-use (consumed on verification) and
     * expires after 10 minutes.
     *
     * The work fingerprint is keccak256 of the uploaded file bytes, and
     * the work_id IS that fingerprint — the same bytes always map to the
     * same work, so a duplicate upload returns 409 with the existing
     * work instead of a second catalog entry. On-chain registration of
     * new uploads happens via scripts/mpc-register.cjs (batched, manual),
     * the same path that registered the seeded works.
     *
     * Mitigations: strict validation, a 25 MB size cap, an allow-list of
     * manuscript file types, and storage on the non-public local disk
     * (never under public/).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'slug' => 'nullable|string|alpha_dash|max:255|unique:works,slug',
            'scholar_address' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
            'scholar_name' => 'nullable|string|max:255',
            'scholar_email' => 'nullable|string|email|max:255',
            'description' => 'nullable|string|max:5000',
            'file' => 'required|file|max:25600|mimes:pdf,epub,txt,md',
            'tiers' => 'nullable|array',
            'tiers.read' => 'nullable|numeric|min:0',
            'tiers.citation' => 'nullable|numeric|min:0',
            'tiers.commercial' => 'nullable|numeric|min:0',
            'tiers.exclusive' => 'nullable|numeric|min:0',
            'terms' => 'nullable|array',
            'terms.read' => 'nullable|string|max:2000',
            'terms.citation' => 'nullable|string|max:2000',
            'terms.commercial' => 'nullable|string|max:2000',
            'terms.exclusive' => 'nullable|string|max:2000',
            'challenge_message' => 'required|string|max:1000',
            'signature' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{130}$/'],
        ]);

        $scholarAddress = strtolower($validated['scholar_address']);

        if (!$this->verifyChallenge($scholarAddress, $validated['challenge_message'], $validated['signature'])) {
            return response()->json([
                'message' => 'Upload authorization failed: the signature does not prove control of the scholar wallet, or the challenge expired. Request a fresh challenge and sign it with the scholar wallet.',
            ], 403);
        }

        $slug = $validated['slug'] ?? $this->uniqueSlug($validated['title']);
        $file = $request->file('file');

        // Fingerprint the uploaded bytes before storing. The fingerprint
        // (keccak256) is both the content hash and the work_id, so the
        // on-chain work identity is bound to the file itself.
        $contentHash = EthereumSignatureService::keccak256Hex(file_get_contents($file->getRealPath()));

        $existing = Work::where('content_hash', $contentHash)->first();
        if ($existing) {
            return response()->json([
                'message' => 'This file is already registered as a work.',
                'slug' => $existing->slug,
                'url' => url('/work/' . $existing->slug),
                'work_id' => $existing->work_id,
            ], 409);
        }

        $filePath = $file->store('works', 'local');

        $work = Work::create([
            'work_id' => $contentHash,
            'content_hash' => $contentHash,
            'file_path' => $filePath,
            'title' => $validated['title'],
            'slug' => $slug,
            'scholar_name' => $validated['scholar_name'] ?? null,
            'scholar_address' => $validated['scholar_address'],
            'scholar_email' => $validated['scholar_email'] ?? null,
            // Until an IPFS/metadata pipeline lands, the shareable work page
            // is the metadata surface — and the URI registerWork would anchor.
            'metadata_uri' => url('/work/' . $slug),
            'description' => $validated['description'] ?? null,
            'tiers' => [
                // Cast: form posts arrive as numeric strings; the catalog
                // convention is floats (see DatabaseSeeder).
                'read' => (float) ($validated['tiers']['read'] ?? Work::TIER_DEFAULTS['read']),
                'citation' => (float) ($validated['tiers']['citation'] ?? Work::TIER_DEFAULTS['citation']),
                'commercial' => (float) ($validated['tiers']['commercial'] ?? Work::TIER_DEFAULTS['commercial']),
                'exclusive' => (float) ($validated['tiers']['exclusive'] ?? Work::TIER_DEFAULTS['exclusive']),
            ],
            'terms' => $validated['terms'] ?? null,
            'is_active' => true,
        ]);

        return response()->json([
            'id' => $work->id,
            'work_id' => $work->work_id,
            'slug' => $work->slug,
            'url' => url('/work/' . $work->slug),
            'content_hash' => $work->content_hash,
        ], 201);
    }

    /**
     * Verify an upload challenge: the message must name this scholar and
     * carry a live, single-use nonce, and the signature must recover to
     * the scholar address. The nonce is consumed (deleted) on first use,
     * whether verification succeeds or fails, so a challenge can never be
     * replayed.
     */
    protected function verifyChallenge(string $scholarAddress, string $message, string $signature): bool
    {
        if (!preg_match('/^Scholar: (0x[a-fA-F0-9]{40})$/m', $message, $scholarMatch)) {
            return false;
        }
        if (strtolower($scholarMatch[1]) !== $scholarAddress) {
            return false;
        }
        if (!preg_match('/^Nonce: ([0-9a-f]{32})$/m', $message, $nonceMatch)) {
            return false;
        }

        $consumed = Cache::pull($this->challengeKey($scholarAddress, $nonceMatch[1]));
        if (!$consumed) {
            return false;
        }

        return EthereumSignatureService::verify($message, $signature, $scholarAddress);
    }

    protected function challengeKey(string $address, string $nonce): string
    {
        return "upload-challenge:{$address}:{$nonce}";
    }

    /**
     * Derive a unique slug from a title, appending a counter on collision.
     */
    protected function uniqueSlug(string $title): string
    {
        $base = Str::slug($title);
        $slug = $base;
        $counter = 2;

        while (Work::where('slug', $slug)->exists()) {
            $slug = $base . '-' . $counter;
            $counter++;
        }

        return $slug;
    }
}
