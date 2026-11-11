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
        (quotedAmountInRaw && /^\d+$/.test(quotedAmountInRaw)
            ? formatUnits(BigInt(quotedAmountInRaw), BASE_USDC_DECIMALS)
            : null);

    return (
        <>
            <Head title="License It From Anywhere — Stanza Cross-Chain" />
            <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-8 md:py-12 flex flex-col justify-between">
                <div className="max-w-4xl mx-auto w-full">
                    {/* Header */}
                    <header className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between border-b border-neutral-800 pb-5 gap-4">
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                                <span className="text-xs uppercase tracking-widest text-emerald-400 font-mono font-semibold">
                                    NEAR Intents 1Click + Chain Signatures MPC
                                </span>
                            </div>
                            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white mt-1">
                                Stanza Cross-Chain Licensing
                            </h1>
                            <p className="text-sm text-neutral-400 mt-1">
                                Connect wallet, click Buy, approve one payment. Settles on Base via NEAR MPC with zero server EVM keys.
                            </p>
                        </div>
                        <div className="flex items-center gap-2.5">
                            {walletAddress ? (
                                <button
                                    type="button"
                                    data-testid="connected-wallet-badge"
                                    onClick={handleSwitchWallet}
                                    title="Click to switch wallet account"
                                    className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-mono font-medium rounded-lg bg-emerald-950/50 hover:bg-emerald-900/50 border border-emerald-500/50 text-emerald-300 transition"
                                >
                                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                                    <span>
                                        {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
                                    </span>
                                    <span className="text-[10px] text-emerald-400/80 border-l border-emerald-800 pl-2">
                                        {walletChainId === BASE_CHAIN_ID ? 'Base' : `Chain ${walletChainId ?? '?'}`}
                                    </span>
                                </button>
                            ) : (
                                <button
                                    type="button"
                                    data-testid="connect-wallet-btn"
                                    onClick={handleConnectWallet}
                                    disabled={connectingWallet}
                                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 transition disabled:opacity-50"
                                >
                                    {connectingWallet ? 'Connecting...' : 'Connect Wallet'}
                                </button>
                            )}
                            <Link
                                href="/lookup"
                                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-mono font-medium rounded-lg bg-neutral-900 border border-neutral-800 hover:border-neutral-700 hover:bg-neutral-850 text-neutral-300 transition"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                            className="mb-6 rounded-lg bg-rose-950/80 border border-rose-500/70 p-4 text-sm text-rose-100 flex items-start justify-between gap-3"
                        >
                            <span>{error}</span>
                            <button
                                type="button"
                                onClick={() => setError(null)}
                                className="text-xs font-mono text-rose-300 hover:text-white shrink-0"
                            >
                                ✕
                            </button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                        {/* Left Column: Form & Work Selection */}
                        <div className="lg:col-span-7 space-y-6">
                            {/* Step 1: Work Selection */}
                            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6 shadow-sm">
                                <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-3">
                                    1. Select Scholarly Manuscript
                                </label>
                                <div className="space-y-3">
                                    {works.map((work) => {
                                        const isSelected = work.id === activeWork.id;
                                        return (
                                            <div
                                                key={work.id}
                                                onClick={() => setSelectedWorkId(work.id)}
                                                className={`cursor-pointer rounded-lg p-4 border transition ${
                                                    isSelected
                                                        ? 'border-emerald-500 bg-neutral-850/80 ring-1 ring-emerald-500/50'
                                                        : 'border-neutral-800 bg-neutral-950/50 hover:border-neutral-700'
                                                }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <h3 className="font-semibold text-white text-sm leading-snug">
                                                        {work.title}
                                                    </h3>
                                                    {isSelected && (
                                                        <span className="text-[10px] font-mono uppercase bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                                                            Selected
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-xs text-neutral-400 mt-1">
                                                    Scholar:{' '}
                                                    <Link
                                                        href={`/scholar/${work.scholar_address}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-neutral-300 hover:text-emerald-400 hover:underline"
                                                    >
                                                        {work.scholar_name}
                                                    </Link>
                                                </p>
                                                <p className="text-[11px] font-mono text-neutral-500 truncate mt-0.5">
                                                    Base Address:{' '}
                                                    <Link
                                                        href={`/scholar/${work.scholar_address}`}
                                                        onClick={(e) => e.stopPropagation()}
                                                        className="text-neutral-500 hover:text-emerald-400"
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
                            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6 shadow-sm">
                                <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400 mb-3">
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
                                                onClick={() => setSelectedTier(tierKey)}
                                                className={`rounded-lg p-3 text-center border transition ${
                                                    isSelected
                                                        ? 'border-emerald-500 bg-emerald-950/30 text-white'
                                                        : 'border-neutral-800 bg-neutral-950/40 text-neutral-400 hover:border-neutral-700'
                                                }`}
                                            >
                                                <div className="text-xs uppercase font-mono tracking-wider font-semibold">
                                                    {tierKey}
                                                </div>
                                                <div className="text-lg font-bold text-white mt-1">
                                                    ${price.toFixed(2)}
                                                </div>
                                                <div className="text-[10px] text-neutral-500 mt-0.5">
                                                    USDC on Base
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Step 3: Wallet & One-Tap Buy */}
                            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5 sm:p-6 shadow-sm">
                                <div className="flex items-center justify-between mb-3">
                                    <label className="block text-xs font-mono uppercase tracking-wider text-neutral-400">
                                        3. Buyer Wallet & Checkout
                                    </label>
                                    {walletAddress ? (
                                        <button
                                            type="button"
                                            onClick={handleSwitchWallet}
                                            disabled={connectingWallet}
                                            className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline"
                                        >
                                            {connectingWallet ? 'Switching...' : 'Switch Account →'}
                                        </button>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={handleConnectWallet}
                                            disabled={connectingWallet}
                                            className="text-xs font-mono text-emerald-400 hover:text-emerald-300 underline"
                                        >
                                            {connectingWallet ? 'Connecting...' : 'Connect Wallet →'}
                                        </button>
                                    )}
                                </div>

                                {error && (
                                    <div
                                        key={`step3-err-${errorCount}`}
                                        className="mb-3 rounded-lg bg-rose-950/80 border border-rose-500/70 p-3 text-xs text-rose-100"
                                    >
                                        {error}
                                    </div>
                                )}

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <label className="block text-xs font-mono text-neutral-400">
                                            Buyer EVM Address (Licensee)
                                        </label>
                                        {walletAddress && (
                                            <span className="text-[10px] font-mono text-emerald-400">
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
                                        className={`w-full bg-neutral-950 border rounded-lg px-3 py-2 text-xs font-mono transition ${
                                            walletAddress
                                                ? 'border-emerald-500/40 text-emerald-300 cursor-not-allowed'
                                                : 'border-neutral-800 text-neutral-200 focus:outline-none focus:border-emerald-500'
                                        }`}
                                        placeholder="Connect wallet to auto-fill (0x...)"
                                        required
                                    />
                                    <p className="text-[11px] text-neutral-500 mt-1">
                                        The address recorded as the verified buyer on Base LicenseRegistry.
                                    </p>
                                </div>

                                <button
                                    type="button"
                                    data-testid="buy-license-btn"
                                    onClick={handleBuy}
                                    disabled={loading}
                                    className="mt-5 w-full py-3 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-semibold text-sm transition flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {loading ? (
                                        <span>Preparing 1Click Quote...</span>
                                    ) : (
                                        <span>Buy (${currentPrice.toFixed(2)} USD)</span>
                                    )}
                                </button>
                            </div>
                        </div>

                        {/* Right Column: Quote & MPC Settlement Card */}
                        <div className="lg:col-span-5">
                            <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 sticky top-6 shadow-xl">
                                <h2 className="text-sm font-mono uppercase tracking-wider text-neutral-400 border-b border-neutral-800 pb-3">
                                    Settlement Summary
                                </h2>

                                {!currentLicense ? (
                                    <div className="py-12 text-center text-neutral-500 text-xs font-mono">
                                        Connect wallet, select a manuscript, and click &ldquo;Buy&rdquo; to prepare your one-tap payment.
                                    </div>
                                ) : (
                                    <div className="mt-4 space-y-5">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <span className="text-[11px] uppercase font-mono text-neutral-500">Status</span>
                                                <div className="flex items-center gap-2 mt-1">
                                                    <span
                                                        className={`h-2.5 w-2.5 rounded-full ${
                                                            currentLicense.status === 'settled'
                                                                ? 'bg-emerald-400'
                                                                : 'bg-amber-400 animate-pulse'
                                                        }`}
                                                    />
                                                    <span
                                                        data-testid="license-status"
                                                        className="text-sm font-bold uppercase font-mono text-white"
                                                    >
                                                        {currentLicense.status}
                                                    </span>
                                                </div>
                                            </div>
                                            {quotedAmountFormatted && (
                                                <div className="text-right">
                                                    <span className="text-[11px] uppercase font-mono text-neutral-500">
                                                        Exact Quote Amount
                                                    </span>
                                                    <div
                                                        data-testid="quoted-amount-display"
                                                        className="text-sm font-bold font-mono text-emerald-400 mt-1"
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
                                                    className="w-full py-3.5 px-4 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-neutral-950 font-bold text-sm transition flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 disabled:opacity-50"
                                                >
                                                    {paying ? (
                                                        <span>Confirm in Wallet...</span>
                                                    ) : (
                                                        <span>
                                                            Pay {quotedAmountFormatted ? `${quotedAmountFormatted} USDC` : 'Now'}
                                                        </span>
                                                    )}
                                                </button>

                                                {paymentTxHash && (
                                                    <div className="rounded-lg bg-emerald-950/40 border border-emerald-500/40 p-2.5 text-xs font-mono text-emerald-300">
                                                        <div>✓ Payment submitted on Base</div>
                                                        <div className="text-[11px] text-neutral-400 truncate mt-0.5">
                                                            Tx: {paymentTxHash}
                                                        </div>
                                                        <div className="text-[11px] text-emerald-400/90 mt-1">
                                                            Waiting for 1Click verification & NEAR MPC settlement...
                                                        </div>
                                                    </div>
                                                )}

                                                {preparedTransfer && !paymentTxHash && (
                                                    <div
                                                        data-testid="prepared-transfer-details"
                                                        className="rounded-lg bg-neutral-950 border border-neutral-800 p-2.5 text-[11px] font-mono text-neutral-400 space-y-1"
                                                    >
                                                        <div className="text-emerald-400 font-semibold">
                                                            Wallet Transfer Request (Base 8453)
                                                        </div>
                                                        <div className="truncate">
                                                            Token: {BASE_USDC_ADDRESS}
                                                        </div>
                                                        <div className="truncate">
                                                            To: {preparedTransfer.to}
                                                        </div>
                                                        <div>
                                                            Amount: {preparedTransfer.amountFormatted} USDC ({preparedTransfer.amountIn} units)
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Small manual fallback line */}
                                                <div className="pt-1 text-[11px] font-mono text-neutral-500 flex items-center justify-between gap-2">
                                                    <span className="truncate">
                                                        or send manually to{' '}
                                                        <span
                                                            data-testid="fallback-deposit-address"
                                                            className="text-neutral-400 select-all"
                                                        >
                                                            {currentLicense.deposit_address}
                                                        </span>
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={copyDepositAddress}
                                                        className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition"
                                                        title="Copy deposit address"
                                                    >
                                                        {copied ? 'Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-2 text-xs font-mono border-t border-neutral-800 pt-4">
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Work:</span>
                                                <span className="text-neutral-200 truncate max-w-[180px]">
                                                    {activeWork.title}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Scholar Address:</span>
                                                <Link
                                                    href={`/scholar/${activeWork.scholar_address}`}
                                                    className="text-emerald-400 hover:underline"
                                                    title={`View ${activeWork.scholar_name}'s licenses`}
                                                >
                                                    {activeWork.scholar_address.slice(0, 8)}...{activeWork.scholar_address.slice(-6)}
                                                </Link>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Tier:</span>
                                                <span className="text-emerald-400 uppercase font-semibold">
                                                    {currentLicense.tier}
                                                </span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Settlement Chain:</span>
                                                <span className="text-neutral-200">Base Mainnet (8453)</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span className="text-neutral-500">Signing Authority:</span>
                                                <span className="text-neutral-200">NEAR MPC (path ethereum-1)</span>
                                            </div>
                                        </div>

                                        {currentLicense.settlement_tx_hash && (
                                            <div className="rounded-lg bg-neutral-950 border border-emerald-500/40 p-3 text-xs font-mono">
                                                <div className="text-emerald-400 font-semibold mb-1">
                                                    ✓ BaseScan Settlement Receipt
                                                </div>
                                                <a
                                                    href={`https://basescan.org/tx/${currentLicense.settlement_tx_hash}`}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="text-neutral-400 hover:text-emerald-300 underline break-all"
                                                >
                                                    {currentLicense.settlement_tx_hash}
                                                </a>
                                                <div className="mt-2 text-[11px] text-neutral-400">
                                                    Attestation: Scholar recognized on-chain in STANZA credit event.
                                                </div>
                                                <div className="mt-3 pt-2.5 border-t border-neutral-800">
                                                    <Link
                                                        href={`/scholar/${activeWork.scholar_address}`}
                                                        className="text-emerald-400 hover:underline text-[11px] inline-flex items-center gap-1"
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
                </div>

                {/* Footer */}
                <footer className="mt-12 text-center text-xs font-mono text-neutral-600 border-t border-neutral-900 pt-6">
                    Stanza Cross-Chain Licensing · Built with NEAR Intents 1Click & Chain Signatures MPC · Base Mainnet (8453)
                </footer>
            </div>
        </>
    );
}
