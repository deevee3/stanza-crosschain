<!DOCTYPE html>
<html>
<body style="font-family: sans-serif; color: #1c1612; line-height: 1.5; max-width: 36rem; margin: 0 auto; padding: 1rem;">
<p>Your license is settled. Here is the work you licensed.</p>

<p>
    <strong>{{ $work?->title }}</strong><br>
    Tier: {{ ucfirst($license->tier) }} — ${{ number_format((float) $license->price_usd, 2) }}<br>
    Scholar: {{ $work?->scholar_name }}<br>
    Settled: {{ $license->settled_at?->toDateTimeString() ?? 'just now' }} (UTC)
</p>

@if ($work?->metadata_uri)
<p>
    Read the work:<br>
    <a href="{{ $work->metadata_uri }}">{{ $work->metadata_uri }}</a>
</p>
@endif

<p>
    Verify your license anytime at
    <a href="{{ url('/lookup') }}">License Lookup</a>
    with your transaction hash or proof hash.
</p>

@if ($license->settlement_tx_hash)
<p>
    On-chain record (Base):<br>
    <a href="https://basescan.org/tx/{{ $license->settlement_tx_hash }}">{{ $license->settlement_tx_hash }}</a>
</p>
@endif

@if ($license->proof_hash)
<p style="color: #6b6259; font-size: 0.875rem;">
    Proof hash: {{ $license->proof_hash }}
</p>
@endif

<p style="color: #6b6259; font-size: 0.875rem;">
    STANZA by SpinWave — the straight line.
</p>
</body>
</html>
