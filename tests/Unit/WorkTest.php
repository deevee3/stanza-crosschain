<?php

namespace Tests\Unit;

use App\Models\Work;
use Tests\TestCase;

class WorkTest extends TestCase
{
    public function test_tier_price_uses_stored_price_first(): void
    {
        $work = new Work(['tiers' => ['read' => 7.50, 'exclusive' => 900.00]]);

        $this->assertSame(7.50, $work->tierPrice('read'));
        $this->assertSame(900.00, $work->tierPrice('exclusive'));
    }

    public function test_tier_price_falls_back_to_catalog_defaults(): void
    {
        $work = new Work(['tiers' => ['read' => 10.00]]);

        $this->assertSame(25.00, $work->tierPrice('citation'));
        $this->assertSame(150.00, $work->tierPrice('commercial'));
        $this->assertSame(500.00, $work->tierPrice('exclusive'));
    }

    public function test_tier_price_falls_back_to_read_default_for_unknown_tier(): void
    {
        $work = new Work(['tiers' => []]);

        $this->assertSame(10.00, $work->tierPrice('not-a-tier'));
    }

    public function test_term_for_uses_stored_terms_first(): void
    {
        $work = new Work(['terms' => ['read' => 'Custom read terms.']]);

        $this->assertSame('Custom read terms.', $work->termFor('read'));
    }

    public function test_term_for_falls_back_to_default_terms(): void
    {
        $work = new Work(['terms' => []]);

        $this->assertStringContainsString('non-commercial', $work->termFor('read'));
        $this->assertStringContainsString('attribution', $work->termFor('citation'));
        $this->assertStringContainsString('commercial', $work->termFor('commercial'));
        $this->assertStringContainsString('Exclusive', $work->termFor('exclusive'));
    }
}
