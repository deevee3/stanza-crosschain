<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * PayPal AI Hackathon slice: payment-method + PayPal + attestation
     * fields on licenses. Existing 1Click licenses are untouched
     * (payment_method defaults to 'oneclick').
     */
    public function up(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->string('payment_method')->default('oneclick')->after('tier');
            $table->string('paypal_order_id')->nullable()->unique()->after('quote_payload');
            $table->string('paypal_authorization_id')->nullable()->after('paypal_order_id');
            $table->string('paypal_capture_id')->nullable()->after('paypal_authorization_id');
            $table->json('attestation_payload')->nullable()->after('paypal_capture_id');
        });
    }

    public function down(): void
    {
        Schema::table('licenses', function (Blueprint $table) {
            $table->dropColumn([
                'payment_method',
                'paypal_order_id',
                'paypal_authorization_id',
                'paypal_capture_id',
                'attestation_payload',
            ]);
        });
    }
};
