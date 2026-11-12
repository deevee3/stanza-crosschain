<?php

use App\Http\Controllers\CheckoutController;
use App\Http\Controllers\PayPalCheckoutController;
use App\Http\Controllers\ScholarController;
use Illuminate\Support\Facades\Route;

Route::get('/', [CheckoutController::class, 'index'])->name('home');
Route::get('/checkout', [CheckoutController::class, 'index'])->name('checkout');

Route::post('/api/quote', [CheckoutController::class, 'createQuote'])->name('api.quote');

// PayPal AI Hackathon slice: sandbox checkout (authorize → attestation → capture).
Route::post('/api/paypal/order', [PayPalCheckoutController::class, 'createOrder'])->name('api.paypal.order');
Route::get('/paypal/return', [PayPalCheckoutController::class, 'return'])->name('paypal.return');
Route::get('/paypal/cancel', [PayPalCheckoutController::class, 'cancel'])->name('paypal.cancel');
Route::get('/api/licenses/{license}', [CheckoutController::class, 'getStatus'])->name('api.license.status');
Route::get('/api/lookup', [CheckoutController::class, 'resolveHash'])->name('api.lookup');

Route::get('/lookup', [CheckoutController::class, 'lookupPage'])->name('lookup');
Route::get('/scholar/{address}', [ScholarController::class, 'show'])->name('scholar.show');
