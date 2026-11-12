<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #1c1612; line-height: 1.5; max-width: 36rem; margin: 0 auto; padding: 1rem;">
<p>Good news — your work sold a license on STANZA.</p>

<p>
    <strong>{{ $work?->title }}</strong><br>
    Tier: {{ ucfirst($license->tier) }} — ${{ number_format((float) $license->price_usd, 2) }}<br>
    Buyer: {{ $license->buyer_email ?? $license->buyer_address }}<br>
    Settled: {{ $license->settled_at?->toDateTimeString() ?? 'just now' }} (UTC)
</p>

@if ($license->settlement_tx_hash)
<p>
    On-chain record (Base):<br>
    <a href="https://basescan.org/tx/{{ $license->settlement_tx_hash }}">{{ $license->settlement_tx_hash }}</a>
</p>
@endif

<p>
    <a href="{{ url('/scholar/' . ($work?->scholar_address ?? '')) }}">View your portfolio and all licenses</a>
</p>

<p style="color: #6b6259; font-size: 0.875rem;">
    STANZA by SpinWave — the straight line.<br>
    Crypto payments settle to your scholar address directly. PayPal payments land in the merchant account.
</p>
</body>
</html>
