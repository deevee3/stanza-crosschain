import {
    BASE_CHAIN_ID,
    BASE_USDC_ADDRESS,
    BASE_USDC_DECIMALS,
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
    tier: string;
    price_usd: number;
    deposit_asset: string;
    deposit_chain: string;
    deposit_address: string | null;
    quote_id: string | null;
    quote_payload?: QuotePayload | null;
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
}

const DEPOSIT_CHAINS = [
    { id: 'base', name: 'Base', asset: 'erc20:base:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC' },
    { id: 'near', name: 'NEAR Protocol', asset: 'nep141:wrap.near', symbol: 'NEAR' },
    { id: 'solana', name: 'Solana', asset: 'solana:native', symbol: 'SOL' },
    { id: 'arbitrum', name: 'Arbitrum', asset: 'arbitrum:native', symbol: 'ETH' },
];

export default function Checkout({ works }: Props) {
    const [selectedWorkId, setSelectedWorkId] = useState<number>(works[0]?.id || 1);
    const [selectedTier, setSelectedTier] = useState<string>('read');
    const [selectedChain, setSelectedChain] = useState(DEPOSIT_CHAINS[0]);
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [walletChainId, setWalletChainId] = useState<number | null>(null);
    const [connectingWallet, setConnectingWallet] = useState<boolean>(false);
    const [buyerAddress, setBuyerAddress] = useState<string>('');
    const [loading, setLoading] = useState<boolean>(false);
    const [paying, setPaying] = useState<boolean>(false);
    const [paymentTxHash, setPaymentTxHash] = useState<string | null>(null);
    const [preparedTransfer, setPreparedTransfer] = useState<PreparedUsdcTransfer | null>(null);
    const [currentLicense, setCurrentLicense] = useState<License | null>(null);
    const [copied, setCopied] = useState<boolean>(false);
    const [error, setError] = useState<string | null>(null);
    const [errorCount, setErrorCount] = useState<number>(0);

    const activeWork = works.find((w) => w.id === selectedWorkId) || works[0];
    const currentPrice = Number(activeWork?.tiers[selectedTier] ?? 1.0);

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
            setSelectedChain(DEPOSIT_CHAINS[0]); // Base USDC
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
            setSelectedChain(DEPOSIT_CHAINS[0]); // Base USDC
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

    const copyDepositAddress = () => {
        if (currentLicense?.deposit_address) {
            navigator.clipboard.writeText(currentLicense.deposit_address);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // Derive exact quoted USDC amount from quote_payload.amountIn (never hardcode)
    const quotedAmountInRaw = currentLicense?.quote_payload?.amountIn ?? null;
    const quotedAmountFormatted =
        currentLicense?.quote_payload?.amountInFormatted ??
        (quotedAmountInRaw && /^\d+$/.test(quotedAmountInRaw) ? formatUnits(BigInt(quotedAmountInRaw), BASE_USDC_DECIMALS) : null);

    return (
        <>
            <Head title="License It From Anywhere — Stanza Cross-Chain" />
            <PublicShell footerNote="Stanza Cross-Chain Licensing · Built with NEAR Intents 1Click & Chain Signatures MPC · Base Mainnet (8453)">
                {/* Header */}
                <header className="border-border mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <span className="bg-success h-2.5 w-2.5 animate-pulse rounded-full" />
                            <span className="text-muted-foreground font-mono text-xs font-semibold tracking-[0.08em] uppercase">
                                NEAR Intents 1Click + Chain Signatures MPC
                            </span>
                        </div>
                        <h1 className="text-foreground mt-2 text-4xl font-extrabold tracking-tight md:text-5xl">Stanza Cross-Chain Licensing</h1>
                        <p className="text-muted-foreground mt-2 max-w-[60ch] text-base leading-relaxed">
                            Connect wallet, click Buy, approve one payment. Settles on Base via NEAR MPC with zero server EVM keys.
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
                            <div className="grid grid-cols-3 gap-3">
                                {['read', 'citation', 'commercial'].map((tierKey) => {
                                    const price = Number(activeWork?.tiers[tierKey] ?? 0);
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

                            {error && (
                                <div
                                    key={`step3-err-${errorCount}`}
                                    className="border-destructive bg-destructive/10 text-foreground mb-3 rounded-lg border p-3 text-xs"
                                >
                                    {error}
                                </div>
                            )}

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

                            <button
                                type="button"
                                data-testid="buy-license-btn"
                                onClick={handleBuy}
                                disabled={loading}
                                className="bg-accent text-accent-foreground hover:bg-accent-deep mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold transition disabled:opacity-50"
                            >
                                {loading ? <span>Preparing 1Click Quote...</span> : <span>Buy (${currentPrice.toFixed(2)} USD)</span>}
                            </button>
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
                                    Connect wallet, select a manuscript, and click &ldquo;Buy&rdquo; to prepare your one-tap payment.
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
                                                    {quotedAmountFormatted} USDC
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Primary Seamless One-Tap Pay Action */}
                                    {currentLicense.status !== 'settled' && currentLicense.deposit_address && (
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
                                        ]}
                                    />

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
