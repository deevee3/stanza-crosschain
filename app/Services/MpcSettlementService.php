<?php

namespace App\Services;

use Exception;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class MpcSettlementService
{
    protected string $baseRpcUrl;
    protected string $nearRpcUrl;
    protected string $mpcContract;
    protected ?string $licenseRegistryAddress;
    protected string $derivationPath;

    public function __construct(
        ?string $baseRpcUrl = null,
        ?string $nearRpcUrl = null,
        ?string $mpcContract = null,
        ?string $licenseRegistryAddress = null,
        string $derivationPath = 'ethereum-1'
    ) {
        $this->baseRpcUrl = $baseRpcUrl ?? config('services.base.rpc_url', env('BASE_RPC_URL', 'https://mainnet.base.org'));
        $this->nearRpcUrl = $nearRpcUrl ?? config('services.near.rpc_url', env('NEAR_NODE_URL', 'https://rpc.mainnet.near.org'));
        $this->mpcContract = $mpcContract ?? config('services.near.mpc_contract', env('NEAR_MPC_CONTRACT', 'v1.signer'));
        $this->licenseRegistryAddress = $licenseRegistryAddress ?? config('services.base.license_registry_address', env('LICENSE_REGISTRY_ADDRESS'));
        $this->derivationPath = $derivationPath;
    }

    /**
     * Check if a proofHash is already settled on-chain on LicenseRegistry.
     * Function selector for settled(bytes32): keccak256("settled(bytes32)")[0..4] = 0x27670732
     */
    public function isSettledOnChain(string $proofHash): bool
    {
        if (empty($this->licenseRegistryAddress) || $this->licenseRegistryAddress === 'stub') {
            return false;
        }

        // settled(bytes32) selector is keccak256("settled(bytes32)")[:4] -> 0x27670732
        $selector = '0x27670732';
        $cleanHash = ltrim(str_replace('0x', '', $proofHash), '');
        $data = $selector . str_pad($cleanHash, 64, '0', STR_PAD_LEFT);

        try {
            $response = Http::post($this->baseRpcUrl, [
                'jsonrpc' => '2.0',
                'id' => 1,
                'method' => 'eth_call',
                'params' => [
                    [
                        'to' => $this->licenseRegistryAddress,
                        'data' => $data,
                    ],
                    'latest',
                ],
            ]);

            if ($response->successful()) {
                $result = $response->json('result');
                if ($result) {
                    // Non-zero hex return means true
                    $intVal = hexdec(str_replace('0x', '', $result));
                    return $intVal === 1;
                }
            }
        } catch (Exception $e) {
            Log::warning('Error checking on-chain settled status', ['error' => $e->getMessage()]);
        }

        return false;
    }

    /**
     * Encode recordLicense call data:
     * recordLicense(address buyer, bytes32 workId, string tier, bytes32 proofHash)
     * Selector: keccak256("recordLicense(address,bytes32,string,bytes32)") = 0x5c2b9e85
     */
    public function encodeRecordLicenseCall(string $buyer, string $workId, string $tier, string $proofHash): string
    {
        $selector = '0x5c2b9e85';

        $cleanBuyer = str_pad(ltrim(strtolower(str_replace('0x', '', $buyer)), ''), 64, '0', STR_PAD_LEFT);
        $cleanWorkId = str_pad(str_replace('0x', '', $workId), 64, '0', STR_PAD_RIGHT);
        $cleanProof = str_pad(str_replace('0x', '', $proofHash), 64, '0', STR_PAD_RIGHT);

        // String offset is 4 * 32 = 128 bytes (0x80)
        $offsetTier = str_pad(dechex(128), 64, '0', STR_PAD_LEFT);

        $tierBytes = $tier;
        $tierLen = str_pad(dechex(strlen($tierBytes)), 64, '0', STR_PAD_LEFT);
        $tierHex = str_pad(bin2hex($tierBytes), 64, '0', STR_PAD_RIGHT);

        return $selector . $cleanBuyer . $cleanWorkId . $offsetTier . $cleanProof . $tierLen . $tierHex;
    }

    /**
     * Request signature from NEAR MPC and relay signed transaction to Base.
     * In test/stub mode or without live keys, returns a deterministic simulated settlement.
     */
    public function settleOnBase(
        string $buyer,
        string $workId,
        string $tier,
        string $proofHash,
        bool $isStub = false
    ): array {
        if ($isStub || empty($this->licenseRegistryAddress) || $this->licenseRegistryAddress === 'stub') {
            $txHash = '0x' . hash('sha256', "base_settle_{$workId}_{$buyer}_{$proofHash}");
            return [
                'status' => 'settled',
                'txHash' => $txHash,
                'blockNumber' => 12345678,
                'relayedViaMpc' => true,
                'isStub' => true,
            ];
        }

        $nearAccountId = config('services.near.account_id', env('NEAR_ACCOUNT_ID', 'stanza_glenride.near'));
        $nearPrivateKey = config('services.near.private_key', env('NEAR_PRIVATE_KEY'));

        if (empty($nearAccountId) || empty($nearPrivateKey)) {
            throw new Exception('Live MPC settlement requires NEAR credentials and deployed registry address.');
        }

        $scriptPath = base_path('scripts/mpc-settle.cjs');
        // The PHP container has no node on PATH; environments pin the host
        // node binary (mounted into the container under /home/housedv) via
        // NODE_BINARY. Fall back to `which node` when unset.
        $nodeBinary = (string) (config('services.node.binary', env('NODE_BINARY')) ?: trim((string) shell_exec('which node')));
        if ($nodeBinary === '') {
            $nodeBinary = 'node';
        }

        $command = [
            $nodeBinary,
            $scriptPath,
            $buyer,
            $workId,
            $tier,
            $proofHash,
            $this->licenseRegistryAddress,
            $this->baseRpcUrl,
            $this->nearRpcUrl,
            $nearAccountId,
            $this->mpcContract,
            $this->derivationPath,
        ];

        $process = new \Symfony\Component\Process\Process($command, base_path(), [
            'NEAR_PRIVATE_KEY' => $nearPrivateKey,
            'PATH' => getenv('PATH'),
            'HOME' => getenv('HOME'),
        ]);

        $process->setTimeout(120);
        $process->run();

        if (!$process->isSuccessful()) {
            $error = trim($process->getErrorOutput() ?: $process->getOutput());
            Log::error('Live MPC settlement execution failed', ['error' => $error]);
            throw new Exception("Live MPC settlement failed: {$error}");
        }

        $output = self::parseSettlementOutput($process->getOutput());
        if (!$output || empty($output['txHash'])) {
            throw new Exception("Live MPC settlement returned invalid output: " . $process->getOutput());
        }

        return $output;
    }

    /**
     * Parse the settle script's stdout. near-api-js prints transaction
     * receipts and signer logs to stdout before the script's JSON result,
     * so the JSON object is extracted from the END of the output instead
     * of decoding the whole stream. Returns null when no valid JSON
     * object is present.
     */
    public static function parseSettlementOutput(string $rawOutput): ?array
    {
        $jsonPos = strrpos($rawOutput, '{"status"');
        $candidate = $jsonPos !== false ? substr($rawOutput, $jsonPos) : trim($rawOutput);
        $decoded = json_decode(trim($candidate), true);

        return is_array($decoded) ? $decoded : null;
    }
}
