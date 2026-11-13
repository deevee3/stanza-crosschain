import {
    BASE_CHAIN_ID,
    BASE_USDC_ADDRESS,
    connectInjectedWallet,
    getConnectedWalletSilent,
    getEthereumProvider,
    prepareUsdcTransferCall,
    sendUsdcTransferOnBase,
    switchInjectedWalletAccount,
    type PreparedUsdcTransfer,
} from '@/lib/wallet';
import { Head, Link } from '@inertiajs/react';
import { useEffect, useState } from 'react';
import { formatUnits } from 'viem';
import FactPanel from '../components/public/fact-panel';
import PublicShell from '../components/public/public-shell';

interface Work {
    id: number;
    work_id: string;
    title: string;
    slug: string;
    scholar_name: string;
    scholar_address: string;
    description: string;
    tiers: Record<string, number>;
    terms?: Record<string, string> | null;
}

interface QuotePayload {
    quoteId?: string | null;
    depositAddress?: string | null;
    originAsset?: string | null;
    destinationAsset?: string | null;
    amount?: string | null;
    amountIn?: string | null;
    amountInFormatted?: string | null;
    amountInUsd?: string | null;
    amountOut?: string | null;
    amountOutFormatted?: string | null;
    amountOutUsd?: string | null;
    recipient?: string | null;
    refundTo?: string | null;
    deadline?: string | null;
    timeEstimate?: number | null;
    status?: string | null;
    isStub?: boolean;
}

interface License {
    id: number;
    work_id: number;
    buyer_address: string;
    buyer_email?: string | null;
    refund_address?: string | null;
    tier: string;
    price_usd: number;
    payment_method?: string;
    deposit_asset: string;
    deposit_chain: string;
    deposit_address: string | null;
    quote_id: string | null;
    quote_payload?: QuotePayload | null;
    paypal_order_id?: string | null;
    paypal_authorization_id?: string | null;
    paypal_capture_id?: string | null;
    attestation_payload?: {
        decision?: string;
        mode?: string;
        rationale?: string;
    } | null;
    deposit_tx_hash: string | null;
    proof_hash: string | null;
    settlement_tx_hash: string | null;
    status: string;
    error_message?: string | null;
    settled_at: string | null;
    work?: Work;
}

interface Props {
    works: Work[];
    returnLicenseId?: number;
}

