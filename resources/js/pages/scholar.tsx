import { Head, Link } from '@inertiajs/react';
import { useState } from 'react';
import MetricCard from '../components/public/metric-card';
import PublicShell from '../components/public/public-shell';

interface Work {
    id: number;
    work_id: string;
    title: string;
    slug?: string;
    scholar_name: string;
    scholar_address: string;
    description?: string;
    metadata_uri?: string;
    tiers?: Record<string, number>;
}

interface License {
    id: number;
    work_id: number;
    buyer_address: string;
    tier: string;
    price_usd: number;
    deposit_asset: string;
    deposit_chain: string;
    deposit_address: string | null;
    deposit_tx_hash: string | null;
    proof_hash: string | null;
    settlement_tx_hash: string | null;
    status: string;
    settled_at: string | null;
    created_at?: string;
    work?: Work;
}

interface Stats {
    totalWorks: number;
    totalLicenses: number;
    settledLicenses: number;
    totalRevenueUsd: string;
}

interface Props {
    scholarAddress: string;
    scholarName?: string | null;
    works: Work[];
    licenses: License[];
    stats: Stats;
}

export default function Scholar({ scholarAddress, scholarName, works, licenses, stats }: Props) {
    const [copied, setCopied] = useState<boolean>(false);

    const copyAddress = () => {
        navigator.clipboard.writeText(scholarAddress);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <>
            <Head title={`Scholar Portfolio — ${scholarName || scholarAddress.slice(0, 10)} — Stanza`} />
            <PublicShell footerNote="Stanza Cross-Chain Licensing · Multi-Chain Attribution Engine · Base Mainnet (8453)">
                <header className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="bg-success h-2 w-2 rounded-full" />
                            <span className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                Scholar Portfolio & Attribution Ledger
                            </span>
                        </div>
                        <h1 className="text-foreground mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">
                            {scholarName ? scholarName : 'Scholar Registry'}
                        </h1>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-muted-foreground font-mono text-xs">Recipient Address:</span>
                            <code className="border-border bg-muted text-foreground rounded-sm border px-2 py-1 font-mono text-xs break-all">
                                {scholarAddress}
                            </code>
                            <button
                                type="button"
                                onClick={copyAddress}
                                className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center rounded-full border px-3 font-mono text-[11px] transition"
                                title="Copy address"
                            >
                                {copied ? '✓ Copied' : 'Copy'}
                            </button>
                            <a
                                href={`https://basescan.org/address/${scholarAddress}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 items-center gap-1 font-mono text-[11px] underline underline-offset-4"
                            >
                                BaseScan ↗
                            </a>
                        </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Link
                            href="/checkout"
                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 font-mono text-xs font-medium transition"
                        >
                            ← Checkout
                        </Link>
                        <Link
                            href="/lookup"
                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 font-mono text-xs font-medium transition"
                        >
                            License Lookup
                        </Link>
                    </div>
                </header>

                {/* Stats Overview */}
                <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                    <MetricCard eyebrow="Registered Works" value={stats.totalWorks} provenance="Works on Base registry" dot />
                    <MetricCard eyebrow="Total Licenses" value={stats.totalLicenses} provenance={`${stats.settledLicenses} settled on Base`} dot />
                    <MetricCard eyebrow="Total Revenue" value={`$${stats.totalRevenueUsd}`} provenance="USDC directly to scholar" dot />
                    <MetricCard eyebrow="STANZA Credit" value="On-Chain Record" provenance="Recognition event per license" />
                </div>

                {/* Registered Manuscripts */}
                {works.length > 0 && (
                    <div className="mb-8">
                        <h2 className="text-muted-foreground mb-3 font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                            Registered Manuscripts ({works.length})
                        </h2>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            {works.map((work) => (
                                <div key={work.id} className="border-border bg-card flex flex-col justify-between rounded-lg border p-5 shadow-sm">
                                    <div>
                                        <div className="flex flex-col gap-2">
                                            <h3 className="text-foreground text-base font-semibold">{work.title}</h3>
                                            <span className="border-border bg-muted text-muted-foreground w-fit max-w-full rounded-full border px-2 py-1 font-mono text-[10px] break-all">
                                                {work.work_id}
                                            </span>
                                        </div>
                                        {work.description && (
                                            <p className="text-muted-foreground mt-2 line-clamp-2 text-sm leading-relaxed">{work.description}</p>
                                        )}
                                    </div>
                                    <div className="border-border mt-4 flex items-center justify-between gap-2 border-t pt-3 font-mono text-xs">
                                        <span className="text-muted-foreground text-[11px]">
                                            {work.metadata_uri ? (
                                                <span className="block max-w-[200px] truncate">URI: {work.metadata_uri}</span>
                                            ) : (
                                                <span>Verified on Base</span>
                                            )}
                                        </span>
                                        <Link
                                            href={`/checkout`}
                                            className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 shrink-0 items-center text-[11px] underline underline-offset-4"
                                        >
                                            License Work →
                                        </Link>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Licenses Ledger */}
                <div className="border-border bg-card overflow-hidden rounded-lg border shadow-sm">
                    <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b p-5">
                        <div>
                            <h2 className="text-foreground font-mono text-sm font-bold tracking-[0.08em] uppercase">License Ledger & Settlements</h2>
                            <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
                                Every license issued across all chains, settled to this scholar via NEAR Chain Signatures MPC.
                            </p>
                        </div>
                        <span className="border-border bg-muted text-muted-foreground rounded-full border px-2.5 py-1 font-mono text-xs">
                            {licenses.length} record{licenses.length === 1 ? '' : 's'}
                        </span>
                    </div>

                    {licenses.length === 0 ? (
                        <div className="p-12 text-center">
                            <div className="text-muted-foreground mb-2 font-mono text-sm">No licenses recorded for this scholar address yet.</div>
                            <p className="text-muted-foreground mx-auto max-w-md text-sm leading-relaxed">
                                When readers license works with payment from NEAR, Solana, or EVM chains, 1Click routes USDC to this address and MPC
                                relayers record the license on Base.
                            </p>
                            <div className="mt-5">
                                <Link
                                    href="/checkout"
                                    className="bg-accent text-accent-foreground hover:bg-accent-deep inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 font-mono text-xs font-semibold transition"
                                >
                                    Go to Checkout
                                </Link>
                            </div>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left font-mono text-xs">
                                <thead className="border-border bg-muted text-muted-foreground border-b text-[10px] tracking-[0.08em] uppercase">
                                    <tr>
                                        <th className="px-3 py-3">Work / Title</th>
                                        <th className="px-3 py-3">Tier</th>
                                        <th className="px-3 py-3">Buyer Address</th>
                                        <th className="px-3 py-3">Price (USD)</th>
                                        <th className="px-3 py-3">Deposit Chain</th>
                                        <th className="px-3 py-3">Status</th>
                                        <th className="px-3 py-3">Settled At</th>
                                        <th className="px-3 py-3 text-right">BaseScan Tx</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-border divide-y">
                                    {licenses.map((lic) => (
                                        <tr key={lic.id} className="hover:bg-muted/50 transition">
                                            <td className="px-3 py-3.5">
                                                <div
                                                    className="text-foreground max-w-[150px] truncate font-sans font-medium"
                                                    title={lic.work?.title || 'Unknown'}
                                                >
                                                    {lic.work?.title || 'Unknown Work'}
                                                </div>
                                                <div className="text-muted-foreground max-w-[150px] text-[10px] break-all">
                                                    ID: {lic.work?.work_id || lic.work_id}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <span
                                                    className={`inline-block rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                                                        lic.tier === 'commercial'
                                                            ? 'bg-accent text-accent-foreground'
                                                            : lic.tier === 'citation'
                                                              ? 'bg-primary text-primary-foreground'
                                                              : 'bg-secondary text-secondary-foreground'
                                                    }`}
                                                >
                                                    {lic.tier}
                                                </span>
                                            </td>
                                            <td className="text-foreground px-3 py-3.5">
                                                <span className="font-mono text-[11px]" title={lic.buyer_address}>
                                                    {lic.buyer_address.slice(0, 6)}...{lic.buyer_address.slice(-4)}
                                                </span>
                                            </td>
                                            <td className="text-foreground px-3 py-3.5 font-semibold tabular-nums">
                                                ${Number(lic.price_usd).toFixed(2)}
                                            </td>
                                            <td className="text-foreground px-3 py-3.5 capitalize">
                                                <div>{lic.deposit_chain}</div>
                                                <div className="text-muted-foreground max-w-[80px] truncate text-[10px]" title={lic.deposit_asset}>
                                                    {lic.deposit_asset.split(':').pop()}
                                                </div>
                                            </td>
                                            <td className="px-3 py-3.5">
                                                <span
                                                    className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold uppercase ${
                                                        lic.status === 'settled'
                                                            ? 'bg-success text-success-foreground'
                                                            : lic.status === 'failed'
                                                              ? 'bg-destructive text-destructive-foreground'
                                                              : 'bg-warning text-warning-foreground'
                                                    }`}
                                                >
                                                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                                                    {lic.status}
                                                </span>
                                            </td>
                                            <td className="text-muted-foreground px-3 py-3.5 text-[11px]">
                                                {lic.settled_at ? lic.settled_at : lic.created_at || 'Pending'}
                                            </td>
                                            <td className="px-3 py-3.5 text-right">
                                                {lic.settlement_tx_hash ? (
                                                    <a
                                                        href={`https://basescan.org/tx/${lic.settlement_tx_hash}`}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 items-center gap-1 text-[11px] underline underline-offset-4"
                                                        title={lic.settlement_tx_hash}
                                                    >
                                                        <span>
                                                            {lic.settlement_tx_hash.slice(0, 6)}...
                                                            {lic.settlement_tx_hash.slice(-4)}
                                                        </span>
                                                        <span>↗</span>
                                                    </a>
                                                ) : lic.proof_hash ? (
                                                    <Link
                                                        href={`/lookup?hash=${encodeURIComponent(lic.proof_hash)}`}
                                                        className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 items-center text-[11px] underline underline-offset-4"
                                                    >
                                                        Proof
                                                    </Link>
                                                ) : (
                                                    <span className="text-muted-foreground text-[11px]">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className="border-border bg-muted/50 text-muted-foreground flex flex-col gap-2 border-t p-4 text-xs leading-relaxed sm:flex-row sm:items-center sm:justify-between">
                        <div>
                            <span className="text-foreground font-semibold">Attestation Standard: </span>
                            Each settlement emits <code className="text-foreground font-semibold">ScholarCredited(workId, scholar, tier)</code> on
                            Base (8453).
                        </div>
                        <div className="font-mono text-[11px]">STANZA recognition only · No token transfer</div>
                    </div>
                </div>
            </PublicShell>
        </>
    );
}
