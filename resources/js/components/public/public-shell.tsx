import type { ReactNode } from 'react';
import SiteFooter from './site-footer';
import SiteHeader from './site-header';

/*
 * Shared public shell: skip link, sticky pill header, measured main,
 * orange footer block. Presentation only — pages keep their own data,
 * handlers, and copy.
 */
export default function PublicShell({ footerNote, children }: { footerNote: string; children: ReactNode }) {
    return (
        <div className="bg-background text-foreground flex min-h-screen flex-col">
            <a href="#main-content" className="skip-link">
                Skip to main content
            </a>
            <SiteHeader />
            <main id="main-content" tabIndex={-1} className="max-w-measure mx-auto w-full flex-1 px-4 pt-8 pb-2 md:pt-10">
                {children}
            </main>
            <SiteFooter note={footerNote} />
        </div>
    );
}
