import {
    BASE_CHAIN_ID,
    connectInjectedWallet,
    getConnectedWalletSilent,
    getEthereumProvider,
    signPersonalMessage,
    switchInjectedWalletAccount,
} from '@/lib/wallet';
import { Head, Link } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import PublicShell from '../components/public/public-shell';

type TierKey = 'read' | 'citation' | 'commercial' | 'exclusive';

const TIER_KEYS: TierKey[] = ['read', 'citation', 'commercial', 'exclusive'];

const TIER_LABELS: Record<TierKey, string> = {
    read: 'Read',
    citation: 'Citation',
    commercial: 'Commercial',
    exclusive: 'Exclusive',
};

interface Props {
    tierDefaults?: Partial<Record<TierKey, number>>;
    defaultTerms?: Partial<Record<TierKey, string>>;
}

interface UploadSuccessResult {
    id: number;
    work_id: string;
    slug: string;
    url: string;
    content_hash: string;
    scholar_address: string;
    title: string;
}

interface DuplicateWorkResult {
    message: string;
    slug: string;
    url: string;
    work_id: string;
}

export default function Upload({ tierDefaults, defaultTerms }: Props) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [walletChainId, setWalletChainId] = useState<number | null>(null);
    const [connectingWallet, setConnectingWallet] = useState<boolean>(false);

    const [file, setFile] = useState<File | null>(null);
    const [title, setTitle] = useState<string>('');
    const [slug, setSlug] = useState<string>('');
    const [scholarName, setScholarName] = useState<string>('');
    const [scholarEmail, setScholarEmail] = useState<string>('');
    const [description, setDescription] = useState<string>('');

    const [tiers, setTiers] = useState<Record<TierKey, string>>({
        read: '',
        citation: '',
        commercial: '',
        exclusive: '',
    });

    const [terms, setTerms] = useState<Record<TierKey, string>>({
        read: '',
        citation: '',
        commercial: '',
        exclusive: '',
    });

    const [challengeMessage, setChallengeMessage] = useState<string | null>(null);
    const [challengeNonce, setChallengeNonce] = useState<string | null>(null);
    const [fetchingChallenge, setFetchingChallenge] = useState<boolean>(false);
    const [submitting, setSubmitting] = useState<boolean>(false);
    const [submitStage, setSubmitStage] = useState<'idle' | 'challenge' | 'signing' | 'uploading'>('idle');

    const [error, setError] = useState<string | null>(null);
    const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null);
    const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
    const [createdWork, setCreatedWork] = useState<UploadSuccessResult | null>(null);
    const [duplicateWork, setDuplicateWork] = useState<DuplicateWorkResult | null>(null);

    useEffect(() => {
        getConnectedWalletSilent().then((connected) => {
            if (connected) {
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
            }
        });
    }, []);

    useEffect(() => {
        const provider = getEthereumProvider();
        if (!provider?.on) return;

        const handleAccountsChanged = (accounts: string[]) => {
            if (accounts && accounts.length > 0) {
                setWalletAddress(accounts[0]);
                setChallengeMessage(null);
                setChallengeNonce(null);
                setError(null);
                setForbiddenMessage(null);
            } else {
                setWalletAddress(null);
                setWalletChainId(null);
                setChallengeMessage(null);
                setChallengeNonce(null);
            }
        };

        const handleChainChanged = (chainHex: string) => {
            const parsed = typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex);
            if (!Number.isNaN(parsed)) {
                setWalletChainId(parsed);
            }
        };

        provider.on('accountsChanged', handleAccountsChanged);
        provider.on('chainChanged', handleChainChanged);

        return () => {
            provider.removeListener?.('accountsChanged', handleAccountsChanged);
            provider.removeListener?.('chainChanged', handleChainChanged);
        };
    }, [walletAddress]);

    const handleConnectWallet = async () => {
        setConnectingWallet(true);
        setError(null);
        setForbiddenMessage(null);
        try {
            const { address, chainId } = await connectInjectedWallet();
            setWalletAddress(address);
            setWalletChainId(chainId);
            setChallengeMessage(null);
            setChallengeNonce(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to connect wallet.');
        } finally {
            setConnectingWallet(false);
        }
    };

    const handleSwitchWallet = async () => {
        setConnectingWallet(true);
        setError(null);
        setForbiddenMessage(null);
        try {
            const { address, chainId } = await switchInjectedWalletAccount();
            setWalletAddress(address);
            setWalletChainId(chainId);
            setChallengeMessage(null);
            setChallengeNonce(null);
        } catch (err: any) {
            setError(err?.message || 'Failed to switch wallet account.');
        } finally {
            setConnectingWallet(false);
        }
    };

    const fetchFreshChallenge = async (address: string): Promise<string> => {
        setFetchingChallenge(true);
        try {
            const res = await fetch(`/api/upload-challenge?address=${encodeURIComponent(address)}`, {
                headers: { Accept: 'application/json' },
            });
            const data = await res.json();
            if (!res.ok || !data?.message) {
                throw new Error(data?.message || 'Failed to request upload challenge.');
            }
            setChallengeMessage(data.message);
            setChallengeNonce(data.nonce ?? null);
            return data.message as string;
        } finally {
            setFetchingChallenge(false);
        }
    };

    const handleRequestFreshChallenge = async () => {
        setError(null);
        setForbiddenMessage(null);
        try {
            let activeAddress = walletAddress;
            if (!activeAddress) {
                const connected = await connectInjectedWallet();
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
                activeAddress = connected.address;
            }
            await fetchFreshChallenge(activeAddress);
        } catch (err: any) {
            setError(err?.message || 'Could not fetch a fresh upload challenge.');
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setForbiddenMessage(null);
        setFieldErrors({});
        setCreatedWork(null);
        setDuplicateWork(null);

        if (!file) {
            setFieldErrors({ file: ['Select a manuscript file (.pdf, .epub, .txt, or .md, max 25 MB).'] });
            return;
        }

        if (!title.trim()) {
            setFieldErrors({ title: ['The title field is required.'] });
            return;
        }

        setSubmitting(true);

        try {
            let activeAddress = walletAddress;
            if (!activeAddress) {
                const connected = await connectInjectedWallet();
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
                activeAddress = connected.address;
            }

            // Always use a fresh single-use challenge (or the one just requested via "Request Fresh Challenge")
            setSubmitStage('challenge');
            const messageToSign = challengeMessage || (await fetchFreshChallenge(activeAddress));

            setSubmitStage('signing');
            const signature = await signPersonalMessage({
                account: activeAddress,
                message: messageToSign,
            });

            setSubmitStage('uploading');
            const formData = new FormData();
            formData.append('title', title.trim());
            formData.append('scholar_address', activeAddress);
            formData.append('file', file);
            formData.append('challenge_message', messageToSign);
            formData.append('signature', signature);

            if (slug.trim()) {
                formData.append('slug', slug.trim());
            }
            if (scholarName.trim()) {
                formData.append('scholar_name', scholarName.trim());
            }
            if (scholarEmail.trim()) {
                formData.append('scholar_email', scholarEmail.trim());
            }
            if (description.trim()) {
                formData.append('description', description.trim());
            }

            for (const tier of TIER_KEYS) {
                const rawPrice = tiers[tier].trim();
                if (rawPrice !== '') {
                    formData.append(`tiers[${tier}]`, rawPrice);
                }
                const rawTerms = terms[tier].trim();
                if (rawTerms !== '') {
                    formData.append(`terms[${tier}]`, rawTerms);
                }
            }

            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content;

            const res = await fetch('/api/works', {
                method: 'POST',
                headers: {
                    'X-CSRF-TOKEN': csrfToken || '',
                    Accept: 'application/json',
                },
                body: formData,
            });

            // A challenge is single-use on the server regardless of outcome
            setChallengeMessage(null);
            setChallengeNonce(null);

            const data = await res.json();

            if (res.status === 201) {
                setCreatedWork({
                    id: data.id,
                    work_id: data.work_id,
                    slug: data.slug,
                    url: data.url,
                    content_hash: data.content_hash,
                    scholar_address: activeAddress,
                    title: title.trim(),
                });
                return;
            }

            if (res.status === 409) {
                setDuplicateWork({
                    message: data.message || 'This file is already registered as a work.',
                    slug: data.slug,
                    url: data.url || `/work/${data.slug}`,
                    work_id: data.work_id,
                });
                return;
            }

            if (res.status === 403) {
                setForbiddenMessage(
                    data.message ||
                        'Upload authorization failed: the signature does not prove control of the scholar wallet, or the challenge expired. Request a fresh challenge and sign it with the scholar wallet.',
                );
                return;
            }

            if (res.status === 422 && data?.errors) {
                setFieldErrors(data.errors as Record<string, string[]>);
                setError(data.message || 'Please correct the highlighted validation errors.');
                return;
            }

            setError(data?.message || 'Failed to upload manuscript.');
        } catch (err: any) {
            setError(err?.message || 'An unexpected error occurred during manuscript upload.');
        } finally {
            setSubmitting(false);
            setSubmitStage('idle');
        }
    };

    const renderFieldError = (key: string) => {
        const msgs = fieldErrors[key];
        if (!msgs || msgs.length === 0) return null;
        return (
            <p data-testid={`error-${key}`} className="text-destructive mt-1 text-xs">
                {msgs[0]}
            </p>
        );
    };

    return (
        <>
            <Head title="Publish Scholarly Manuscript — Stanza Cross-Chain" />
            <PublicShell footerNote="Stanza Cross-Chain Licensing · Signed Content-Addressed Scholar Uploads · Base Mainnet (8453)">
                <header className="border-border mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="bg-success h-2.5 w-2.5 rounded-full" />
                            <span className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                EIP-191 Signed Attribution
                            </span>
                        </div>
                        <h1 className="text-foreground mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">
                            Publish Scholarly Work
                        </h1>
                        <p className="text-muted-foreground mt-2 max-w-[62ch] text-base leading-relaxed">
                            Connect your scholar wallet, sign a single-use authorization challenge, and upload your manuscript. The work is
                            fingerprinted by the <code className="text-foreground font-mono text-xs">keccak256</code> hash of its file bytes.
                        </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2.5">
                        {walletAddress ? (
                            <button
                                type="button"
                                data-testid="connected-wallet-badge"
                                onClick={handleSwitchWallet}
                                title="Click to switch wallet account"
                                className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 py-2 font-mono text-xs font-medium transition"
                            >
                                <span className="bg-success h-2 w-2 rounded-full" />
                                <span>
                                    {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                                </span>
                                <span className="border-border text-muted-foreground border-l pl-2 text-[10px]">
                                    {walletChainId === BASE_CHAIN_ID ? 'Base' : `Chain ${walletChainId ?? '?'}`}
                                </span>
                            </button>
                        ) : (
                            <button
                                type="button"
                                data-testid="connect-wallet-btn"
                                onClick={handleConnectWallet}
                                disabled={connectingWallet}
                                className="bg-accent text-accent-foreground hover:bg-accent-deep inline-flex min-h-11 items-center gap-2 rounded-full px-4 py-2 font-mono text-xs font-semibold transition disabled:opacity-50"
                            >
                                {connectingWallet ? 'Connecting...' : 'Connect Wallet'}
                            </button>
                        )}
                        <Link
                            href="/checkout"
                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs font-medium transition"
                        >
                            ← Checkout
                        </Link>
                    </div>
                </header>

                {/* 201 Created Banner */}
                {createdWork && (
                    <div
                        data-testid="upload-success-card"
                        className="border-success/40 bg-success/10 text-foreground mb-6 rounded-lg border p-5 shadow-sm"
                    >
                        <div className="font-mono text-xs font-semibold tracking-[0.08em] uppercase">✓ Manuscript Registered</div>
                        <h2 className="mt-1 text-lg font-bold">{createdWork.title}</h2>
                        <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                            Work ID / Content Fingerprint (keccak256): <span className="text-foreground">{createdWork.work_id}</span>
                        </p>
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                            <Link
                                href={`/work/${createdWork.slug}`}
                                data-testid="created-work-link"
                                className="bg-accent text-accent-foreground hover:bg-accent-deep inline-flex min-h-11 items-center rounded-full px-4 py-2 font-mono text-xs font-semibold transition"
                            >
                                View Work Page (/work/{createdWork.slug}) →
                            </Link>
                            <Link
                                href={`/scholar/${createdWork.scholar_address}`}
                                className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center rounded-full border px-4 py-2 font-mono text-xs font-medium transition"
                            >
                                Scholar Portfolio
                            </Link>
                        </div>
                    </div>
                )}

                {/* 409 Duplicate File Banner */}
                {duplicateWork && (
                    <div
                        data-testid="upload-duplicate-card"
                        className="border-warning/50 bg-warning/10 text-foreground mb-6 rounded-lg border p-5 shadow-sm"
                    >
                        <div className="font-mono text-xs font-semibold tracking-[0.08em] uppercase">Duplicate Content Fingerprint (409)</div>
                        <p className="mt-1 text-sm">{duplicateWork.message}</p>
                        <p className="text-muted-foreground mt-1 font-mono text-xs break-all">
                            Existing Work ID: <span className="text-foreground">{duplicateWork.work_id}</span>
                        </p>
                        <div className="mt-3">
                            <Link
                                href={`/work/${duplicateWork.slug}`}
                                data-testid="existing-work-link"
                                className="text-foreground decoration-accent/60 hover:decoration-accent font-mono text-xs font-semibold underline underline-offset-4"
                            >
                                Open existing work (/work/{duplicateWork.slug}) →
                            </Link>
                        </div>
                    </div>
                )}

                {/* 403 Bad/Expired Signature Banner */}
                {forbiddenMessage && (
                    <div
                        data-testid="upload-forbidden-card"
                        className="border-destructive bg-destructive/10 text-foreground mb-6 rounded-lg border p-5 shadow-sm"
                    >
                        <div className="font-mono text-xs font-semibold tracking-[0.08em] uppercase">Authorization Failed (403)</div>
                        <p data-testid="forbidden-verbatim-message" className="mt-1 text-sm leading-relaxed">
                            {forbiddenMessage}
                        </p>
                        <div className="mt-4">
                            <button
                                type="button"
                                data-testid="request-fresh-challenge-btn"
                                onClick={handleRequestFreshChallenge}
                                disabled={fetchingChallenge}
                                className="bg-accent text-accent-foreground hover:bg-accent-deep inline-flex min-h-11 items-center rounded-full px-4 py-2 font-mono text-xs font-semibold transition disabled:opacity-50"
                            >
                                {fetchingChallenge ? 'Requesting Challenge...' : 'Request Fresh Challenge'}
                            </button>
                        </div>
                    </div>
                )}

                {/* General / Validation Error Banner */}
                {error && (
                    <div
                        data-testid="upload-error-banner"
                        className="border-destructive bg-destructive/10 text-foreground mb-6 flex items-start justify-between gap-3 rounded-lg border p-4 text-sm"
                    >
                        <span>{error}</span>
                        <button
                            type="button"
                            onClick={() => setError(null)}
                            className="text-muted-foreground hover:text-foreground inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full font-mono text-xs transition"
                        >
                            ✕
                        </button>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-8 lg:grid-cols-12" noValidate>
                    {/* Left Column: Manuscript Details & Tiers */}
                    <div className="space-y-6 lg:col-span-7">
                        {/* Step 1: Connected Scholar Wallet */}
                        <div className="border-border bg-card rounded-lg border p-5 shadow-sm sm:p-6">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <label className="text-muted-foreground block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                    1. Scholar Wallet (Attribution Owner)
                                </label>
                                {walletAddress ? (
                                    <button
                                        type="button"
                                        onClick={handleSwitchWallet}
                                        disabled={connectingWallet}
                                        className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 shrink-0 items-center font-mono text-xs underline underline-offset-4"
                                    >
                                        {connectingWallet ? 'Switching...' : 'Switch Account →'}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleConnectWallet}
                                        disabled={connectingWallet}
                                        className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 shrink-0 items-center font-mono text-xs underline underline-offset-4"
                                    >
                                        {connectingWallet ? 'Connecting...' : 'Connect Wallet →'}
                                    </button>
                                )}
                            </div>
                            <input
                                type="text"
                                data-testid="scholar-address-input"
                                value={walletAddress ?? ''}
                                readOnly
                                placeholder="Connect wallet to populate scholar address (0x...)"
                                className="border-accent/40 bg-muted text-muted-foreground min-h-11 w-full cursor-not-allowed rounded-sm border px-3 py-2 font-mono text-xs"
                            />
                            <p className="text-muted-foreground mt-1 text-[11px]">
                                Locked to your connected wallet. You will sign an EIP-191 challenge with this wallet so attribution is proven.
                            </p>
                            {renderFieldError('scholar_address')}
                        </div>

                        {/* Step 2: Manuscript File & Metadata */}
                        <div className="border-border bg-card space-y-4 rounded-lg border p-5 shadow-sm sm:p-6">
                            <label className="text-muted-foreground block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                2. Manuscript File & Metadata
                            </label>

                            <div>
                                <label htmlFor="manuscript-file" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                    Manuscript File <span className="text-accent">*</span>
                                </label>
                                <input
                                    ref={fileInputRef}
                                    id="manuscript-file"
                                    type="file"
                                    data-testid="file-input"
                                    accept=".pdf,.epub,.txt,.md,application/pdf,application/epub+zip,text/plain,text/markdown"
                                    onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                                    className="border-input bg-background text-foreground file:bg-accent file:text-accent-foreground hover:file:bg-accent-deep block min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs file:mr-3 file:rounded-full file:border-0 file:px-3 file:py-1 file:font-mono file:text-xs file:font-semibold"
                                    required
                                />
                                <p className="text-muted-foreground mt-1 text-[11px]">
                                    Allowed: PDF, EPUB, TXT, MD · Max 25 MB. The file’s <code className="font-mono">keccak256</code> digest becomes
                                    its permanent <code className="font-mono">work_id</code>.
                                </p>
                                {renderFieldError('file')}
                            </div>

                            <div>
                                <label htmlFor="work-title" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                    Title <span className="text-accent">*</span>
                                </label>
                                <input
                                    id="work-title"
                                    type="text"
                                    data-testid="title-input"
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    maxLength={255}
                                    placeholder="e.g. A Replication of Quadratic Funding Equilibria"
                                    className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 text-sm transition"
                                    required
                                />
                                {renderFieldError('title')}
                            </div>

                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                <div>
                                    <label htmlFor="scholar-name" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                        Scholar Name <span className="text-muted-foreground">(optional)</span>
                                    </label>
                                    <input
                                        id="scholar-name"
                                        type="text"
                                        data-testid="scholar-name-input"
                                        value={scholarName}
                                        onChange={(e) => setScholarName(e.target.value)}
                                        maxLength={255}
                                        placeholder="Prof. Katherine Vance"
                                        className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 text-sm transition"
                                    />
                                    {renderFieldError('scholar_name')}
                                </div>

                                <div>
                                    <label htmlFor="scholar-email" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                        Scholar Email <span className="text-muted-foreground">(optional)</span>
                                    </label>
                                    <input
                                        id="scholar-email"
                                        type="email"
                                        data-testid="scholar-email-input"
                                        value={scholarEmail}
                                        onChange={(e) => setScholarEmail(e.target.value)}
                                        maxLength={255}
                                        placeholder="scholar@university.edu"
                                        className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs transition"
                                    />
                                    <p className="text-muted-foreground mt-1 text-[11px]">Used for sale notifications when a license settles.</p>
                                    {renderFieldError('scholar_email')}
                                </div>
                            </div>

                            <div>
                                <label htmlFor="work-slug" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                    Custom Slug <span className="text-muted-foreground">(optional, letters/numbers/dashes/underscores)</span>
                                </label>
                                <input
                                    id="work-slug"
                                    type="text"
                                    data-testid="slug-input"
                                    value={slug}
                                    onChange={(e) => setSlug(e.target.value)}
                                    maxLength={255}
                                    placeholder="Leave blank to derive automatically from title"
                                    className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs transition"
                                />
                                {renderFieldError('slug')}
                            </div>

                            <div>
                                <label htmlFor="work-description" className="text-foreground mb-1 block font-mono text-xs font-medium">
                                    Abstract / Description <span className="text-muted-foreground">(optional, max 5000 chars)</span>
                                </label>
                                <textarea
                                    id="work-description"
                                    data-testid="description-input"
                                    value={description}
                                    onChange={(e) => setDescription(e.target.value)}
                                    maxLength={5000}
                                    rows={4}
                                    placeholder="Summary of the work, replication scope, or licensing context..."
                                    className="border-input bg-background text-foreground focus:border-ring w-full rounded-sm border px-3 py-2 text-sm leading-relaxed transition"
                                />
                                {renderFieldError('description')}
                            </div>
                        </div>

                        {/* Step 3: Optional Tier Prices & Terms */}
                        <div className="border-border bg-card space-y-4 rounded-lg border p-5 shadow-sm sm:p-6">
                            <div>
                                <label className="text-muted-foreground block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                    3. License Tiers & Terms (Optional)
                                </label>
                                <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                                    Leave any tier price or terms field blank to use the catalog default on the server.
                                </p>
                            </div>

                            <div className="space-y-4">
                                {TIER_KEYS.map((tier) => {
                                    const backendDefaultPrice = tierDefaults?.[tier];
                                    const backendDefaultTerm = defaultTerms?.[tier];
                                    return (
                                        <div key={tier} className="border-border bg-background rounded-sm border p-4">
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-start">
                                                <div>
                                                    <label
                                                        htmlFor={`tier-price-${tier}`}
                                                        className="text-foreground block font-mono text-xs font-semibold uppercase"
                                                    >
                                                        {TIER_LABELS[tier]} Price (USD)
                                                    </label>
                                                    <input
                                                        id={`tier-price-${tier}`}
                                                        type="number"
                                                        min="0"
                                                        step="0.01"
                                                        data-testid={`tier-price-${tier}`}
                                                        value={tiers[tier]}
                                                        onChange={(e) => setTiers((prev) => ({ ...prev, [tier]: e.target.value }))}
                                                        placeholder={
                                                            backendDefaultPrice !== undefined
                                                                ? `Default ($${Number(backendDefaultPrice).toFixed(2)})`
                                                                : 'Backend default'
                                                        }
                                                        className="border-input bg-card text-foreground focus:border-ring mt-1 min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs tabular-nums transition"
                                                    />
                                                    {renderFieldError(`tiers.${tier}`)}
                                                </div>

                                                <div className="sm:col-span-2">
                                                    <label
                                                        htmlFor={`tier-terms-${tier}`}
                                                        className="text-foreground block font-mono text-xs font-medium"
                                                    >
                                                        {TIER_LABELS[tier]} Terms <span className="text-muted-foreground">(optional, max 2000)</span>
                                                    </label>
                                                    <textarea
                                                        id={`tier-terms-${tier}`}
                                                        rows={2}
                                                        maxLength={2000}
                                                        data-testid={`tier-terms-${tier}`}
                                                        value={terms[tier]}
                                                        onChange={(e) => setTerms((prev) => ({ ...prev, [tier]: e.target.value }))}
                                                        placeholder={backendDefaultTerm || 'Leave blank for default tier terms'}
                                                        className="border-input bg-card text-foreground focus:border-ring mt-1 w-full rounded-sm border px-3 py-2 text-xs leading-relaxed transition"
                                                    />
                                                    {renderFieldError(`terms.${tier}`)}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Right Column: Authorization & Submit */}
                    <div className="lg:col-span-5">
                        <div className="border-border bg-card sticky top-32 space-y-5 rounded-lg border p-6 shadow-sm">
                            <h2 className="border-border text-muted-foreground border-b pb-3 font-mono text-sm font-semibold tracking-[0.08em] uppercase">
                                Wallet Authorization (EIP-191)
                            </h2>

                            <div className="space-y-3 text-xs leading-relaxed">
                                <p className="text-muted-foreground">
                                    Publishing requires an EIP-191 <code className="text-foreground font-mono">personal_sign</code> signature from the
                                    scholar wallet over a single-use challenge (10-minute expiry). Signing proves authorship control and does not move
                                    funds or spend gas.
                                </p>

                                {challengeMessage ? (
                                    <div className="border-border bg-background rounded-sm border p-3">
                                        <div className="text-muted-foreground mb-1 flex items-center justify-between font-mono text-[10px] uppercase">
                                            <span>Prepared Challenge</span>
                                            {challengeNonce && <span>Nonce: {challengeNonce.slice(0, 8)}…</span>}
                                        </div>
                                        <pre
                                            data-testid="challenge-message-preview"
                                            className="text-foreground font-mono text-[11px] whitespace-pre-wrap break-words"
                                        >
                                            {challengeMessage}
                                        </pre>
                                    </div>
                                ) : (
                                    <div className="border-border bg-background text-muted-foreground rounded-sm border p-3 font-mono text-[11px]">
                                        Clicking &ldquo;Sign &amp; Publish Manuscript&rdquo; requests a fresh single-use challenge for your connected
                                        wallet and opens the signature prompt.
                                    </div>
                                )}

                                {renderFieldError('challenge_message')}
                                {renderFieldError('signature')}
                            </div>

                            <button
                                type="submit"
                                data-testid="submit-upload-btn"
                                disabled={submitting}
                                className="bg-accent text-accent-foreground hover:bg-accent-deep flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:opacity-50"
                            >
                                {submitting ? (
                                    <span>
                                        {submitStage === 'challenge'
                                            ? 'Requesting Challenge...'
                                            : submitStage === 'signing'
                                              ? 'Sign Challenge in Wallet...'
                                              : 'Uploading Signed Manuscript...'}
                                    </span>
                                ) : (
                                    <span>Sign &amp; Publish Manuscript</span>
                                )}
                            </button>

                            <button
                                type="button"
                                data-testid="pre-fetch-challenge-btn"
                                onClick={handleRequestFreshChallenge}
                                disabled={fetchingChallenge || submitting}
                                className="border-border bg-background text-foreground hover:border-input flex min-h-11 w-full items-center justify-center rounded-full border px-4 py-2 font-mono text-xs font-medium transition disabled:opacity-50"
                            >
                                {fetchingChallenge ? 'Fetching Challenge...' : 'Preview / Refresh Challenge Message'}
                            </button>
                        </div>
                    </div>
                </form>
            </PublicShell>
        </>
    );
}
