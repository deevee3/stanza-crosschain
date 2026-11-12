import type { ReactNode } from 'react';

/*
 * Metric card, adapted from the Shortages & Shifts ?v=4 metric card:
 * mono eyebrow, hero figure, provenance line. The dot-matrix face is
 * used for numerals only (dot=true); text values stay grotesque.
 */
export default function MetricCard({
    eyebrow,
    value,
    provenance,
    dot = false,
}: {
    eyebrow: string;
    value: ReactNode;
    provenance: string;
    dot?: boolean;
}) {
    return (
        <div className="border-border bg-card rounded-lg border p-6 shadow-sm">
            <p className="text-muted-foreground font-mono text-xs font-medium tracking-[0.08em] uppercase">{eyebrow}</p>
            <p
                className={
                    dot
                        ? 'font-dot text-foreground mt-2 text-[clamp(2.25rem,8vw,3rem)] leading-[1.1] break-words'
                        : 'text-foreground mt-2 text-xl font-bold'
                }
            >
                {value}
            </p>
            <p className="text-muted-foreground mt-2 text-xs leading-relaxed tabular-nums">{provenance}</p>
        </div>
    );
}
