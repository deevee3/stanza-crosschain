<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Chain-picker restore: the address 1Click refunds to if a swap fails.
     * Refunds go to the ORIGIN chain, so the refund address must live on
     * the origin chain: a NEAR account for NEAR origin, a Solana address
     * for Solana origin, the EVM buyer address for EVM origins. Existing
     * rows keep NULL and fall back to buyer_address at quote time.
     */
    public function up(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->string('refund_address')->nullable()->after('buyer_address');
        });
    }

    public function down(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->dropColumn('refund_address');
        });
    }
};
