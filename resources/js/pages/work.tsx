import { Head, Link } from '@inertiajs/react';

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
};

export default function WorkPage({ work }: Props) {
    const tiers = Object.entries(work.tiers || {});

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-100">
            <Head title={work.title} />
            <main className="mx-auto max-w-3xl px-6 py-12">
                <p className="text-sm text-emerald-400">
                    <Link href="/checkout" className="hover:underline">
                        Stanza Cross-Chain
                    </Link>
                </p>
                <h1 className="mt-4 text-3xl font-semibold">{work.title}</h1>
                <p className="mt-2 text-neutral-400">
                    by{' '}
                    <Link
                        href={`/scholar/${work.scholar_address}`}
                        className="text-neutral-200 hover:underline"
                    >
                        {work.scholar_name || work.scholar_address}
                    </Link>
                </p>
                {work.description && (
                    <p className="mt-6 leading-relaxed text-neutral-300">{work.description}</p>
                )}
                {work.content_hash && (
                    <p className="mt-6 break-all font-mono text-xs text-neutral-500">
                        Content fingerprint: {work.content_hash}
                    </p>
                )}

                <h2 className="mt-10 text-xl font-semibold">License tiers</h2>
                <div className="mt-4 space-y-4">
                    {tiers.map(([tier, price]) => (
                        <div
                            key={tier}
                            className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
                        >
                            <div className="flex items-baseline justify-between">
                                <span className="font-medium">
                                    {TIER_LABELS[tier] || tier}
                                </span>
                                <span className="text-emerald-400">${Number(price).toFixed(2)}</span>
                            </div>
                            {work.terms?.[tier] && (
                                <p className="mt-2 text-sm leading-relaxed text-neutral-400">
                                    {work.terms[tier]}
                                </p>
                            )}
                        </div>
                    ))}
                </div>

                <Link
                    href="/checkout"
                    className="mt-8 inline-block rounded-lg bg-emerald-500 px-5 py-3 font-medium text-neutral-950 hover:bg-emerald-400"
                >
                    License this work
                </Link>
            </main>
        </div>
    );
}
