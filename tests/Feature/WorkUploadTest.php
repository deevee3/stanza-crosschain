<?php

namespace Tests\Feature;

use App\Models\Work;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Inertia\Testing\AssertableInertia as Assert;
use Tests\TestCase;

class WorkUploadTest extends TestCase
{
    use RefreshDatabase;

    protected string $scholarAddress = '0x5C10a12345678901234567890123456789012345';

    public function test_upload_creates_work_with_content_hash_and_stored_file(): void
    {
        Storage::fake('local');

        $file = UploadedFile::fake()->create('manuscript.pdf', 100, 'application/pdf');
        $expectedHash = '0x' . hash_file('sha256', $file->getRealPath());

        $response = $this->post('/api/works', [
            'title' => 'A Study of Cross-Chain Licensing',
            'scholar_address' => $this->scholarAddress,
            'scholar_name' => 'Prof. Katherine Vance',
            'description' => 'A study of cross-chain licensing mechanics.',
            'file' => $file,
        ]);

        $response->assertCreated();
        $response->assertJsonPath('slug', 'a-study-of-cross-chain-licensing');
        $response->assertJsonPath('content_hash', $expectedHash);
        $response->assertJsonPath('url', url('/work/a-study-of-cross-chain-licensing'));

        $work = Work::where('slug', 'a-study-of-cross-chain-licensing')->firstOrFail();
        $this->assertSame($expectedHash, $work->content_hash);
        $this->assertSame('0x' . hash('sha256', 'manuscript-a-study-of-cross-chain-licensing'), $work->work_id);
        $this->assertEquals(['read' => 10.00, 'citation' => 25.00, 'commercial' => 150.00], $work->tiers);
        $this->assertTrue($work->is_active);
        Storage::disk('local')->assertExists($work->file_path);
    }

    public function test_upload_stores_provided_tiers_and_terms(): void
    {
        Storage::fake('local');

        $response = $this->post('/api/works', [
            'title' => 'Terms Test Manuscript',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->create('terms.pdf', 50, 'application/pdf'),
            'tiers' => ['read' => 5.00, 'citation' => 50.00, 'commercial' => 500.00],
            'terms' => [
                'read' => 'Read-only access for one human reader.',
                'citation' => 'Cite with attribution to the scholar.',
                'commercial' => 'Commercial reuse allowed with attribution.',
            ],
        ]);

        $response->assertCreated();

        $work = Work::where('slug', 'terms-test-manuscript')->firstOrFail();
        $this->assertEquals(['read' => 5.00, 'citation' => 50.00, 'commercial' => 500.00], $work->tiers);
        $this->assertSame('Read-only access for one human reader.', $work->terms['read']);
        $this->assertSame('Commercial reuse allowed with attribution.', $work->terms['commercial']);
    }

    public function test_upload_derives_unique_slug_for_duplicate_titles(): void
    {
        Storage::fake('local');

        $payload = [
            'title' => 'Duplicate Title',
            'scholar_address' => $this->scholarAddress,
            'file' => UploadedFile::fake()->create('one.pdf', 10, 'application/pdf'),
        ];

        $this->post('/api/works', $payload)->assertCreated();

        $payload['file'] = UploadedFile::fake()->create('two.pdf', 10, 'application/pdf');
        $response = $this->post('/api/works', $payload);

        $response->assertCreated();
        $response->assertJsonPath('slug', 'duplicate-title-2');
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
}
