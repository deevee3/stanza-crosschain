#!/usr/bin/env node

/**
 * NEAR Chain Signatures MPC Work Registration Script for Base
 *
 * Registers a work on LicenseRegistry.sol so recordLicense stops reverting
 * UnknownWork. Same signing + relay machinery as mpc-settle.cjs, with a
 * registerWork(workId, scholar, metadataUri) call instead:
 *
 * 1. Encodes registerWork(workId, scholar, metadataUri) call for LicenseRegistry.sol on Base
 * 2. Queries Base RPC for relayer nonce, baseFee, and gas parameters
 * 3. Builds unsigned EIP-1559 transaction and computes keccak256 signing hash
 * 4. Calls NEAR Chain Signatures MPC contract `sign` (v1.signer on mainnet)
 * 5. Assembles signed EIP-1559 raw transaction using returned (r, s, recovery_id)
 * 6. Relays raw transaction to Base mainnet RPC
 * 7. Waits for receipt, verifies status 0x1 and the WorkRegistered event, and outputs registration JSON
 *
 * registerWork is permissionless on the registry (no access control), so the
 * relayer may register any work. This script exists because the relayer key
 * is MPC-derived: only a NEAR Chain Signatures signature can authorize a
 * transaction from the relayer address.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Dynamically locate near-cli's node_modules if near-api-js is not in workspace
function loadNearApi() {
  try {
    return require('near-api-js');
  } catch {
    const candidatePaths = [
      '/home/housedv/.local/share/mise/installs/node/26.12.1/lib/node_modules/near-cli/node_modules',
      '/home/housedv/.local/share/mise/installs/node/26/lib/node_modules/near-cli/node_modules',
    ];
    try {
      const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
      candidatePaths.push(path.join(globalRoot, 'near-cli', 'node_modules'));
    } catch { /* ignore */ }

    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        module.paths.unshift(p);
        try {
          return require('near-api-js');
        } catch { /* ignore */ }
      }
    }
    throw new Error('near-api-js could not be loaded from workspace or near-cli global modules');
  }
}

// Pure JS Keccak-256 implementation
function keccak256(data) {
  const RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  const R = [
    [0, 36, 3, 41, 18],
    [1, 44, 10, 45, 2],
    [62, 6, 43, 15, 61],
    [28, 55, 25, 21, 56],
    [27, 20, 39, 8, 14]
  ];
  const rotl64 = (x, n) => {
    const shift = BigInt(n % 64);
    return ((x << shift) & 0xffffffffffffffffn) | (x >> (64n - shift));
  };
  const rate = 136;
  const padlen = rate - (data.length % rate);
  const padded = Buffer.concat([
    data,
    padlen === 1 ? Buffer.from([0x81]) : Buffer.concat([Buffer.from([0x01]), Buffer.alloc(padlen - 2), Buffer.from([0x80])])
  ]);
  const state = Array.from({ length: 5 }, () => Array(5).fill(0n));
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let i = 0; i < 17; i++) {
      state[i % 5][Math.floor(i / 5)] ^= padded.readBigUInt64LE(offset + i * 8);
    }
    for (let round = 0; round < 24; round++) {
      const C = Array.from({ length: 5 }, (_, x) => state[x][0] ^ state[x][1] ^ state[x][2] ^ state[x][3] ^ state[x][4]);
      const D = Array.from({ length: 5 }, (_, x) => C[(x + 4) % 5] ^ rotl64(C[(x + 1) % 5], 1));
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          state[x][y] ^= D[x];
        }
      }
      const B = Array.from({ length: 5 }, () => Array(5).fill(0n));
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          B[y][(2 * x + 3 * y) % 5] = rotl64(state[x][y], R[x][y]);
        }
      }
      for (let x = 0; x < 5; x++) {
        for (let y = 0; y < 5; y++) {
          state[x][y] = B[x][y] ^ ((~B[(x + 1) % 5][y]) & B[(x + 2) % 5][y]);
        }
      }
      state[0][0] ^= RC[round];
    }
  }
  const out = Buffer.alloc(32);
  let outOffset = 0;
  for (let y = 0; y < 5 && outOffset < 32; y++) {
    for (let x = 0; x < 5 && outOffset < 32; x++) {
      out.writeBigUInt64LE(state[x][y], outOffset);
      outOffset += 8;
    }
  }
  return out;
}

// RLP encoding functions
function encodeLength(len, offset) {
  if (len < 56) return Buffer.from([len + offset]);
  let hexLen = len.toString(16);
  if (hexLen.length % 2 !== 0) hexLen = '0' + hexLen;
  const bufLen = Buffer.from(hexLen, 'hex');
  return Buffer.concat([Buffer.from([offset + 55 + bufLen.length]), bufLen]);
}

