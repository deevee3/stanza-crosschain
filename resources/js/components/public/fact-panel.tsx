import type { ReactNode } from 'react';

/*
 * Fact panel, adapted from the Shortages & Shifts ?v=4 fact panel: a
 * definition list of labeled field/value pairs. Each field name is mono
 * caps with an orange marker; each value is bold. The panel carries no
 * card chrome of its own — the parent card provides it.
 */
export interface FactField {
    label: string;
    value: ReactNode;
}

export default function FactPanel({ fields, className }: { fields: FactField[]; className?: string }) {
    return (
        <dl className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${className ?? ''}`}>
            {fields.map((field) => (
                <div key={field.label} className="min-w-0 break-words">
                    <dt className="text-muted-foreground flex items-center gap-2 font-mono text-xs font-medium tracking-[0.08em] uppercase">
                        <span aria-hidden="true" className="bg-accent h-2 w-2 shrink-0" />
                        {field.label}
                    </dt>
                    <dd className="mt-1 leading-snug font-semibold tabular-nums">{field.value}</dd>
                </div>
            ))}
        </dl>
    );
}
