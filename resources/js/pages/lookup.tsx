import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import FactPanel from '../components/public/fact-panel';
import PublicShell from '../components/public/public-shell';

interface Work {
    id: number;
    work_id: string;
    title: string;
    scholar_name: string;
    scholar_address: string;
    metadata_uri: string;
}

interface License {
    id: number;
    work_id: number;
    buyer_address: string;
    tier: string;
    price_usd: number;
    deposit_asset: string;
    deposit_chain: string;
    deposit_address: string;
    deposit_tx_hash: string | null;
    proof_hash: string | null;
    settlement_tx_hash: string | null;
    status: string;
    settled_at: string | null;
    work?: Work;
}

interface Props {
    initialQuery?: string;
    license?: License | null;
}

export default function Lookup({ initialQuery = '', license: initialLicense = null }: Props) {
    const [query, setQuery] = useState<string>(initialQuery);
    const [license, setLicense] = useState<License | null>(initialLicense);
    const [loading, setLoading] = useState<boolean>(false);
    const [searched, setSearched] = useState<boolean>(Boolean(initialQuery));
    const [error, setError] = useState<string | null>(null);

    const handleSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setLoading(true);
        setError(null);
        setSearched(true);

        try {
            const res = await fetch(`/api/lookup?hash=${encodeURIComponent(query.trim())}`);
            const data = await res.json();

            if (!res.ok || !data.found) {
                setLicense(null);
                setError(data.message || 'No license found matching that transaction or proof hash.');
            } else {
                setLicense(data.license);
            }
        } catch (err: any) {
            setLicense(null);
            setError(err.message || 'Failed to query license registry.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <Head title="License Verification & Lookup — Stanza" />
            <PublicShell footerNote="Stanza Cross-Chain Licensing · Multi-Chain Attribution Engine">
                <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <p className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                            BaseScan Verifiable Proofs
                        </p>
                        <h1 className="text-foreground mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">License Verification</h1>
                        <p className="text-muted-foreground mt-2 max-w-[60ch] text-base leading-relaxed md:text-lg">
                            Look up cryptographic license attestation by deposit transaction or proof hash.
                        </p>
                    </div>
                    <div className="shrink-0">
                        <Link
                            href="/checkout"
                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs font-medium transition"
                        >
                            ← Back to Checkout
                        </Link>
                    </div>
                </header>

                {/* Search Form */}
                <form onSubmit={handleSearch} className="mb-8">
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Paste deposit tx hash, proof hash, or Base settlement hash..."
                            className="border-input bg-card text-foreground placeholder:text-muted-foreground focus:border-ring h-14 grow rounded-full border px-5 font-mono text-xs transition sm:text-sm"
                            required
                        />
                        <button
                            type="submit"
                            disabled={loading}
                            className="bg-accent text-accent-foreground hover:bg-accent-deep h-14 shrink-0 rounded-full px-6 font-mono text-sm font-semibold transition disabled:opacity-50"
                        >
                            {loading ? 'Searching...' : 'Lookup License'}
                        </button>
                    </div>
                </form>

                {error && (
                    <div className="border-destructive bg-destructive/10 rounded-lg border p-6 text-center">
                        <p className="text-destructive font-medium">{error}</p>
                        <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                            Ensure you copied the exact deposit transaction hash, proof hash, or 1Click deposit address.
                        </p>
                    </div>
                )}

                {license && (
                    <div className="border-border bg-card space-y-6 rounded-lg border p-6 shadow-sm">
                        <div className="border-border flex flex-wrap items-center justify-between gap-4 border-b pb-4">
                            <div>
                                <span className="bg-success text-success-foreground inline-block rounded-full px-2.5 py-1 font-mono text-[10px] font-semibold tracking-wide uppercase">
                                    Verified On-Chain
                                </span>
                                <h2 className="text-foreground mt-2 text-xl font-bold">{license.work?.title || 'Scholarly Work'}</h2>
                                <p className="text-muted-foreground mt-1 text-sm">
                                    Scholar:{' '}
                                    {license.work?.scholar_address ? (
                                        <Link
                                            href={`/scholar/${license.work.scholar_address}`}
                                            className="text-foreground decoration-accent/60 hover:decoration-accent font-medium underline underline-offset-4"
                                        >
                                            {license.work?.scholar_name}
                                        </Link>
                                    ) : (
                                        <span className="text-foreground">{license.work?.scholar_name}</span>
                                    )}
                                </p>
                            </div>
                            <div className="text-right">
                                <div className="text-muted-foreground font-mono text-xs uppercase">Tier</div>
                                <div className="text-foreground font-mono text-lg font-bold uppercase tabular-nums">{license.tier}</div>
                            </div>
                        </div>

                        <FactPanel
                            fields={[
                                {
                                    label: 'Licensee (Buyer)',
                                    value: <span className="font-mono text-sm break-all">{license.buyer_address}</span>,
                                },
                                {
                                    label: 'Scholar Address (Base)',
                                    value: license.work?.scholar_address ? (
                                        <span className="block">
                                            <Link
                                                href={`/scholar/${license.work.scholar_address}`}
                                                className="text-foreground decoration-accent/60 hover:decoration-accent font-mono text-sm break-all underline underline-offset-4"
                                            >
                                                {license.work.scholar_address}
                                            </Link>
                                            <Link
                                                href={`/scholar/${license.work.scholar_address}`}
                                                className="text-foreground decoration-accent/60 hover:decoration-accent mt-1 block text-xs font-medium underline underline-offset-4"
                                            >
                                                view portfolio →
                                            </Link>
                                        </span>
                                    ) : (
                                        '—'
                                    ),
                                },
                                {
                                    label: 'Origin Payment Asset',
                                    value: (
                                        <span className="font-mono text-sm">
                                            {license.deposit_asset} ({license.deposit_chain})
                                        </span>
                                    ),
                                },
                                {
                                    label: 'Settled Timestamp',
                                    value: <span className="font-mono text-sm">{license.settled_at || 'Confirmed'}</span>,
                                },
                            ]}
                        />

                        <div className="border-border space-y-3 border-t pt-4">
                            <div>
                                <div className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
                                    Replay Protection Proof Hash (bytes32)
                                </div>
                                <div className="border-border bg-background text-foreground mt-1 rounded-sm border p-3 font-mono text-xs break-all">
                                    {license.proof_hash}
                                </div>
                            </div>

                            {license.settlement_tx_hash && (
                                <div>
                                    <div className="text-muted-foreground font-mono text-[10px] tracking-[0.08em] uppercase">
                                        BaseScan Settlement Transaction
                                    </div>
                                    <div className="border-accent/40 bg-accent-soft mt-1 flex items-center justify-between gap-2 rounded-sm border p-3">
                                        <a
                                            href={`https://basescan.org/tx/${license.settlement_tx_hash}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-foreground decoration-accent/60 hover:decoration-accent font-mono text-xs break-all underline underline-offset-4"
                                        >
                                            {license.settlement_tx_hash}
                                        </a>
                                        <span className="text-muted-foreground ml-2 shrink-0 font-mono text-[10px]">Base (8453)</span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="border-accent/40 bg-accent-soft text-foreground rounded-lg border p-4 text-xs leading-relaxed">
                            <span className="font-semibold">STANZA Recognition Event: </span>
                            Scholar credited on-chain via <code className="font-semibold">ScholarCredited</code> event in{' '}
                            <code className="font-semibold">LicenseRegistry.sol</code> signed by NEAR Chain Signatures MPC.
                        </div>
                    </div>
                )}
            </PublicShell>
        </>
    );
}
