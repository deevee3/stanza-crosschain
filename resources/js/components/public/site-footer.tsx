import { Link } from '@inertiajs/react';
import FoxMark from './fox-mark';

/*
 * Orange footer block, adapted from the Shortages & Shifts ?v=4 footer:
 * the brand's loudest moment, kept to the footer. Ink wordmark, ink
 * links, mono legal line. Focus rings on orange are the primary color —
 * an orange ring would vanish on the fill.
 */
export default function SiteFooter({ note }: { note: string }) {
    return (
        <footer className="max-w-measure mx-auto mt-12 w-full px-4 pb-10">
            <div className="bg-accent text-accent-foreground rounded-xl px-6 py-8 md:px-8 md:py-10">
                <Link
                    href="/"
                    className="text-accent-foreground focus-visible:outline-primary inline-flex min-h-11 items-center gap-2.5 text-3xl font-extrabold tracking-tight no-underline hover:underline hover:underline-offset-4"
                >
                    <FoxMark className="h-8 w-8 shrink-0" cutout="var(--accent)" />
                    Stanza Cross-Chain
                </Link>
                <p className="text-accent-foreground mt-1 text-sm font-medium">The straight line.</p>
                <nav aria-label="Footer" className="mt-6">
                    <h2 className="font-mono text-xs font-bold tracking-[0.08em] uppercase">Sections</h2>
                    <ul className="m-0 mt-1 list-none p-0">
                        <li className="m-0">
                            <Link
                                href="/checkout"
                                className="text-accent-foreground focus-visible:outline-primary inline-flex min-h-11 items-center px-1 py-2.5 font-semibold no-underline hover:underline hover:underline-offset-4"
                            >
                                Checkout
                            </Link>
                        </li>
                        <li className="m-0">
                            <Link
                                href="/lookup"
                                className="text-accent-foreground focus-visible:outline-primary inline-flex min-h-11 items-center px-1 py-2.5 font-semibold no-underline hover:underline hover:underline-offset-4"
                            >
                                License Lookup
                            </Link>
                        </li>
                    </ul>
                </nav>
                <p className="mt-6 font-mono text-xs leading-relaxed tracking-wide">{note}</p>
            </div>
        </footer>
    );
}
