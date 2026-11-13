<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Work extends Model
{
    use HasFactory;

    /**
     * Catalog tier defaults (USD). ONE source of truth: both checkout
     * controllers, the upload defaults, and the frontend tier grid fall
     * back to these when a work has no price for a tier. Previously the
     * crypto controller fell back to $5.00, PayPal to $10.00, and the
     * checkout UI to $1.00 — three different prices for the same tier.
     * The exclusive tier price is a placeholder until D'Vaughn sets it.
     */
    public const TIER_DEFAULTS = [
        'read' => 1.00,
        'citation' => 25.00,
        'commercial' => 150.00,
        'exclusive' => 500.00,
    ];

    public const TIER_KEYS = ['read', 'citation', 'commercial', 'exclusive'];

    /**
     * Default license-terms copy per tier, shown when a work carries no
     * per-tier terms of its own. Short, plain, one line each.
     */
    public const DEFAULT_TERMS = [
        'read' => 'Read the full work for personal, non-commercial use. No redistribution.',
        'citation' => 'Cite the work with attribution in your own publications. No redistribution of the full text.',
        'commercial' => 'Reuse the work commercially with attribution. No resale of the work itself.',
        'exclusive' => 'Exclusive license: sole commercial reuse rights for the term agreed with the scholar.',
    ];

    /**
     * Price for a tier: the work's own price when set, else the catalog
     * default. Unknown tiers fall back to the read default, never to a
     * bare number invented at the call site.
     */
    public function tierPrice(string $tier): float
    {
        $tiers = $this->tiers ?? [];

        return (float) ($tiers[$tier] ?? self::TIER_DEFAULTS[$tier] ?? self::TIER_DEFAULTS['read']);
    }

    /**
     * Terms text for a tier: the work's own terms when set, else the
     * catalog default.
     */
    public function termFor(string $tier): string
    {
        $terms = $this->terms ?? [];

        return (string) ($terms[$tier] ?? self::DEFAULT_TERMS[$tier] ?? self::DEFAULT_TERMS['read']);
    }

    protected $fillable = [
        'work_id',
        'content_hash',
        'file_path',
        'title',
        'slug',
        'scholar_name',
        'scholar_address',
        'scholar_email',
        'metadata_uri',
        'description',
        'tiers',
        'terms',
        'is_active',
    ];

    protected $casts = [
        'tiers' => 'array',
        'terms' => 'array',
        'is_active' => 'boolean',
    ];

    public function licenses(): HasMany
    {
        return $this->hasMany(License::class);
    }
}
