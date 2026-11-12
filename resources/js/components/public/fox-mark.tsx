/*
 * Reynard — the STANZA fox mark. A minimal geometric fox head: pointed
 * ears, a straight cheek line down to the chin. The silhouette takes
 * currentColor; the inner-ear cutouts take the surface behind the mark
 * so they read as negative space.
 */
export default function FoxMark({ className = '', cutout = 'var(--card)' }: { className?: string; cutout?: string }) {
    return (
        <svg viewBox="0 0 32 32" fill="none" aria-hidden="true" className={className}>
            <path d="M3 2 L10 8 L16 5 L22 8 L29 2 L27 15 L21 26 L16 30 L11 26 L5 15 Z" fill="currentColor" />
            <path d="M6.5 5 L10.5 9.5 L6.8 12.5 Z" fill={cutout} />
            <path d="M25.5 5 L21.5 9.5 L25.2 12.5 Z" fill={cutout} />
        </svg>
    );
}