// Origin-chain asset IDs, exactly as the live 1Click /v0/tokens registry
// lists them (verified 2026-11-12). The Base USDC erc20 form is normalized
// to its omft form server-side; the legacy `solana:native` /
// `arbitrum:native` IDs are rejected by the live API ("tokenIn is not
// valid") and are mapped server-side for stale clients.
const DEPOSIT_CHAINS = [
    { id: 'base', name: 'Base', asset: 'erc20:base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    { id: 'near', name: 'NEAR Protocol', asset: 'nep141:wrap.near', symbol: 'NEAR', decimals: 24 },
    { id: 'solana', name: 'Solana', asset: 'nep141:sol.omft.near', symbol: 'SOL', decimals: 9 },
    { id: 'arbitrum', name: 'Arbitrum', asset: 'nep141:arb.omft.near', symbol: 'ETH', decimals: 18 },
];

const chainById = (id: string | null | undefined) => DEPOSIT_CHAINS.find((c) => c.id === id) ?? DEPOSIT_CHAINS[0];

// Catalog tier defaults (USD) and default terms. These MUST match
// App\Models\Work::TIER_DEFAULTS / DEFAULT_TERMS — the backend is
// authoritative at quote time; these keep the UI honest when a work has
// no price or terms stored for a tier.
const TIER_KEYS = ['read', 'citation', 'commercial', 'exclusive'];

const TIER_DEFAULTS: Record<string, number> = {
    read: 10,
    citation: 25,
    commercial: 150,
    exclusive: 500,
};

const DEFAULT_TERMS: Record<string, string> = {
    read: 'Read the full work for personal, non-commercial use. No redistribution.',
    citation: 'Cite the work with attribution in your own publications. No redistribution of the full text.',
    commercial: 'Reuse the work commercially with attribution. No resale of the work itself.',
    exclusive: 'Exclusive license: sole commercial reuse rights for the term agreed with the scholar.',
};

export default function Checkout({ works, returnLicenseId }: Props) {
    const [selectedWorkId, setSelectedWorkId] = useState<number>(works[0]?.id || 1);
    const [selectedTier, setSelectedTier] = useState<string>('read');
    const [selectedChain, setSelectedChain] = useState(DEPOSIT_CHAINS[0]);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [walletChainId, setWalletChainId] = useState<number | null>(null);
    const [connectingWallet, setConnectingWallet] = useState<boolean>(false);
    const [paymentMethod, setPaymentMethod] = useState<'oneclick' | 'paypal'>('oneclick');
    const [buyerAddress, setBuyerAddress] = useState<string>('');
    const [buyerEmail, setBuyerEmail] = useState<string>('');
    const [refundAddress, setRefundAddress] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [paying, setPaying] = useState<boolean>(false);
    const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
    const [preparedTransfer, setPreparedTransfer] = useState<PreparedUsdcTransfer | null>(null);
    const [currentLicense, setCurrentLicense] = useState<License | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCount, setErrorCount] = useState<number>(0);

    // Coming back from PayPal approval: load the license the return
    // route authorized (or failed) so the status card shows what happened.
    useEffect(() => {
        if (!returnLicenseId) return;
        fetch(`/api/licenses/${returnLicenseId}`, { headers: { Accept: 'application/json' } })
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                if (data?.license) setCurrentLicense(data.license);
            })
            .catch(() => undefined);
    }, [returnLicenseId]);

    const activeWork = works.find((w) => w.id === selectedWorkId) || works[0];
    const currentPrice = Number(activeWork?.tiers[selectedTier] ?? TIER_DEFAULTS[selectedTier] ?? TIER_DEFAULTS.read);
    const currentTerms = activeWork?.terms?.[selectedTier] ?? DEFAULT_TERMS[selectedTier] ?? DEFAULT_TERMS.read;

    // Check if wallet is already connected on mount
    useEffect(() => {
        getConnectedWalletSilent().then((connected) => {
            if (connected) {
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
                setBuyerAddress(connected.address);
            }
        });
    }, []);

    // Keep wallet listeners in sync
    useEffect(() => {
        const provider = getEthereumProvider();
        if (!provider?.on) return;

        const handleAccountsChanged = (accounts: string[]) => {
            if (accounts && accounts.length > 0) {
                setWalletAddress(accounts[0]);
                setBuyerAddress(accounts[0]);
                setError(null);
            } else {
                setWalletAddress(null);
                setWalletChainId(null);
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

    // Poll license status so the UI updates automatically from pending -> quoted -> deposited -> settled
    useEffect(() => {
        if (!currentLicense?.id) return;
        if (currentLicense.status === 'settled' || currentLicense.status === 'failed') return;

        const interval = setInterval(async () => {
            try {
                const res = await fetch(`/api/licenses/${currentLicense.id}`, {
                    headers: { Accept: 'application/json' },
                });
                if (!res.ok) return;
                const data = await res.json();
                if (data?.license) {
                    setCurrentLicense(data.license);
                }
            } catch {
                // ignore transient network errors during polling
            }
        }, 2500);

        return () => clearInterval(interval);
    }, [currentLicense?.id, currentLicense?.status]);

    const reportError = (msg: string) => {
        setError(msg);
        setErrorCount((c) => c + 1);
    };

    const handleConnectWallet = async () => {
        setConnectingWallet(true);
        setError(null);
        try {
            const { address, chainId } = await connectInjectedWallet();
            setWalletAddress(address);
            setWalletChainId(chainId);
            setBuyerAddress(address);
        } catch (err: any) {
            reportError(err.message || 'Failed to connect wallet.');
        } finally {
            setConnectingWallet(false);
        }
    };

    const handleSwitchWallet = async () => {
        setConnectingWallet(true);
        setError(null);
        try {
            const { address, chainId } = await switchInjectedWalletAccount();
            setWalletAddress(address);
            setWalletChainId(chainId);
            setBuyerAddress(address);
        } catch (err: any) {
            reportError(err.message || 'Failed to switch wallet account.');
        } finally {
            setConnectingWallet(false);
        }
    };

    const waitForQuotedLicense = async (licenseId: number, initial: License): Promise<License> => {
        if (initial.deposit_address && initial.quote_payload?.amountIn) {
            return initial;
        }

        const deadline = Date.now() + 20000;
        let latest = initial;

        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 700));
            const res = await fetch(`/api/licenses/${licenseId}`, {
                headers: { Accept: 'application/json' },
            });
            if (res.ok) {
                const data = await res.json();
                if (data?.license) {
                    latest = data.license;
                    if (latest.status === 'failed') {
                        throw new Error(latest.error_message || '1Click quote failed.');
                    }
                    if (latest.deposit_address && latest.quote_payload?.amountIn) {
                        return latest;
                    }
                }
            }
        }

        return latest;
    };

    const handleBuy = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setPaymentTxHash(null);
        setPreparedTransfer(null);

        try {
            // Refunds go to the origin chain, so NEAR and Solana checkouts
            // need an origin-chain refund address up front. The server
            // validates authoritatively; this catches obvious mistakes
            // before the quote is requested.
            const needsRefundAddress = selectedChain.id === 'near' || selectedChain.id === 'solana';
            const trimmedRefund = refundAddress.trim();
            if (needsRefundAddress) {
                const validRefund =
                    selectedChain.id === 'near'
                        ? /^(?!0x)([0-9a-f]{64}|[a-z0-9][a-z0-9_\-.]*[a-z0-9])$/.test(trimmedRefund) &&
                          trimmedRefund.length >= 2 &&
                          trimmedRefund.length <= 64
                        : /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmedRefund);
                if (!validRefund) {
                    throw new Error(
                        selectedChain.id === 'near'
                            ? 'Enter a valid NEAR account for refunds (e.g. you.near).'
                            : 'Enter a valid Solana address for refunds.',
                    );
                }
            }

            let activeBuyer = buyerAddress.trim();
            if (!activeBuyer) {
                const connected = await connectInjectedWallet();
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
                setBuyerAddress(connected.address);
                activeBuyer = connected.address;
            }

            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content;

            const res = await fetch('/api/quote', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrfToken || '',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    work_id: activeWork.id,
                    tier: selectedTier,
                    buyer_address: activeBuyer,
                    refund_address: needsRefundAddress ? trimmedRefund : undefined,
                    deposit_asset: selectedChain.asset,
                    deposit_chain: selectedChain.id,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.message || 'Failed to generate quote');
            }

            const quotedLicense = await waitForQuotedLicense(data.license.id, data.license);
            setCurrentLicense(quotedLicense);
        } catch (err: any) {
            reportError(err.message || 'An error occurred generating the 1Click quote.');
        } finally {
            setLoading(false);
        }
    };

    const handlePay = async () => {
        if (!currentLicense?.deposit_address) {
            reportError('Quote deposit address is not ready yet.');
            return;
        }

        const amountInRaw = currentLicense.quote_payload?.amountIn;
        if (!amountInRaw) {
            reportError('Quote exact amountIn is missing from the quote payload.');
            return;
        }

        setPaying(true);
        setError(null);

        try {
            let activeAccount = walletAddress;
            if (!activeAccount) {
                const connected = await connectInjectedWallet();
                setWalletAddress(connected.address);
                setWalletChainId(connected.chainId);
                setBuyerAddress(connected.address);
                activeAccount = connected.address;
            }

            // Prepare & preview the exact ERC-20 transfer call before/as wallet opens
            const preview = prepareUsdcTransferCall({
                from: activeAccount,
                depositAddress: currentLicense.deposit_address,
                amountInRaw,
            });
            setPreparedTransfer(preview);

            const { txHash } = await sendUsdcTransferOnBase({
                account: activeAccount,
                depositAddress: currentLicense.deposit_address,
                amountInRaw,
                onPrepared: (p) => setPreparedTransfer(p),
            });

            setPaymentTxHash(txHash);
        } catch (err: any) {
            reportError(err?.shortMessage || err?.message || 'Wallet payment was cancelled or failed.');
        } finally {
            setPaying(false);
        }
    };

    const handlePayPalCheckout = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const email = buyerEmail.trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                throw new Error('Enter a valid email address for the PayPal license.');
            }

            const csrfToken = (document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement)?.content;

            const res = await fetch('/api/paypal/order', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-TOKEN': csrfToken || '',
                    Accept: 'application/json',
                },
                body: JSON.stringify({
                    work_id: activeWork.id,
                    tier: selectedTier,
                    buyer_email: email,
                    // A connected wallet's address is used when present so
                    // the on-chain record keys to a wallet the buyer
                    // controls; otherwise the server derives one from the
                    // email. A wallet is never required for PayPal.
                    buyer_address: walletAddress || undefined,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(
                    data.error === 'paypal_not_configured'
                        ? 'PayPal checkout is not online yet (sandbox credentials are not configured).'
                        : data.message || 'Failed to create the PayPal order.',
                );
            }

            // PayPal approval happens on PayPal (sandbox). The buyer comes
            // back to /paypal/return, where the payment is authorized (held)
            // and the attestation agent decides whether to capture it.
            window.location.href = data.approve_url;
        } catch (err: any) {
            setError(err.message || 'An error occurred starting PayPal checkout.');
        } finally {
            setLoading(false);
        }
    };

    const copyDepositAddress = () => {
        if (currentLicense?.deposit_address) {
            navigator.clipboard.writeText(currentLicense.deposit_address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // The license's own chain is authoritative for the amount display: the
    // quote is priced in the origin asset (USDC on Base, NEAR, SOL, ETH),
    // each with its own decimals. Never hardcode the amount or the asset.
    const licenseChain = chainById(currentLicense?.deposit_chain ?? selectedChain.id);
    const quotedAmountInRaw = currentLicense?.quote_payload?.amountIn ?? null;
    const quotedAmountFormatted =
        currentLicense?.quote_payload?.amountInFormatted ??
        (quotedAmountInRaw && /^\d+$/.test(quotedAmountInRaw) ? formatUnits(BigInt(quotedAmountInRaw), licenseChain.decimals) : null);
    const quoteDeadlineRaw = currentLicense?.quote_payload?.deadline ?? null;
    const quoteDeadlineLabel = quoteDeadlineRaw && !Number.isNaN(Date.parse(quoteDeadlineRaw)) ? new Date(quoteDeadlineRaw).toLocaleString() : null;

    return (
        <>
            <Head title="License It From Anywhere — Stanza Cross-Chain" />
            <PublicShell footerNote="Stanza Cross-Chain Licensing · Built with NEAR Intents 1Click & Chain Signatures MPC · Base Mainnet (8453)">
                {/* Header */}
                <header className="border-border mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="bg-success h-2.5 w-2.5 animate-pulse rounded-full" />
                            <span className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.08em] uppercase">Live</span>
                        </div>
                        <h1 className="text-foreground mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Stanza Cross-Chain Licensing</h1>
                        <p className="text-muted-foreground mt-2 max-w-[60ch] text-base leading-relaxed">
                            Connect your wallet, pick a work and a tier, and check out.
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
                            href="/lookup"
                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 font-mono text-xs font-medium transition"
                        >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            License Lookup
                        </Link>
                    </div>
                </header>

                {error && (
                    <div
                        key={`top-err-${errorCount}`}
                        data-testid="checkout-error-banner"
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

                <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
                    {/* Left Column: Form & Work Selection */}
                    <div className="space-y-6 lg:col-span-7">
                        {/* Step 1: Work Selection */}
                        <div className="border-border bg-card rounded-lg border p-5 shadow-sm sm:p-6">
                            <label className="text-muted-foreground mb-3 block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                1. Select Scholarly Manuscript
                            </label>
                            <div className="space-y-3">
                                {works.map((work) => {
                                    const isSelected = work.id === activeWork.id;
                                    return (
                                        <div
                                            key={work.id}
                                            onClick={() => setSelectedWorkId(work.id)}
                                            className={`cursor-pointer rounded-sm border p-4 transition ${
                                                isSelected
                                                    ? 'border-accent bg-accent-soft ring-accent/50 ring-1'
                                                    : 'border-border bg-background hover:border-input'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <h3 className="text-foreground text-base leading-snug font-semibold">{work.title}</h3>
                                                {isSelected && (
                                                    <span className="bg-accent text-accent-foreground rounded-full px-2 py-1 font-mono text-[10px] font-semibold uppercase">
                                                        Selected
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-muted-foreground mt-1 text-xs">
                                                Scholar:{' '}
                                                <Link
                                                    href={`/scholar/${work.scholar_address}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-foreground decoration-accent/60 hover:decoration-accent font-medium underline underline-offset-4"
                                                >
                                                    {work.scholar_name}
                                                </Link>
                                            </p>
                                            <p className="text-muted-foreground mt-1 truncate font-mono text-[11px]">
                                                Base Address:{' '}
                                                <Link
                                                    href={`/scholar/${work.scholar_address}`}
                                                    onClick={(e) => e.stopPropagation()}
                                                    className="text-muted-foreground decoration-accent/60 hover:text-foreground hover:decoration-accent underline underline-offset-4"
                                                >
                                                    {work.scholar_address}
                                                </Link>
                                            </p>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Step 2: License Tier Selection */}
                        <div className="border-border bg-card rounded-lg border p-5 shadow-sm sm:p-6">
                            <label className="text-muted-foreground mb-3 block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                2. Select License Tier
                            </label>
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                {TIER_KEYS.map((tierKey) => {
                                    const price = Number(activeWork?.tiers[tierKey] ?? TIER_DEFAULTS[tierKey] ?? 0);
                                    const isSelected = selectedTier === tierKey;
                                    return (
                                        <button
                                            type="button"
                                            key={tierKey}
                                            aria-pressed={isSelected}
                                            onClick={() => setSelectedTier(tierKey)}
                                            className={`rounded-sm border p-3 text-center transition ${
                                                isSelected
                                                    ? 'border-primary bg-primary text-primary-foreground'
                                                    : 'border-border bg-background text-foreground hover:border-input'
                                            }`}
                                        >
                                            <div className="font-mono text-xs font-semibold tracking-[0.08em] uppercase">{tierKey}</div>
                                            <div className="mt-1 text-lg font-bold tabular-nums">${price.toFixed(2)}</div>
                                            <div
                                                className={`mt-0.5 text-[10px] ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                                            >
                                                USDC on Base
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                                <span className="text-foreground font-medium capitalize">{selectedTier} terms: </span>
                                {currentTerms}
                            </p>
                        </div>

                        {/* Step 3: Wallet & One-Tap Buy */}
                        <div className="border-border bg-card rounded-lg border p-5 shadow-sm sm:p-6">
                            <div className="mb-3 flex items-center justify-between gap-2">
                                <label className="text-muted-foreground block font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                    3. Buyer Wallet & Checkout
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

                            <div className="mb-4 grid grid-cols-2 gap-2">
                                <button
                                    type="button"
                                    aria-pressed={paymentMethod === 'oneclick'}
                                    onClick={() => setPaymentMethod('oneclick')}
                                    className={`rounded-sm border p-2.5 text-center transition ${
                                        paymentMethod === 'oneclick'
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border bg-background text-foreground hover:border-input'
                                    }`}
                                >
                                    <div className="text-xs font-medium">Crypto (1Click)</div>
                                    <div
                                        className={`mt-0.5 font-mono text-[11px] ${paymentMethod === 'oneclick' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                                    >
                                        NEAR · SOL · EVM
                                    </div>
                                </button>
                                <button
                                    type="button"
                                    aria-pressed={paymentMethod === 'paypal'}
                                    onClick={() => setPaymentMethod('paypal')}
                                    className={`rounded-sm border p-2.5 text-center transition ${
                                        paymentMethod === 'paypal'
                                            ? 'border-primary bg-primary text-primary-foreground'
                                            : 'border-border bg-background text-foreground hover:border-input'
                                    }`}
                                >
                                    <div className="text-xs font-medium">PayPal (Sandbox)</div>
                                    <div
                                        className={`mt-0.5 font-mono text-[11px] ${paymentMethod === 'paypal' ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                                    >
                                        Held until attested
                                    </div>
                                </button>
                            </div>

                            {/* Origin chain picker. Base keeps the one-tap flow; NEAR, Solana, and Arbitrum use the deposit-address flow. */}
                            {paymentMethod === 'oneclick' && (
                                <div className="mb-4">
                                    <label className="text-muted-foreground mb-2 block font-mono text-xs">Pay From</label>
                                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="chain-picker">
                                        {DEPOSIT_CHAINS.map((chain) => {
                                            const isSelected = selectedChain.id === chain.id;
                                            return (
                                                <button
                                                    type="button"
                                                    key={chain.id}
                                                    data-testid={`chain-option-${chain.id}`}
                                                    aria-pressed={isSelected}
                                                    onClick={() => setSelectedChain(chain)}
                                                    className={`rounded-sm border p-2.5 text-center transition ${
                                                        isSelected
                                                            ? 'border-primary bg-primary text-primary-foreground'
                                                            : 'border-border bg-background text-foreground hover:border-input'
                                                    }`}
                                                >
                                                    <div className="text-xs font-medium">{chain.name}</div>
                                                    <div
                                                        className={`mt-0.5 font-mono text-[11px] ${isSelected ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}
                                                    >
                                                        {chain.symbol}
                                                    </div>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {paymentMethod === 'oneclick' && (selectedChain.id === 'near' || selectedChain.id === 'solana') && (
                                <div className="mb-4">
                                    <label className="text-muted-foreground mb-1 block font-mono text-xs">
                                        {selectedChain.id === 'near' ? 'NEAR Refund Account' : 'Solana Refund Address'}
                                    </label>
                                    <input
                                        type="text"
                                        data-testid="refund-address-input"
                                        value={refundAddress}
                                        onChange={(e) => setRefundAddress(e.target.value)}
                                        className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs transition"
                                        placeholder={selectedChain.id === 'near' ? 'you.near' : 'Solana wallet address'}
                                        required
                                    />
                                    <p className="text-muted-foreground mt-1 text-[11px]">
                                        {selectedChain.id === 'near'
                                            ? 'If the swap fails, the refund goes here. It must be an existing NEAR account you control.'
                                            : 'If the swap fails, the refund goes here. It must be an address you control on Solana.'}
                                    </p>
                                </div>
                            )}

                            {error && (
                                <div
                                    key={`step3-err-${errorCount}`}
                                    className="border-destructive bg-destructive/10 text-foreground mb-3 rounded-lg border p-3 text-xs"
                                >
                                    {error}
                                </div>
                            )}

                            {paymentMethod === 'oneclick' ? (
                                <div>
                                    <div className="mb-1 flex items-center justify-between">
                                        <label className="text-muted-foreground block font-mono text-xs">Buyer EVM Address (Licensee)</label>
                                        {walletAddress && (
                                            <span className="text-foreground inline-flex items-center gap-1.5 font-mono text-[10px] font-semibold">
                                                <span className="bg-success h-1.5 w-1.5 rounded-full" />
                                                Connected & Locked
                                            </span>
                                        )}
                                    </div>
                                    <input
                                        type="text"
                                        data-testid="buyer-address-input"
                                        value={buyerAddress}
                                        readOnly={Boolean(walletAddress)}
                                        onChange={(e) => {
                                            if (!walletAddress) {
                                                setBuyerAddress(e.target.value);
                                            }
                                        }}
                                        className={`min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs transition ${
                                            walletAddress
                                                ? 'border-accent/40 bg-muted text-muted-foreground cursor-not-allowed'
                                                : 'border-input bg-background text-foreground focus:border-ring'
                                        }`}
                                        placeholder="Connect wallet to auto-fill (0x...)"
                                        required
                                    />
                                    <p className="text-muted-foreground mt-1 text-[11px]">
                                        The address recorded as the verified buyer on Base LicenseRegistry.
                                    </p>
                                </div>
                            ) : (
                                <div>
                                    <label className="text-muted-foreground mb-1 block font-mono text-xs">Email (Licensee)</label>
                                    <input
                                        type="email"
                                        data-testid="buyer-email-input"
                                        value={buyerEmail}
                                        onChange={(e) => setBuyerEmail(e.target.value)}
                                        className="border-input bg-background text-foreground focus:border-ring min-h-11 w-full rounded-sm border px-3 py-2 font-mono text-xs transition"
                                        placeholder="you@example.com"
                                        required
                                    />
                                    <p className="text-muted-foreground mt-1 text-[11px]">
                                        No wallet needed. Your license is recorded on Base under an address derived from this email.
                                    </p>
                                </div>
                            )}

                            {paymentMethod === 'oneclick' ? (
                                <button
                                    type="button"
                                    data-testid="buy-license-btn"
                                    onClick={handleBuy}
                                    disabled={loading}
                                    className="bg-accent text-accent-foreground hover:bg-accent-deep mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:opacity-50"
                                >
                                    {loading ? (
                                        <span>Preparing 1Click Quote...</span>
                                    ) : (
                                        <span>
                                            {selectedChain.id === 'base'
                                                ? `Buy ($${currentPrice.toFixed(2)} USD)`
                                                : `Get Deposit Address ($${currentPrice.toFixed(2)} USD)`}
                                        </span>
                                    )}
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    onClick={handlePayPalCheckout}
                                    disabled={loading}
                                    className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-[#ffc439] px-4 py-3 text-sm font-semibold text-[#003087] transition hover:bg-[#ffce5e] disabled:opacity-50"
                                >
                                    {loading ? (
                                        <span>Starting PayPal checkout...</span>
                                    ) : (
                                        <span>Continue with PayPal — ${currentPrice.toFixed(2)} USD (Sandbox)</span>
                                    )}
                                </button>
                            )}
                            {paymentMethod === 'paypal' && (
                                <p className="text-muted-foreground mt-2 text-[11px]">
                                    PayPal holds the payment — it is only captured after the licensing agent attests the license. If the attestation
                                    fails, the hold is voided and you are never charged.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Right Column: Quote & MPC Settlement Card */}
                    <div className="lg:col-span-5">
                        <div className="border-border bg-card sticky top-32 rounded-lg border p-6 shadow-sm">
                            <h2 className="border-border text-muted-foreground border-b pb-3 font-mono text-sm font-semibold tracking-[0.08em] uppercase">
                                Settlement Summary
                            </h2>

                            {!currentLicense ? (
                                <div className="text-muted-foreground py-12 text-center font-mono text-xs leading-relaxed">
                                    Select a manuscript, pick a chain, and click &ldquo;Buy&rdquo; or &ldquo;Get Deposit Address&rdquo; to get a quote
                                    — one-tap payment on Base, a deposit address on other chains.
                                </div>
                            ) : (
                                <div className="mt-4 space-y-5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div>
                                            <span className="text-muted-foreground font-mono text-[11px] tracking-[0.08em] uppercase">Status</span>
                                            <div className="mt-1 flex items-center gap-2">
                                                <span
                                                    className={`h-2.5 w-2.5 rounded-full ${
                                                        currentLicense.status === 'settled' ? 'bg-success' : 'bg-warning animate-pulse'
                                                    }`}
                                                />
                                                <span data-testid="license-status" className="text-foreground font-mono text-sm font-bold uppercase">
                                                    {currentLicense.status}
                                                </span>
                                            </div>
                                        </div>
                                        {quotedAmountFormatted && (
                                            <div className="text-right">
                                                <span className="text-muted-foreground font-mono text-[11px] tracking-[0.08em] uppercase">
                                                    Exact Quote Amount
                                                </span>
                                                <div
                                                    data-testid="quoted-amount-display"
                                                    className="text-foreground mt-1 font-mono text-sm font-bold tabular-nums"
                                                >
                                                    {quotedAmountFormatted} {licenseChain.symbol}
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {currentLicense.status === 'failed' && currentLicense.error_message && (
                                        <div className="border-destructive bg-destructive/10 text-foreground rounded-sm border p-2.5 text-xs">
                                            {currentLicense.error_message}
                                        </div>
                                    )}

                                    {/* Primary Seamless One-Tap Pay Action (Base only) */}
                                    {currentLicense.status !== 'settled' &&
                                        currentLicense.status !== 'failed' &&
                                        currentLicense.deposit_address &&
                                        currentLicense.deposit_chain === 'base' && (
                                            <div className="space-y-2.5">
                                                <button
                                                    type="button"
                                                    data-testid="pay-now-btn"
                                                    onClick={handlePay}
                                                    disabled={paying || !quotedAmountInRaw}
                                                    className="bg-accent text-accent-foreground shadow-glow hover:bg-accent-deep flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 py-3.5 text-sm font-bold transition disabled:opacity-50"
                                                >
                                                    {paying ? (
                                                        <span>Confirm in Wallet...</span>
                                                    ) : (
                                                        <span>Pay {quotedAmountFormatted ? `${quotedAmountFormatted} USDC` : 'Now'}</span>
                                                    )}
                                                </button>

                                                {paymentTxHash && (
                                                    <div className="border-success/40 bg-success/10 text-foreground rounded-sm border p-2.5 font-mono text-xs">
                                                        <div className="font-semibold">✓ Payment submitted on Base</div>
                                                        <div className="text-muted-foreground mt-0.5 truncate text-[11px]">Tx: {paymentTxHash}</div>
                                                        <div className="text-muted-foreground mt-1 text-[11px]">
                                                            Waiting for 1Click verification & NEAR MPC settlement...
                                                        </div>
                                                    </div>
                                                )}

                                                {preparedTransfer && !paymentTxHash && (
                                                    <div
                                                        data-testid="prepared-transfer-details"
                                                        className="border-border bg-background text-muted-foreground space-y-1 rounded-sm border p-2.5 font-mono text-[11px]"
                                                    >
                                                        <div className="text-foreground font-semibold">Wallet Transfer Request (Base 8453)</div>
                                                        <div className="truncate">Token: {BASE_USDC_ADDRESS}</div>
                                                        <div className="truncate">To: {preparedTransfer.to}</div>
                                                        <div>
                                                            Amount: {preparedTransfer.amountFormatted} USDC ({preparedTransfer.amountIn} units)
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Small manual fallback line */}
                                                <div className="text-muted-foreground flex items-center justify-between gap-2 pt-1 font-mono text-[11px]">
                                                    <span className="truncate">
                                                        or send manually to{' '}
                                                        <span data-testid="fallback-deposit-address" className="text-foreground select-all">
                                                            {currentLicense.deposit_address}
                                                        </span>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={copyDepositAddress}
                                                        className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-[10px] transition"
                                                        title="Copy deposit address"
                                                    >
                                                        {copied ? 'Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                    {/* Deposit-address flow (NEAR, Solana, Arbitrum): send the exact quoted amount from any wallet on the origin chain. */}
                                    {currentLicense.status !== 'settled' &&
                                        currentLicense.status !== 'failed' &&
                                        currentLicense.deposit_address &&
                                        currentLicense.deposit_chain !== 'base' && (
                                            <div className="space-y-2.5">
                                                <div>
                                                    <span className="text-muted-foreground font-mono text-[11px] tracking-[0.08em] uppercase">
                                                        1Click Deposit Address ({licenseChain.name})
                                                    </span>
                                                    <div className="border-border bg-background mt-1 flex items-center gap-1.5 rounded-sm border p-2.5">
                                                        <span
                                                            data-testid="deposit-address-display"
                                                            className="text-foreground font-mono text-xs break-all select-all"
                                                        >
                                                            {currentLicense.deposit_address}
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={copyDepositAddress}
                                                            className="border-border bg-card text-foreground hover:border-input inline-flex min-h-11 shrink-0 items-center rounded-full border px-3 text-[10px] transition"
                                                            title="Copy deposit address"
                                                        >
                                                            {copied ? 'Copied' : 'Copy'}
                                                        </button>
                                                    </div>
                                                </div>

                                                {quotedAmountFormatted && (
                                                    <div className="border-border bg-background text-foreground rounded-sm border p-2.5 font-mono text-[11px] leading-relaxed">
                                                        Send exactly {quotedAmountFormatted} {licenseChain.symbol} to the deposit address from any{' '}
                                                        {licenseChain.name} wallet.
                                                        {quoteDeadlineLabel && <> Quote valid until {quoteDeadlineLabel}.</>}
                                                    </div>
                                                )}

                                                <p className="text-muted-foreground text-[11px] leading-relaxed">
                                                    The watcher polls automatically — this page updates when the deposit lands, and the license
                                                    records on Base after settlement. You can also look the license up later by deposit address or
                                                    transaction hash.
                                                </p>
                                            </div>
                                        )}

                                    <FactPanel
                                        className="border-border border-t pt-4"
                                        fields={[
                                            {
                                                label: 'Work:',
                                                value: <span className="font-mono text-sm">{activeWork.title}</span>,
                                            },
                                            {
                                                label: 'Scholar Address:',
                                                value: (
                                                    <Link
                                                        href={`/scholar/${activeWork.scholar_address}`}
                                                        className="text-foreground decoration-accent/60 hover:decoration-accent font-mono text-sm break-all underline underline-offset-4"
                                                        title={`View ${activeWork.scholar_name}'s licenses`}
                                                    >
                                                        {activeWork.scholar_address.slice(0, 8)}...
                                                        {activeWork.scholar_address.slice(-6)}
                                                    </Link>
                                                ),
                                            },
                                            {
                                                label: 'Tier:',
                                                value: <span className="uppercase">{currentLicense.tier}</span>,
                                            },
                                            {
                                                label: 'Settlement Chain:',
                                                value: 'Base Mainnet (8453)',
                                            },
                                            {
                                                label: 'Signing Authority:',
                                                value: 'NEAR MPC (path ethereum-1)',
                                            },
                                            ...(currentLicense.payment_method === 'paypal'
                                                ? [
                                                      {
                                                          label: 'Payment:',
                                                          value: 'PayPal Sandbox (held)',
                                                      },
                                                      ...(currentLicense.paypal_order_id
                                                          ? [
                                                                {
                                                                    label: 'PayPal Order:',
                                                                    value: (
                                                                        <span className="font-mono text-sm break-all">
                                                                            {currentLicense.paypal_order_id}
                                                                        </span>
                                                                    ),
                                                                },
                                                            ]
                                                          : []),
                                                      ...(currentLicense.attestation_payload
                                                          ? [
                                                                {
                                                                    label: 'Attestation:',
                                                                    value: (
                                                                        <span className="uppercase">
                                                                            {currentLicense.attestation_payload.decision} ·{' '}
                                                                            {currentLicense.attestation_payload.mode}
                                                                        </span>
                                                                    ),
                                                                },
                                                            ]
                                                          : []),
                                                  ]
                                                : []),
                                        ]}
                                    />

                                    {currentLicense.payment_method === 'paypal' && currentLicense.attestation_payload?.rationale && (
                                        <div className="text-muted-foreground mt-3 text-[11px] leading-snug">
                                            {currentLicense.attestation_payload.rationale}
                                        </div>
                                    )}

                                    {currentLicense.settlement_tx_hash && (
                                        <div className="border-success/40 bg-success/10 rounded-sm border p-3 font-mono text-xs">
                                            <div className="text-foreground mb-1 font-semibold">✓ BaseScan Settlement Receipt</div>
                                            <a
                                                href={`https://basescan.org/tx/${currentLicense.settlement_tx_hash}`}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="text-foreground decoration-accent/60 hover:decoration-accent break-all underline underline-offset-4"
                                            >
                                                {currentLicense.settlement_tx_hash}
                                            </a>
                                            <div className="text-muted-foreground mt-2 text-[11px] leading-relaxed">
                                                Attestation: Scholar recognized on-chain in STANZA credit event.
                                            </div>
                                            <div className="border-border mt-3 border-t pt-2.5">
                                                <Link
                                                    href={`/scholar/${activeWork.scholar_address}`}
                                                    className="text-foreground decoration-accent/60 hover:decoration-accent inline-flex min-h-11 items-center gap-1 text-[11px] underline underline-offset-4"
                                                >
                                                    View Scholar's Complete Portfolio →
                                                </Link>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </PublicShell>
        </>
    );
}
