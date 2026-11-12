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
            // Scholar contact for sale notifications. Nullable: seeded and
            // early works have no email on file, and notifications fall
            // back to STANZA_NOTIFY_EMAIL (see ScholarNotificationService).
            $table->string('scholar_email')->nullable()->after('scholar_address');
        });

        Schema::table('licenses', function (Blueprint $table) {
            // When the scholar sale notification was sent (null = never
            // sent or skipped: no recipient, or mail unconfigured).
            $table->timestamp('notification_sent_at')->nullable()->after('settled_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->dropColumn('notification_sent_at');
        });

        Schema::table('works', function (Blueprint $table) {
            $table->dropColumn('scholar_email');
        });
    }
};
