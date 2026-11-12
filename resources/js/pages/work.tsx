import { Head, Link } from '@inertiajs/react';
import PublicShell from '../components/public/public-shell';

interface Work {
    id: number;
    work_id: string;
    content_hash: string | null;
    title: string;
    slug: string;
    scholar_name: string | null;
    scholar_address: string;
    description: string | null;
    tiers: Record<string, number>;
    terms: Record<string, string> | null;
}

interface Props {
    work: Work;
}

const TIER_LABELS: Record<string, string> = {
    read: 'Read',
    citation: 'Citation',
    commercial: 'Commercial',
    exclusive: 'Exclusive',
};

const TIER_ORDER = ['read', 'citation', 'commercial', 'exclusive'];

const DEFAULT_TERMS: Record<string, string> = {
    read: 'Read the full work for personal, non-commercial use. No redistribution.',
    citation: 'Cite the work with attribution in your own publications. No redistribution of the full text.',
    commercial: 'Reuse the work commercially with attribution. No resale of the work itself.',
    exclusive: 'Exclusive license: sole commercial reuse rights for the term agreed with the scholar.',
};

export default function WorkPage({ work }: Props) {
    const tiers = TIER_ORDER.filter((tier) => work.tiers?.[tier] !== undefined).map((tier) => [tier, work.tiers[tier]] as const);

    return (
        <PublicShell footerNote="Stanza Cross-Chain Licensing · Built with NEAR Intents 1Click & Chain Signatures MPC · Base Mainnet (8453)">
            <Head title={work.title} />
            <p className="text-muted-foreground text-sm">
                <Link href="/checkout" className="text-foreground decoration-accent/60 hover:decoration-accent underline underline-offset-4">
                    Stanza Cross-Chain
                </Link>
            </p>
            <h1 className="text-foreground mt-4 text-3xl font-extrabold tracking-tight md:text-4xl">{work.title}</h1>
            <p className="text-muted-foreground mt-2">
                by{' '}
                <Link
                    href={`/scholar/${work.scholar_address}`}
                    className="text-foreground decoration-accent/60 hover:decoration-accent font-medium underline underline-offset-4"
                >
                    {work.scholar_name || work.scholar_address}
                </Link>
            </p>
            {work.description && <p className="text-foreground mt-6 max-w-[60ch] leading-relaxed">{work.description}</p>}
            {work.content_hash && <p className="text-muted-foreground mt-6 font-mono text-xs break-all">Content fingerprint: {work.content_hash}</p>}

            <h2 className="text-foreground mt-10 text-xl font-bold">License tiers</h2>
            <div className="mt-4 space-y-4">
                {tiers.map(([tier, price]) => (
                    <div key={tier} className="border-border bg-card rounded-lg border p-4 shadow-sm">
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="text-foreground font-semibold">{TIER_LABELS[tier] || tier}</span>
                            <span className="text-foreground font-bold tabular-nums">${Number(price).toFixed(2)}</span>
                        </div>
                        <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{work.terms?.[tier] ?? DEFAULT_TERMS[tier] ?? ''}</p>
                    </div>
                ))}
            </div>

            <Link
                href="/checkout"
                className="bg-accent text-accent-foreground hover:bg-accent-deep mt-8 inline-flex min-h-12 items-center rounded-full px-5 py-3 text-sm font-semibold transition"
            >
                License this work
            </Link>
        </PublicShell>
    );
}
