<?php

namespace Tests\Feature;

use App\Models\Work;
use App\Services\EthereumSignatureService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class WorkUploadTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Private key 0x01 recovers to this address (verified against cast).
     * Uploads are signed with this key, so the scholar address must match.
     */
    protected string $testPrivateKey = '0x0000000000000000000000000000000000000000000000000000000000000001';

    protected string $scholarAddress = '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf';

    /**
     * Get a fresh upload challenge for the scholar address and sign it
     * with the test key. Returns the auth fields for POST /api/works.
     */
    protected function signedAuth(?string $address = null): array
    {
        $address ??= $this->scholarAddress;

        $challenge = $this->getJson('/api/upload-challenge?address=' . $address);
        $challenge->assertOk();
        $message = $challenge->json('message');

        return [
            'challenge_message' => $message,
            'signature' => EthereumSignatureService::sign($this->testPrivateKey, $message),
        ];
    }

    public function test_upload_creates_work_with_content_hash_and_stored_file(): void
    {
        Storage::fake('local');

        $content = 'A study of cross-chain licensing mechanics. Version one.';
        $file = UploadedFile::fake()->createWithContent('manuscript.txt', $content);
        $expectedHash = EthereumSignatureService::keccak256Hex($content);

        $response = $this->post('/api/works', array_merge([
            'title' => 'A Study of Cross-Chain Licensing',
            'scholar_address' => $this->scholarAddress,
            'scholar_name' => 'Prof. Katherine Vance',
            'description' => 'A study of cross-chain licensing mechanics.',
            'file' => $file,
        ], $this->signedAuth()));

        $response->assertCreated();
        $response->assertJsonPath('slug', 'a-study-of-cross-chain-licensing');
        $response->assertJsonPath('content_hash', $expectedHash);
        $response->assertJsonPath('work_id', $expectedHash);
        $response->assertJsonPath('url', url('/work/a-study-of-cross-chain-licensing'));

        $work = Work::where('slug', 'a-study-of-cross-chain-licensing')->firstOrFail();
        $this->assertSame($expectedHash, $work->content_hash);
        $this->assertSame($expectedHash, $work->work_id);
        $this->assertEquals(['read' => 10.00, 'citation' => 25.00, 'commercial' => 150.00, 'exclusive' => 500.00], $work->tiers);
        $this->assertTrue($work->is_active);
        Storage::disk('local')->assertExists($work->file_path);
    }

    public function test_upload_stores_provided_tiers_and_terms(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', array_merge([
            'title' => 'Terms Test Manuscript',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('terms.txt', 'Terms test manuscript bytes.'),
            'tiers' => ['read' => 5.00, 'citation' => 50.00, 'commercial' => 500.00, 'exclusive' => 900.00],
            'terms' => [
                'read' => 'Read-only access for one human reader.',
                'citation' => 'Cite with attribution to the scholar.',
                'commercial' => 'Commercial reuse allowed with attribution.',
                'exclusive' => 'Sole commercial reuse for one year.',
            ],
        ], $this->signedAuth()));

        $response->assertCreated();

        $work = Work::where('slug', 'terms-test-manuscript')->firstOrFail();
        $this->assertEquals(['read' => 5.00, 'citation' => 50.00, 'commercial' => 500.00, 'exclusive' => 900.00], $work->tiers);
        $this->assertSame('Read-only access for one human reader.', $work->terms['read']);
        $this->assertSame('Commercial reuse allowed with attribution.', $work->terms['commercial']);
        $this->assertSame('Sole commercial reuse for one year.', $work->terms['exclusive']);
    }

    public function test_upload_derives_unique_slug_for_duplicate_titles(): void
    {
        Storage::fake('local');

        $payload = [
            'title' => 'Duplicate Title',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('one.txt', 'First manuscript with this title.'),
        ];

        $this->post('/api/works', array_merge($payload, $this->signedAuth()))->assertCreated();

        $payload['file'] = UploadedFile::fake()->createWithContent('two.txt', 'Second, different manuscript with this title.');
        $response = $this->post('/api/works', array_merge($payload, $this->signedAuth()));

        $response->assertCreated();
        $response->assertJsonPath('slug', 'duplicate-title-2');
    }

    public function test_upload_rejects_duplicate_file_bytes(): void
    {
        Storage::fake('local');

        $content = 'The same manuscript bytes, uploaded twice.';
        $payload = [
            'title' => 'Original Upload',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('original.txt', $content),
        ];

        $this->post('/api/works', array_merge($payload, $this->signedAuth()))->assertCreated();

        $payload['title'] = 'Second Upload Of The Same File';
        $payload['file'] = UploadedFile::fake()->createWithContent('copy.txt', $content);
        $response = $this->post('/api/works', array_merge($payload, $this->signedAuth()), ['Accept' => 'application/json']);

        $response->assertConflict();
        $response->assertJsonPath('slug', 'original-upload');
        $response->assertJsonPath('url', url('/work/original-upload'));
        $this->assertSame(1, Work::count());
    }

    public function test_upload_requires_signature_fields(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', [
            'title' => 'No Signature',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('nosig.txt', 'Unsigned upload bytes.'),
        ], ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['challenge_message', 'signature']);
        $this->assertSame(0, Work::count());
    }

    public function test_upload_rejects_signature_from_different_wallet(): void
    {
        Storage::fake('local');

        // Challenge issued for the scholar address, but signed with a
        // different key (0x02) — the recovered address won't match.
        $challenge = $this->getJson('/api/upload-challenge?address=' . $this->scholarAddress);
        $message = $challenge->json('message');
        $wrongKey = '0x0000000000000000000000000000000000000000000000000000000000000002';

        $response = $this->post('/api/works', [
            'title' => 'Wrong Wallet',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('wrong.txt', 'Wrong-wallet upload bytes.'),
            'challenge_message' => $message,
            'signature' => EthereumSignatureService::sign($wrongKey, $message),
        ], ['Accept' => 'application/json']);

        $response->assertForbidden();
        $this->assertSame(0, Work::count());
    }

    public function test_upload_rejects_replayed_challenge(): void
    {
        Storage::fake('local');

        $auth = $this->signedAuth();
        $payload = [
            'title' => 'First Use Of Challenge',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('first.txt', 'First use bytes.'),
        ];

        $this->post('/api/works', array_merge($payload, $auth))->assertCreated();

        // Same challenge message + signature, second time: the nonce was
        // consumed by the first upload.
        $payload['title'] = 'Replay Attempt';
        $payload['file'] = UploadedFile::fake()->createWithContent('replay.txt', 'Different bytes, replayed auth.');
        $response = $this->post('/api/works', array_merge($payload, $auth), ['Accept' => 'application/json']);

        $response->assertForbidden();
        $this->assertSame(1, Work::count());
    }

    public function test_upload_rejects_expired_challenge(): void
    {
        Storage::fake('local');

        $auth = $this->signedAuth();
        $this->travel(11)->minutes();

        $response = $this->post('/api/works', [
            'title' => 'Expired Challenge',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('expired.txt', 'Expired-challenge bytes.'),
            'challenge_message' => $auth['challenge_message'],
            'signature' => $auth['signature'],
        ], ['Accept' => 'application/json']);

        $response->assertForbidden();
        $this->assertSame(0, Work::count());
    }

    public function test_upload_rejects_oversized_file(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', [
            'title' => 'Too Big',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->create('big.pdf', 26000, 'application/pdf'),
        ], ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('file');
        $this->assertSame(0, Work::count());
    }

    public function test_upload_rejects_disallowed_file_type(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', [
            'title' => 'Not A Manuscript',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->create('photo.png', 10, 'image/png'),
        ], ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('file');
        $this->assertSame(0, Work::count());
    }

    public function test_upload_rejects_invalid_scholar_address(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', [
            'title' => 'Bad Address',
            'scholar_address' => 'not-an-address',
            'file' => UploadedFile::fake()->create('doc.pdf', 10, 'application/pdf'),
        ], ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('scholar_address');
        $this->assertSame(0, Work::count());
    }

    public function test_upload_requires_a_file(): void
    {
        $response = $this->post('/api/works', [
            'title' => 'No File',
            'scholar_address' => $this->scholarAddress,
        ], ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors('file');
        $this->assertSame(0, Work::count());
    }

    public function test_work_page_renders_for_known_slug(): void
    {
        $work = Work::create([
            'work_id' => '0x' . hash('sha256', 'manuscript-work-page-test'),
            'content_hash' => '0x' . hash('sha256', 'work-page-test-bytes'),
            'title' => 'Work Page Test',
            'slug' => 'work-page-test',
            'scholar_name' => 'Prof. Katherine Vance',
            'scholar_address' => $this->scholarAddress,
            'metadata_uri' => 'https://example.com/work-page-test',
            'description' => 'A work with a shareable page.',
            'tiers' => ['read' => 10.00, 'citation' => 25.00, 'commercial' => 150.00],
            'terms' => ['read' => 'Read-only access.'],
            'is_active' => true,
        ]);

        $response = $this->get('/work/work-page-test');

        $response->assertStatus(200);
        $response->assertInertia(fn (Assert $page) => $page
            ->component('work')
            ->where('work.id', $work->id)
            ->where('work.title', 'Work Page Test')
            ->where('work.content_hash', '0x' . hash('sha256', 'work-page-test-bytes'))
        );
    }

    public function test_work_page_404s_for_unknown_slug(): void
    {
        $this->get('/work/no-such-work')->assertNotFound();
    }

    public function test_work_page_404s_for_inactive_work(): void
    {
        Work::create([
            'work_id' => '0x' . hash('sha256', 'manuscript-inactive-work'),
            'title' => 'Inactive Work',
            'slug' => 'inactive-work',
            'scholar_address' => $this->scholarAddress,
            'metadata_uri' => 'https://example.com/inactive-work',
            'tiers' => ['read' => 10.00],
            'is_active' => false,
        ]);

        $this->get('/work/inactive-work')->assertNotFound();
    }

    public function test_upload_page_renders_with_tier_defaults_and_default_terms(): void
    {
        $response = $this->get('/upload');

        $response->assertStatus(200);
        $response->assertInertia(fn (Assert $page) => $page
            ->component('upload')
            ->where('tierDefaults', fn ($defaults) => $defaults->toArray() == Work::TIER_DEFAULTS)
            ->where('defaultTerms', Work::DEFAULT_TERMS)
        );
    }

    public function test_upload_flow_blank_tiers_apply_backend_defaults_and_work_url_renders(): void
    {
        Storage::fake('local');

        $content = "# Replication Study\n\nSigned scholar upload from /upload UI.";
        $file = UploadedFile::fake()->createWithContent('study.md', $content);

        $response = $this->post('/api/works', array_merge([
            'title' => 'Signed Upload UI Study',
            'slug' => 'signed-upload-ui-study',
            'scholar_address' => $this->scholarAddress,
            'scholar_name' => 'Dr. Elena Rostova',
            'scholar_email' => 'rostova@example.edu',
            'description' => 'Uploaded via the scholar upload UI flow.',
            'file' => $file,
        ], $this->signedAuth()), ['Accept' => 'application/json']);

        $response->assertCreated();
        $response->assertJsonPath('slug', 'signed-upload-ui-study');
        $response->assertJsonPath('url', url('/work/signed-upload-ui-study'));

        $work = Work::where('slug', 'signed-upload-ui-study')->firstOrFail();
        $this->assertEquals(Work::TIER_DEFAULTS, $work->tiers);
        $this->assertNull($work->terms);

        $this->get('/work/signed-upload-ui-study')->assertStatus(200);
    }

    public function test_upload_403_returns_verbatim_message_and_fresh_challenge_succeeds(): void
    {
        Storage::fake('local');

        $challenge = $this->getJson('/api/upload-challenge?address=' . $this->scholarAddress);
        $challenge->assertOk();
        $wrongKey = '0x0000000000000000000000000000000000000000000000000000000000000002';

        $forbidden = $this->post('/api/works', [
            'title' => 'Retry After Fresh Challenge',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('retry.txt', 'Manuscript bytes for fresh challenge retry.'),
            'challenge_message' => $challenge->json('message'),
            'signature' => EthereumSignatureService::sign($wrongKey, $challenge->json('message')),
        ], ['Accept' => 'application/json']);

        $forbidden->assertForbidden();
        $forbidden->assertJsonPath(
            'message',
            'Upload authorization failed: the signature does not prove control of the scholar wallet, or the challenge expired. Request a fresh challenge and sign it with the scholar wallet.'
        );

        // Requesting a fresh challenge and signing with the scholar wallet succeeds
        $retry = $this->post('/api/works', array_merge([
            'title' => 'Retry After Fresh Challenge',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->createWithContent('retry.txt', 'Manuscript bytes for fresh challenge retry.'),
        ], $this->signedAuth()), ['Accept' => 'application/json']);

        $retry->assertCreated();
        $retry->assertJsonPath('slug', 'retry-after-fresh-challenge');
    }

    public function test_upload_validates_slug_email_and_tier_constraints(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', array_merge([
            'title' => '',
            'slug' => 'invalid slug with spaces!',
            'scholar_address' => $this->scholarAddress,
            'scholar_email' => 'not-an-email',
            'file' => UploadedFile::fake()->createWithContent('valid.txt', 'Validation check bytes.'),
            'tiers' => ['read' => -5],
        ], $this->signedAuth()), ['Accept' => 'application/json']);

        $response->assertUnprocessable();
        $response->assertJsonValidationErrors(['title', 'slug', 'scholar_email', 'tiers.read']);
        $this->assertSame(0, Work::count());
    }
}
