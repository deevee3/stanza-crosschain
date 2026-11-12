<?php

use App\Models\Work;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Backfill the exclusive tier into every work whose tiers JSON lacks
     * it, at the catalog default. The tiers column is per-work JSON, so
     * the seeder change alone would leave the live catalog on three
     * tiers; this migration carries the live rows forward.
     */
    public function up(): void
    {
        Work::query()->chunkById(100, function ($works) {
            foreach ($works as $work) {
                $tiers = $work->tiers ?? [];
                if (!array_key_exists('exclusive', $tiers)) {
                    $tiers['exclusive'] = Work::TIER_DEFAULTS['exclusive'];
                    DB::table('works')->where('id', $work->id)->update([
                        'tiers' => json_encode($tiers),
                    ]);
                }
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Work::query()->chunkById(100, function ($works) {
            foreach ($works as $work) {
                $tiers = $work->tiers ?? [];
                if (array_key_exists('exclusive', $tiers)) {
                    unset($tiers['exclusive']);
                    DB::table('works')->where('id', $work->id)->update([
                        'tiers' => json_encode($tiers),
                    ]);
                }
            }
        });
    }
};
