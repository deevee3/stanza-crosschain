<?php

use App\Http\Controllers\CheckoutController;
use App\Http\Controllers\ScholarController;
use App\Http\Controllers\WorkController;
use Illuminate\Support\Facades\Route;

Route::get('/', [CheckoutController::class, 'index'])->name('home');
Route::get('/checkout', [CheckoutController::class, 'index'])->name('checkout');

Route::post('/api/quote', [CheckoutController::class, 'createQuote'])->name('api.quote');
Route::get('/api/licenses/{license}', [CheckoutController::class, 'getStatus'])->name('api.license.status');
Route::get('/api/lookup', [CheckoutController::class, 'resolveHash'])->name('api.lookup');

Route::get('/lookup', [CheckoutController::class, 'lookupPage'])->name('lookup');
Route::get('/scholar/{address}', [ScholarController::class, 'show'])->name('scholar.show');

Route::get('/work/{slug}', [WorkController::class, 'show'])->name('work.show');
Route::post('/api/works', [WorkController::class, 'store'])->name('api.works.store');
