import { Link, usePage } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';

const NAV_LINKS = [
    { href: '/checkout', label: 'Checkout', component: 'checkout' },
    { href: '/lookup', label: 'License Lookup', component: 'lookup' },
];

/*
 * Pill header, adapted from the Shortages & Shifts ?v=4 header: one
 * sticky unit holding the wordmark, a mono freshness note, and the
 * section links. On phones the links collapse behind the orange menu
 * button; the button closes on link tap and on Escape. The shadow
 * arrives only once the pill sticks (sentinel-observed).
 */
export default function SiteHeader() {
    const { component } = usePage();
    const [open, setOpen] = useState(false);
    const [stuck, setStuck] = useState(false);
    const sentinelRef = useRef<HTMLDivElement>(null);
    const toggleRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || typeof IntersectionObserver === 'undefined') return;
        const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 0 });
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false);
                toggleRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    return (
        <>
            <div ref={sentinelRef} aria-hidden="true" className="h-0" />
            <header className="sticky top-0 z-20 px-4 pt-2 print:hidden">
                <div
                    className={`max-w-measure border-border bg-card mx-auto w-full border transition-shadow ${
                        open ? 'rounded-lg' : 'rounded-full md:rounded-lg'
                    } ${stuck ? 'shadow-md' : 'shadow-sm'}`}
                >
                    <div className="flex items-center gap-4 py-2.5 pr-2.5 pl-5">
                        <Link
                            href="/"
                            className="text-foreground flex min-h-11 items-center text-xl font-extrabold tracking-tight whitespace-nowrap no-underline hover:underline hover:underline-offset-4"
                        >
                            Stanza Cross-Chain
                        </Link>
                        <p className="text-muted-foreground m-0 hidden min-w-0 flex-1 text-right font-mono text-xs font-medium tracking-[0.08em] uppercase tabular-nums md:block">
                            Base Mainnet (8453)
                        </p>
                        <button
                            ref={toggleRef}
                            type="button"
                            aria-expanded={open}
                            aria-controls="site-nav-list"
                            aria-label="Sections"
                            onClick={() => setOpen((value) => !value)}
                            className="bg-accent text-accent-foreground hover:bg-accent-deep focus-visible:outline-primary ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition md:hidden"
                        >
                            <span aria-hidden="true" className="inline-flex flex-col gap-1">
                                <span
                                    className={`block h-0.5 w-[18px] bg-current transition-transform duration-150 ${open ? 'translate-y-[6px] rotate-45' : ''}`}
                                />
                                <span className={`block h-0.5 w-[18px] bg-current transition-opacity duration-150 ${open ? 'opacity-0' : ''}`} />
                                <span
                                    className={`block h-0.5 w-[18px] bg-current transition-transform duration-150 ${open ? '-translate-y-[6px] -rotate-45' : ''}`}
                                />
                            </span>
                            <span className="sr-only">Sections</span>
                        </button>
                    </div>
                    <nav aria-label="Sections">
                        <ul
                            id="site-nav-list"
                            className={`${open ? 'flex' : 'hidden'} divide-border border-border m-0 list-none flex-col divide-y border-t px-3 pt-1 pb-2 md:flex md:flex-row md:items-center md:gap-1 md:divide-y-0 md:pt-0 md:pb-1.5`}
                        >
                            {NAV_LINKS.map((link) => (
                                <li key={link.href} className="m-0">
                                    <Link
                                        href={link.href}
                                        aria-current={component === link.component ? 'page' : undefined}
                                        onClick={() => setOpen(false)}
                                        className="text-foreground aria-[current=page]:decoration-accent flex min-h-11 items-center px-2.5 py-3 font-semibold no-underline hover:underline hover:underline-offset-4 aria-[current=page]:underline aria-[current=page]:decoration-2 aria-[current=page]:underline-offset-8"
                                    >
                                        {link.label}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </nav>
                </div>
            </header>
        </>
    );
}
