<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * PayPal buyers are identified by email, not by a wallet: the PayPal
     * rail must never require a wallet address. The email is stored on the
     * license; the on-chain buyer address is the supplied wallet address
     * when one exists, otherwise an address derived from the email.
     */
    public function up(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->string('buyer_email')->nullable()->after('buyer_address');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->dropColumn('buyer_email');
        });
    }
};
