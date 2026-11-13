import {
    encodeFunctionData,
    formatUnits,
    getAddress,
    numberToHex,
    parseAbi,
    stringToHex,
    type Address,
    type Hex,
} from 'viem';
import { base } from 'viem/chains';

export const BASE_CHAIN_ID = base.id; // 8453
export const BASE_CHAIN_HEX = numberToHex(BASE_CHAIN_ID); // '0x2105'
export const BASE_USDC_ADDRESS: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const BASE_USDC_DECIMALS = 6;

export const ERC20_TRANSFER_ABI = parseAbi([
    'function transfer(address to, uint256 amount) returns (bool)',
]);

export interface Eip1193Provider {
    isMetaMask?: boolean;
    isCoinbaseWallet?: boolean;
    providers?: Eip1193Provider[];
    request: (args: { method: string; params?: unknown[] }) => Promise<any>;
    on?: (event: string, listener: (...args: any[]) => void) => void;
    removeListener?: (event: string, listener: (...args: any[]) => void) => void;
}

export interface PreparedUsdcTransfer {
    chainId: number;
    from: Address;
    token: Address;
    to: Address;
    amountIn: string;
    amountFormatted: string;
    data: Hex;
}

// Discover EIP-6963 announced providers (MetaMask, Coinbase Wallet, etc.)
const eip6963Providers: Eip1193Provider[] = [];

if (typeof window !== 'undefined') {
    window.addEventListener('eip6963:announceProvider', (event: any) => {
        const provider = event?.detail?.provider as Eip1193Provider | undefined;
        if (provider && typeof provider.request === 'function' && !eip6963Providers.includes(provider)) {
            eip6963Providers.push(provider);
        }
    });
    try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch {
        // ignore
    }
}

export function getEthereumProvider(): Eip1193Provider | null {
    if (typeof window === 'undefined') {
        return null;
    }

    // Re-request EIP-6963 providers in case extension initialized late
    try {
        window.dispatchEvent(new Event('eip6963:requestProvider'));
    } catch {
        // ignore
    }

    const eth = (window as unknown as { ethereum?: Eip1193Provider }).ethereum;

    // If multiple injected providers exist in window.ethereum.providers, prefer MetaMask or Coinbase Wallet
    if (eth?.providers && Array.isArray(eth.providers) && eth.providers.length > 0) {
        const preferred =
            eth.providers.find((p) => p?.isMetaMask && typeof p.request === 'function') ||
            eth.providers.find((p) => p?.isCoinbaseWallet && typeof p.request === 'function') ||
            eth.providers.find((p) => typeof p?.request === 'function');
        if (preferred) {
            return preferred;
        }
    }

    if (eth && typeof eth.request === 'function') {
        return eth;
    }

    if (eip6963Providers.length > 0) {
        return (
            eip6963Providers.find((p) => p.isMetaMask) ||
            eip6963Providers.find((p) => p.isCoinbaseWallet) ||
            eip6963Providers[0]
        );
    }

    return null;
}

export async function getWalletChainId(provider: Eip1193Provider): Promise<number> {
    try {
        const chainHex = await provider.request({ method: 'eth_chainId' });
        return typeof chainHex === 'string' ? parseInt(chainHex, 16) : Number(chainHex);
    } catch {
        return BASE_CHAIN_ID;
    }
}

export async function ensureBaseChain(provider: Eip1193Provider): Promise<number> {
    const currentChainId = await getWalletChainId(provider);
    if (currentChainId === BASE_CHAIN_ID) {
        return BASE_CHAIN_ID;
    }

    try {
        await provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: BASE_CHAIN_HEX }],
        });
    } catch (err: any) {
        const errorCode = err?.code ?? err?.data?.originalError?.code;
        if (errorCode === 4902 || errorCode === -32603) {
            await provider.request({
                method: 'wallet_addEthereumChain',
                params: [
                    {
                        chainId: BASE_CHAIN_HEX,
                        chainName: base.name,
                        nativeCurrency: base.nativeCurrency,
                        rpcUrls: [...base.rpcUrls.default.http],
                        blockExplorerUrls: [base.blockExplorers.default.url],
                    },
                ],
            });
            await provider.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: BASE_CHAIN_HEX }],
            });
        } else {
            throw new Error(
                err?.shortMessage ||
                    err?.message ||
                    'Please switch your wallet network to Base Mainnet (Chain ID 8453).',
            );
        }
    }

    return BASE_CHAIN_ID;
}

export async function getConnectedWalletSilent(): Promise<{
    address: Address;
    chainId: number;
} | null> {
    const provider = getEthereumProvider();
    if (!provider) {
        return null;
    }

    try {
        const accounts = (await provider.request({
            method: 'eth_accounts',
        })) as string[];
        if (!accounts || accounts.length === 0) {
            return null;
        }
        const chainId = await getWalletChainId(provider);
        return {
            address: getAddress(accounts[0]),
            chainId,
        };
    } catch {
        return null;
    }
}

