<?php

namespace App\Http\Controllers;

use App\Models\Work;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Inertia\Inertia;
use Inertia\Response;

class WorkController extends Controller
{
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
     * Accept a scholar manuscript upload and create the catalog work.
     *
     * KNOWN LIMITATION (Phase 1 slice 1): the scholar_address is asserted,
     * not proven — no wallet-signature verification yet. The next slice adds
     * signed-message auth before this endpoint is trusted for attribution.
     * Mitigations in this slice: strict validation, a 25 MB size cap, an
     * allow-list of manuscript file types, and storage on the non-public
     * local disk (never under public/).
     */
    public function store(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'title' => 'required|string|max:255',
            'slug' => 'nullable|string|alpha_dash|max:255|unique:works,slug',
            'scholar_address' => ['required', 'string', 'regex:/^0x[a-fA-F0-9]{40}$/'],
            'scholar_name' => 'nullable|string|max:255',
            'description' => 'nullable|string|max:5000',
            'file' => 'required|file|max:25600|mimes:pdf,epub,txt,md',
            'tiers' => 'nullable|array',
            'tiers.read' => 'nullable|numeric|min:0',
            'tiers.citation' => 'nullable|numeric|min:0',
            'tiers.commercial' => 'nullable|numeric|min:0',
            'terms' => 'nullable|array',
            'terms.read' => 'nullable|string|max:2000',
            'terms.citation' => 'nullable|string|max:2000',
            'terms.commercial' => 'nullable|string|max:2000',
        ]);

        $slug = $validated['slug'] ?? $this->uniqueSlug($validated['title']);
        $file = $request->file('file');

        // Fingerprint the uploaded bytes before storing. content_hash is the
        // true fingerprint; work_id stays slug-derived to match the existing
        // catalog convention and the on-chain registry design.
        $contentHash = '0x' . hash_file('sha256', $file->getRealPath());
        $filePath = $file->store('works', 'local');

        $work = Work::create([
            'work_id' => '0x' . hash('sha256', 'manuscript-' . $slug),
            'content_hash' => $contentHash,
            'file_path' => $filePath,
            'title' => $validated['title'],
            'slug' => $slug,
            'scholar_name' => $validated['scholar_name'] ?? null,
            'scholar_address' => $validated['scholar_address'],
            // Until an IPFS/metadata pipeline lands, the shareable work page
            // is the metadata surface — and the URI registerWork would anchor.
            'metadata_uri' => url('/work/' . $slug),
            'description' => $validated['description'] ?? null,
            'tiers' => [
                // Cast: form posts arrive as numeric strings; the catalog
                // convention is floats (see DatabaseSeeder).
                'read' => (float) ($validated['tiers']['read'] ?? 10.00),
                'citation' => (float) ($validated['tiers']['citation'] ?? 25.00),
                'commercial' => (float) ($validated['tiers']['commercial'] ?? 150.00),
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