function rlpEncode(input) {
  if (Buffer.isBuffer(input)) {
    if (input.length === 1 && input[0] < 128) return input;
    return Buffer.concat([encodeLength(input.length, 128), input]);
  }
  if (typeof input === 'string') {
    if (input.startsWith('0x')) {
      const clean = input.slice(2);
      if (clean.length === 0) return Buffer.from([0x80]);
      const padded = clean.length % 2 !== 0 ? '0' + clean : clean;
      return rlpEncode(Buffer.from(padded, 'hex'));
    }
    return rlpEncode(Buffer.from(input, 'utf8'));
  }
  if (typeof input === 'number' || typeof input === 'bigint') {
    if (input === 0 || input === 0n) return Buffer.from([0x80]);
    let hex = input.toString(16);
    if (hex.length % 2 !== 0) hex = '0' + hex;
    return rlpEncode(Buffer.from(hex, 'hex'));
  }
  if (Array.isArray(input)) {
    const encodedList = Buffer.concat(input.map(rlpEncode));
    return Buffer.concat([encodeLength(encodedList.length, 192), encodedList]);
  }
  throw new Error('Unsupported RLP input: ' + input);
}

// ABI encoder for registerWork(bytes32 workId, address scholar, string metadataUri)
// Selector: 0xfe6038e1 (keccak256("registerWork(bytes32,address,string)")[:4], verified via cast)
function encodeRegisterWorkCall(workId, scholar, metadataUri) {
  const selector = 'fe6038e1';
  const cleanWorkId = workId.toLowerCase().replace('0x', '').padEnd(64, '0');
  const cleanScholar = scholar.toLowerCase().replace('0x', '').padStart(64, '0');

  // String offset is 3 * 32 = 96 bytes (0x60)
  const offsetUri = (96).toString(16).padStart(64, '0');

  const uriBuf = Buffer.from(metadataUri, 'utf8');
  const uriLen = uriBuf.length.toString(16).padStart(64, '0');
  const paddedUriLen = Math.ceil(uriBuf.length / 32) * 32;
  const uriPadded = Buffer.concat([uriBuf, Buffer.alloc(paddedUriLen - uriBuf.length)]).toString('hex');

  return '0x' + selector + cleanWorkId + cleanScholar + offsetUri + uriLen + uriPadded;
}

