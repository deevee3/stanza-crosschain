<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('works', function (Blueprint $table) {
            // sha256 of the uploaded file bytes ('0x' + 64 hex chars), matching
            // the work_id format. This is the true content fingerprint; work_id
            // stays slug-derived for compatibility with the existing catalog
            // and the on-chain registry design.
            $table->string('content_hash', 66)->nullable()->after('work_id');
            // Storage path on the local (non-public) disk, e.g. works/abc.pdf.
            $table->string('file_path')->nullable()->after('content_hash');
            // Per-tier license terms text, e.g. {"read": "...", "citation": "..."}.
            $table->json('terms')->nullable()->after('tiers');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('works', function (Blueprint $table) {
            $table->dropColumn(['content_hash', 'file_path', 'terms']);
        });
    }
};