export async function connectInjectedWallet(): Promise<{
    address: Address;
    chainId: number;
}> {
    const provider = getEthereumProvider();
    if (!provider) {
        throw new Error(
            'No EVM wallet extension detected in this browser window (window.ethereum is missing). Please open this page in a browser window with MetaMask or Coinbase Wallet enabled.',
        );
    }

    let accounts: string[] = [];

    // 1. Check if account is already authorized so we never hang unnecessarily
    try {
        const existing = (await provider.request({ method: 'eth_accounts' })) as string[];
        if (Array.isArray(existing) && existing.length > 0) {
            accounts = existing;
        }
    } catch {
        // continue to eth_requestAccounts
    }

    // 2. Otherwise prompt the wallet extension via eth_requestAccounts
    if (accounts.length === 0) {
        try {
            accounts = (await provider.request({
                method: 'eth_requestAccounts',
            })) as string[];
        } catch (err: any) {
            if (err?.code === -32002) {
                throw new Error(
                    'A wallet connection request is already open in your browser toolbar. Click the MetaMask or Coinbase Wallet extension icon to approve it.',
                );
            }
            if (err?.code === 4001) {
                throw new Error('Wallet connection was rejected in the wallet prompt.');
            }
            throw new Error(err?.shortMessage || err?.message || 'Failed to connect wallet.');
        }
    }

    if (!accounts || accounts.length === 0) {
        throw new Error('No wallet account returned by provider. Unlock MetaMask or Coinbase Wallet and try again.');
    }

    const address = getAddress(accounts[0]);

    // 3. Read current chain and attempt non-blocking switch to Base (never abort connection if chain switch is deferred to Pay)
    let chainId = await getWalletChainId(provider);
    if (chainId !== BASE_CHAIN_ID) {
        try {
            chainId = await ensureBaseChain(provider);
        } catch {
            // Keep connected address; chain switch will be enforced again when clicking Pay
        }
    }

    return {
        address,
        chainId,
    };
}

export async function switchInjectedWalletAccount(): Promise<{
    address: Address;
    chainId: number;
}> {
    const provider = getEthereumProvider();
    if (!provider) {
        throw new Error(
            'No EVM wallet extension detected in this browser window.',
        );
    }

    try {
        await provider.request({
            method: 'wallet_requestPermissions',
            params: [{ eth_accounts: {} }],
        });
    } catch (err: any) {
        if (err?.code === 4001) {
            throw new Error('Account switch was cancelled in the wallet prompt.');
        }
    }

    const accounts = (await provider.request({
        method: 'eth_requestAccounts',
    })) as string[];

    if (!accounts || accounts.length === 0) {
        throw new Error('No wallet account selected.');
    }

    const chainId = await getWalletChainId(provider);
    return {
        address: getAddress(accounts[0]),
        chainId,
    };
}


export function prepareUsdcTransferCall(params: {
    from: string;
    depositAddress: string;
    amountInRaw: string;
}): PreparedUsdcTransfer {
    const fromAddr = getAddress(params.from);
    const toAddr = getAddress(params.depositAddress);
    const rawStr = String(params.amountInRaw || '').trim();

    if (!/^\d+$/.test(rawStr)) {
        throw new Error(`Invalid quote amountIn value: "${rawStr}"`);
    }

    const amountUnits = BigInt(rawStr);
    if (amountUnits <= 0n) {
        throw new Error('Quote amountIn must be greater than zero.');
    }

    const data = encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: 'transfer',
        args: [toAddr, amountUnits],
    });

    return {
        chainId: BASE_CHAIN_ID,
        from: fromAddr,
        token: BASE_USDC_ADDRESS,
        to: toAddr,
        amountIn: rawStr,
        amountFormatted: formatUnits(amountUnits, BASE_USDC_DECIMALS),
        data,
    };
}

export async function sendUsdcTransferOnBase(params: {
    account: string;
    depositAddress: string;
    amountInRaw: string;
    onPrepared?: (prepared: PreparedUsdcTransfer) => void;
}): Promise<{ txHash: Hex; prepared: PreparedUsdcTransfer }> {
    const provider = getEthereumProvider();
    if (!provider) {
        throw new Error(
            'No injected EVM wallet detected. Please connect MetaMask or Coinbase Wallet.',
        );
    }

    await ensureBaseChain(provider);

    const prepared = prepareUsdcTransferCall({
        from: params.account,
        depositAddress: params.depositAddress,
        amountInRaw: params.amountInRaw,
    });

    console.info('[Stanza Seamless Checkout] Prepared Base USDC ERC-20 transfer:', prepared);
    params.onPrepared?.(prepared);

    const txHash = (await provider.request({
        method: 'eth_sendTransaction',
        params: [
            {
                from: prepared.from,
                to: BASE_USDC_ADDRESS,
                data: prepared.data,
                value: '0x0',
            },
        ],
    })) as Hex;

    return { txHash, prepared };
}

export async function signPersonalMessage(params: {
    account: string;
    message: string;
}): Promise<Hex> {
    const provider = getEthereumProvider();
    if (!provider) {
        throw new Error(
            'No injected EVM wallet detected. Please connect MetaMask or Coinbase Wallet.',
        );
    }

    const signerAddress = getAddress(params.account);
    const hexMessage = stringToHex(params.message);

    try {
        const signature = (await provider.request({
            method: 'personal_sign',
            params: [hexMessage, signerAddress],
        })) as Hex;

        if (!signature || typeof signature !== 'string') {
            throw new Error('Wallet did not return a valid EIP-191 signature.');
        }

        return signature;
    } catch (err: any) {
        if (err?.code === 4001) {
            throw new Error('Signature request was rejected in the wallet prompt.');
        }
        throw new Error(
            err?.shortMessage ||
                err?.message ||
                'Failed to sign upload authorization challenge in wallet.',
        );
    }
}