// JSON-RPC helper for Base
async function rpcCall(url, method, params = []) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })
  });
  if (!res.ok) {
    throw new Error(`RPC HTTP error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  if (json.error) {
    throw new Error(`RPC error (${method}): ${JSON.stringify(json.error)}`);
  }
  return json.result;
}

// MPC deposit: v1.signer v3.17.0 removed the signature-deposit view
// (experimental_signature_deposit / experimantal_signature_deposit both
// return MethodNotFound live, verified 2026-11-09). The contract uses
// SIGN_DEPOSIT_YOCTONEAR = 1. sign() requires 1 yoctoNEAR attached.
// NOTE: a FunctionCall key CANNOT attach any deposit (NEAR protocol
// DepositWithFunctionCall) — the configured key must be FullAccess.

// Verify WorkRegistered(bytes32 indexed workId, address indexed scholar, string metadataUri)
function verifyWorkRegisteredEvent(receipt, registryAddress, workId, scholar, metadataUri) {
  const eventSig = 'WorkRegistered(bytes32,address,string)';
  const expectedTopic0 = '0x' + keccak256(Buffer.from(eventSig, 'utf8')).toString('hex').toLowerCase();
  const expectedWorkId = '0x' + workId.toLowerCase().replace(/^0x/, '').padEnd(64, '0');
  const expectedScholar = '0x' + scholar.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  const targetAddress = registryAddress.toLowerCase();

  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  for (const log of logs) {
    if (!log || typeof log.address !== 'string' || log.address.toLowerCase() !== targetAddress) {
      continue;
    }
    const topics = Array.isArray(log.topics) ? log.topics.map(t => String(t).toLowerCase()) : [];
    if (topics.length < 3) {
      continue;
    }
    if (
      topics[0] !== expectedTopic0 ||
      topics[1] !== expectedWorkId ||
      topics[2] !== expectedScholar
    ) {
      continue;
    }

    // Verify non-indexed metadataUri string in log.data if present
    if (typeof log.data === 'string' && log.data.startsWith('0x') && log.data.length >= 2 + 192) {
      const hexData = log.data.slice(2);
      const uriOffsetBytes = parseInt(hexData.slice(0, 64), 16);
      const uriLenHexStart = uriOffsetBytes * 2;
      if (hexData.length >= uriLenHexStart + 64) {
        const uriByteLen = parseInt(hexData.slice(uriLenHexStart, uriLenHexStart + 64), 16);
        const uriStrHex = hexData.slice(uriLenHexStart + 64, uriLenHexStart + 64 + uriByteLen * 2);
        const decodedUri = Buffer.from(uriStrHex, 'hex').toString('utf8');
        if (decodedUri !== metadataUri) {
          continue;
        }
      }
    }

    return true;
  }

  return false;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const filteredArgs = args.filter(a => a !== '--dry-run');

  const workId = filteredArgs[0];
  const scholar = filteredArgs[1];
  const metadataUri = filteredArgs[2];
  const registryAddress = filteredArgs[3] || process.env.LICENSE_REGISTRY_ADDRESS;
  const baseRpcUrl = filteredArgs[4] || process.env.BASE_RPC_URL || 'https://mainnet.base.org';
  const nearNodeUrl = filteredArgs[5] || process.env.NEAR_NODE_URL || 'https://rpc.mainnet.near.org';
  const nearAccountId = filteredArgs[6] || process.env.NEAR_ACCOUNT_ID || 'stanza_glenride.near';
  const nearMpcContract = filteredArgs[7] || process.env.NEAR_MPC_CONTRACT || 'v1.signer';
  const derivationPath = filteredArgs[8] || 'ethereum-1';

  if (!workId || !scholar || !metadataUri || !registryAddress) {
    console.error('Usage: node scripts/mpc-register.cjs <workId> <scholar> <metadataUri> [registryAddress] [baseRpcUrl] [nearNodeUrl] [nearAccountId] [nearMpcContract] [derivationPath] [--dry-run]');
    process.exit(1);
  }

  // Derived relayer address for stanza_glenride.near on path ethereum-1 (v1.signer mainnet)
  const relayerAddress = '0x4D538abf011e0885a6f87667Db466837B10b49f9';
  const chainId = 8453; // Base mainnet

  // 1. Encode contract call
  const callData = encodeRegisterWorkCall(workId, scholar, metadataUri);

  // 2. Query Base RPC for nonce and gas pricing
  const nonceHex = await rpcCall(baseRpcUrl, 'eth_getTransactionCount', [relayerAddress, 'pending']);
  const nonce = BigInt(nonceHex);

  let priorityFee = 1000000n; // default 0.001 Gwei
  try {
    const tipHex = await rpcCall(baseRpcUrl, 'eth_maxPriorityFeePerGas', []);
    if (tipHex) priorityFee = BigInt(tipHex);
  } catch { /* ignore */ }

  const latestBlock = await rpcCall(baseRpcUrl, 'eth_getBlockByNumber', ['latest', false]);
  const baseFee = BigInt(latestBlock.baseFeePerGas || '0x3b9aca00');
  const maxFeePerGas = baseFee * 2n + priorityFee;

  let gasLimit = 150000n;
  try {
    const estHex = await rpcCall(baseRpcUrl, 'eth_estimateGas', [{
      from: relayerAddress,
      to: registryAddress,
      data: callData
    }]);
    if (estHex) {
      gasLimit = BigInt(Math.ceil(Number(BigInt(estHex)) * 1.25));
    }
  } catch {
    // If estimate reverts (e.g. pre-check simulation), use standard gas limit
    gasLimit = 150000n;
  }

  // 3. Build unsigned EIP-1559 transaction fields:
  // [chain_id, nonce, max_priority_fee, max_fee, gas_limit, to, value, data, access_list]
  const txFields = [
    chainId,
    nonce,
    priorityFee,
    maxFeePerGas,
    gasLimit,
    registryAddress,
    0,
    callData,
    []
  ];

  const unsignedRlp = rlpEncode(txFields);
  const signingPayload = Buffer.concat([Buffer.from([0x02]), unsignedRlp]);
  const signingHash = keccak256(signingPayload); // 32-byte Buffer

  if (dryRun) {
    console.log(JSON.stringify({
      dryRun: true,
      relayerAddress,
      registryAddress,
      nonce: Number(nonce),
      priorityFee: priorityFee.toString(),
      maxFeePerGas: maxFeePerGas.toString(),
      gasLimit: gasLimit.toString(),
      signingHash: '0x' + signingHash.toString('hex'),
      callData
    }, null, 2));
    return;
  }

  // 4. Request signature from NEAR Chain Signatures MPC
  let nearPrivateKey = process.env.NEAR_PRIVATE_KEY;
  if (!nearPrivateKey) {
    const credPath = path.join(process.env.HOME || '', '.near-credentials', 'mainnet', `${nearAccountId}.json`);
    if (fs.existsSync(credPath)) {
      const credData = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      nearPrivateKey = credData.private_key || credData.secret_key;
    }
  }

  if (!nearPrivateKey) {
    throw new Error('NEAR_PRIVATE_KEY environment variable is required for live MPC signing');
  }


  const nearAPI = loadNearApi();
  const { keyStores, KeyPair, connect } = nearAPI;
  const keyStore = new keyStores.InMemoryKeyStore();
  const keyPair = KeyPair.fromString(nearPrivateKey);
  await keyStore.setKey('mainnet', nearAccountId, keyPair);

  const near = await connect({
    networkId: 'mainnet',
    nodeUrl: nearNodeUrl,
    keyStore,
  });

  const account = await near.account(nearAccountId);

  // Call sign on v1.signer
  // Gas: 300 TGas (300000000000000)
  // Deposit: 1 yoctoNEAR (SIGN_DEPOSIT_YOCTONEAR, v1.signer v3.17.0)
  const callResult = await account.functionCall({
    contractId: nearMpcContract,
    methodName: 'sign',
    args: {
      request: {
        payload: Array.from(signingHash),
        path: derivationPath,
        key_version: 0,
      }
    },
    gas: '300000000000000',
    attachedDeposit: '1',
  });

  const sigResult = nearAPI.providers.getTransactionLastResult(callResult);
  if (!sigResult) {
    throw new Error('NEAR MPC sign call did not return a signature result');
  }

  const bigR = sigResult.big_r?.affine_point || sigResult.big_r;
  const sScalar = sigResult.s?.scalar || sigResult.s;
  const recoveryId = sigResult.recovery_id ?? sigResult.v ?? 0;

  if (!bigR || !sScalar) {
    throw new Error('Malformed signature response from NEAR MPC: ' + JSON.stringify(sigResult));
  }

  // Extract r from big_r (strip compressed prefix byte 02 or 03 if 66 hex chars)
  let cleanR = bigR.replace(/^0x/, '');
  if (cleanR.length === 66) {
    cleanR = cleanR.slice(2);
  }
  const rBuf = Buffer.from(cleanR.padStart(64, '0'), 'hex');

  let cleanS = sScalar.replace(/^0x/, '');
  const sBuf = Buffer.from(cleanS.padStart(64, '0'), 'hex');

  // 5. Assemble raw signed EIP-1559 transaction:
  // [chain_id, nonce, max_priority_fee, max_fee, gas_limit, to, value, data, access_list, y_parity, r, s]
  const signedTxFields = [
    chainId,
    nonce,
    priorityFee,
    maxFeePerGas,
    gasLimit,
    registryAddress,
    0,
    callData,
    [],
    recoveryId,
    rBuf,
    sBuf
  ];

  const signedRlp = rlpEncode(signedTxFields);
  const rawTx = '0x02' + signedRlp.toString('hex');

  // 6. Relay raw signed transaction to Base RPC
  const txHash = await rpcCall(baseRpcUrl, 'eth_sendRawTransaction', [rawTx]);

  // 7. Poll for transaction receipt (up to 45 seconds)
  let receipt = null;
  const startTime = Date.now();
  while (Date.now() - startTime < 45000) {
    try {
      receipt = await rpcCall(baseRpcUrl, 'eth_getTransactionReceipt', [txHash]);
      if (receipt && receipt.blockNumber) break;
    } catch { /* ignore */ }
    await new Promise(res => setTimeout(res, 1500));
  }

  if (!receipt) {
    throw new Error(`Timed out waiting for Base transaction receipt. Tx: ${txHash}`);
  }

  if (receipt.status !== '0x1') {
    throw new Error(`Base transaction execution reverted (status: ${receipt.status}). Tx: ${txHash}`);
  }

  // 8. Verify WorkRegistered(workId, scholar, metadataUri) event in receipt logs
  const eventVerified = verifyWorkRegisteredEvent(receipt, registryAddress, workId, scholar, metadataUri);
  if (!eventVerified) {
    throw new Error(`WorkRegistered event missing or mismatched in receipt logs for tx: ${txHash}`);
  }

  const blockNumber = parseInt(receipt.blockNumber, 16);

  console.log(JSON.stringify({
    status: 'registered',
    txHash,
    blockNumber,
    relayedViaMpc: true,
    isStub: false
  }));
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
