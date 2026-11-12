<?php

namespace App\Services;

use kornrunner\Keccak;

/**
 * Ethereum personal_sign (EIP-191) signing and public-key recovery, in pure
 * PHP with BCMath — no ext-gmp on the homelab PHP, so the secp256k1 math is
 * implemented here instead of pulling elliptic-php. Used to prove scholar
 * ownership on upload: the scholar signs a server-issued challenge with the
 * wallet that will own the work, and the server recovers the signer.
 *
 * Recovery follows SEC 1 §4.1.6. Test vectors in
 * tests/Unit/EthereumSignatureServiceTest.php are cross-checked against
 * `cast wallet sign` output (same message, same key, same signature).
 */
class EthereumSignatureService
{
    // secp256k1 field prime, group order, and generator (decimal strings;
    // BCMath has no hex arithmetic, so everything here is decimal).
    protected const P_HEX = 'fffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f';
    protected const N_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
    protected const GX_HEX = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
    protected const GY_HEX = '483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8';

    /**
     * Keccak-256 of raw bytes, returned 0x-prefixed. The fingerprint hash
     * for uploaded works and the message hash underneath EIP-191 signing.
     */
    public static function keccak256Hex(string $data): string
    {
        return '0x' . Keccak::hash($data, 256);
    }

    /**
     * EIP-191 personal_sign hash: keccak256("\x19Ethereum Signed Message:\n"
     * . strlen($message) . $message), 0x-prefixed hex.
     */
    public static function hashMessage(string $message): string
    {
        $prefix = "\x19Ethereum Signed Message:\n" . strlen($message);

        return self::keccak256Hex($prefix . $message);
    }

    /**
     * Recover the signer address (lowercase 0x) from a personal_sign
     * signature, or null when the signature is malformed or unrecoverable.
     * Accepts v as 27/28 or 0/1. Verification failure is a null, never an
     * exception — callers treat null as "not proven".
     */
    public static function recoverAddress(string $message, string $signature): ?string
    {
        try {
            $parsed = self::parseSignature($signature);
            if ($parsed === null) {
                return null;
            }
            [$r, $s, $recid] = $parsed;

            $hashHex = substr(self::hashMessage($message), 2);
            $z = self::hexToDec($hashHex);
            $n = self::hexToDec(self::N_HEX);
            if (bccomp($z, $n) >= 0) {
                $z = bcsub($z, $n);
            }

            $point = self::recoverPoint($z, $r, $s, $recid);
            if ($point === null) {
                return null;
            }

            return self::addressFromPoint($point);
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * True when the signature over the message recovers to the expected
     * address (case-insensitive comparison; checksummed input accepted).
     */
    public static function verify(string $message, string $signature, string $expectedAddress): bool
    {
        $recovered = self::recoverAddress($message, $signature);

        return $recovered !== null && strtolower($recovered) === strtolower($expectedAddress);
    }

    /**
     * Sign a message with a raw secp256k1 private key (EIP-191
     * personal_sign, low-s normalized, v 27/28). Used by tests and by any
     * future server-side flow that holds a key; no key is ever stored here.
     */
    public static function sign(string $privateKeyHex, string $message): string
    {
        $priv = self::hexToDec(ltrim(strtolower($privateKeyHex), '0x'));
        $n = self::hexToDec(self::N_HEX);
        if (bccomp($priv, '1') < 0 || bccomp($priv, bcsub($n, '1')) > 0) {
            throw new \InvalidArgumentException('Private key out of range for secp256k1.');
        }

        $hashHex = substr(self::hashMessage($message), 2);
        $z = self::hexToDec($hashHex);
        if (bccomp($z, $n) >= 0) {
            $z = bcsub($z, $n);
        }

        $g = [self::hexToDec(self::GX_HEX), self::hexToDec(self::GY_HEX)];

        do {
            // Random k in [1, n-1]. Randomness (not RFC 6979 determinism)
            // is fine here: every (r, s) the loop produces verifies.
            $k = self::randomScalar($n);
            $rPoint = self::scalarMult($k, $g);
            $r = self::mod($rPoint[0], $n);
            if (bccomp($r, '0') === 0) {
                continue;
            }
            $s = self::mod(bcmul(self::modInv($k, $n), bcadd($z, bcmul($r, $priv))), $n);
            if (bccomp($s, '0') === 0) {
                continue;
            }
            break;
        } while (true);

        $recid = (bcmod($rPoint[1], '2') === '1' ? 1 : 0) + (bccomp($rPoint[0], $n) >= 0 ? 2 : 0);

        // EIP-2 low-s: flip s and the recovery parity when s is high, so
        // signatures are canonical like wallets produce.
        $halfN = bcdiv($n, '2');
        if (bccomp($s, $halfN) > 0) {
            $s = bcsub($n, $s);
            $recid ^= 1;
        }

        return '0x'
            . str_pad(self::decToHex($r), 64, '0', STR_PAD_LEFT)
            . str_pad(self::decToHex($s), 64, '0', STR_PAD_LEFT)
            . str_pad(dechex($recid + 27), 2, '0', STR_PAD_LEFT);
    }

    /**
     * Parse a 65-byte 0x-prefixed signature into [r, s, recid] decimals.
     * Returns null for malformed input or out-of-range r/s/v.
     */
    protected static function parseSignature(string $signature): ?array
    {
        $clean = strtolower($signature);
        if (str_starts_with($clean, '0x')) {
            $clean = substr($clean, 2);
        }
        if (strlen($clean) !== 130 || !ctype_xdigit($clean)) {
            return null;
        }

        $r = self::hexToDec(substr($clean, 0, 64));
        $s = self::hexToDec(substr($clean, 64, 64));
        $v = hexdec(substr($clean, 128, 2));

        $n = self::hexToDec(self::N_HEX);
        if (bccomp($r, '1') < 0 || bccomp($r, $n) >= 0) {
            return null;
        }
        if (bccomp($s, '1') < 0 || bccomp($s, $n) >= 0) {
            return null;
        }

        if ($v === 27 || $v === 28) {
            $recid = $v - 27;
        } elseif ($v === 0 || $v === 1) {
            $recid = $v;
        } else {
            return null;
        }

        return [$r, $s, $recid];
    }

    /**
     * SEC 1 public-key recovery: Q = r^-1 (sR - zG) for the R implied by
     * (r, recid). Returns [x, y] decimals, or null when no valid point.
     */
    protected static function recoverPoint(string $z, string $r, string $s, int $recid): ?array
    {
        $p = self::hexToDec(self::P_HEX);
        $n = self::hexToDec(self::N_HEX);

        // x = r + (recid >> 1) * n; recid is 0/1 here (v 27/28), so x = r.
        $x = bcadd($r, bcmul((string) ($recid >> 1), $n));
        if (bccomp($x, $p) >= 0) {
            return null;
        }

        // Decompress: y^2 = x^3 + 7 (mod p); p % 4 == 3, so the square root
        // is y = (x^3 + 7)^((p+1)/4) mod p. Pick the parity recid names.
        $alpha = self::mod(bcadd(self::modPow($x, '3', $p), '7'), $p);
        $beta = self::modPow($alpha, bcdiv(bcadd($p, '1'), '4'), $p);
        if (bccomp(self::mod(bcmul($beta, $beta), $p), $alpha) !== 0) {
            return null;
        }
        $yOdd = bcmod($beta, '2') === '1';
        $y = ($yOdd === (($recid & 1) === 1)) ? $beta : bcsub($p, $beta);
        $pointR = [$x, $y];

        // Q = r^-1 (sR - zG).
        $rInv = self::modInv($r, $n);
        $sR = self::scalarMult($s, $pointR);
        $zG = self::scalarMult($z, [self::hexToDec(self::GX_HEX), self::hexToDec(self::GY_HEX)]);
        $negZG = [$zG[0], self::mod(bcsub('0', $zG[1]), $p)];
        $point = self::pointAdd($sR, $negZG);
        if ($point === null) {
            return null;
        }

        return self::scalarMult($rInv, $point);
    }

    /** Address from a public point: last 20 bytes of keccak256(x || y). */
    protected static function addressFromPoint(array $point): string
    {
        $pub = hex2bin(
            str_pad(self::decToHex($point[0]), 64, '0', STR_PAD_LEFT)
            . str_pad(self::decToHex($point[1]), 64, '0', STR_PAD_LEFT)
        );
        $hash = Keccak::hash($pub, 256);

        return '0x' . substr($hash, 24);
    }

    protected static function randomScalar(string $n): string
    {
        $nMinus1 = bcsub($n, '1');
        do {
            $k = self::hexToDec(bin2hex(random_bytes(32)));
            $k = bcadd(self::mod($k, $nMinus1), '1');
        } while (bccomp($k, '1') < 0 || bccomp($k, $nMinus1) > 0);

        return $k;
    }

    // -- BCMath helpers (scale 0 throughout; all values decimal strings) --

    protected static function mod(string $a, string $m): string
    {
        $r = bcmod($a, $m);
        if (bccomp($r, '0') < 0) {
            $r = bcadd($r, $m);
        }

        return $r;
    }

    protected static function modPow(string $base, string $exp, string $m): string
    {
        return bcpowmod(self::mod($base, $m), $exp, $m);
    }

    /** Modular inverse via the extended Euclidean algorithm. */
    protected static function modInv(string $a, string $m): string
    {
        $a = self::mod($a, $m);
        [$oldR, $r] = [$a, $m];
        [$oldS, $s] = ['1', '0'];

        while (bccomp($r, '0') !== 0) {
            $q = bcdiv($oldR, $r);
            [$oldR, $r] = [$r, bcsub($oldR, bcmul($q, $r))];
            [$oldS, $s] = [$s, bcsub($oldS, bcmul($q, $s))];
        }

        if (bccomp($oldR, '1') !== 0) {
            throw new \RuntimeException('No modular inverse exists.');
        }

        return self::mod($oldS, $m);
    }

    /** Point addition; null is the point at infinity. */
    protected static function pointAdd(?array $a, ?array $b): ?array
    {
        $p = self::hexToDec(self::P_HEX);
        if ($a === null) {
            return $b;
        }
        if ($b === null) {
            return $a;
        }
        if (bccomp($a[0], $b[0]) === 0) {
            if (bccomp(self::mod(bcadd($a[1], $b[1]), $p), '0') === 0) {
                return null;
            }

            return self::pointDouble($a);
        }

        $slope = self::mod(bcmul(bcsub($b[1], $a[1]), self::modInv(bcsub($b[0], $a[0]), $p)), $p);
        $x = self::mod(bcsub(bcsub(bcmul($slope, $slope), $a[0]), $b[0]), $p);
        $y = self::mod(bcsub(bcmul($slope, bcsub($a[0], $x)), $a[1]), $p);

        return [$x, $y];
    }

    protected static function pointDouble(array $a): ?array
    {
        $p = self::hexToDec(self::P_HEX);
        if (bccomp($a[1], '0') === 0) {
            return null;
        }

        $slope = self::mod(bcmul(bcmul('3', bcmul($a[0], $a[0])), self::modInv(bcmul('2', $a[1]), $p)), $p);
        $x = self::mod(bcsub(bcmul($slope, $slope), bcmul('2', $a[0])), $p);
        $y = self::mod(bcsub(bcmul($slope, bcsub($a[0], $x)), $a[1]), $p);

        return [$x, $y];
    }

    /** Scalar multiplication by double-and-add over the scalar's bits. */
    protected static function scalarMult(string $k, array $point): ?array
    {
        // Binary expansion, most significant bit first.
        $bits = '';
        $remaining = $k;
        while (bccomp($remaining, '0') > 0) {
            $bits = bcmod($remaining, '2') . $bits;
            $remaining = bcdiv($remaining, '2');
        }

        $result = null;
        foreach (str_split($bits) as $bit) {
            // Doubling the point at infinity stays at infinity; the first
            // set bit (the MSB, always 1) lands on the input point via add.
            $result = $result === null ? null : self::pointDouble($result);
            if ($bit === '1') {
                $result = self::pointAdd($result, $point);
            }
        }

        return $result;
    }

    protected static function hexToDec(string $hex): string
    {
        $hex = strtolower(ltrim($hex, '0x'));
        $dec = '0';
        foreach (str_split($hex) as $char) {
            $dec = bcadd(bcmul($dec, '16'), (string) hexdec($char));
        }

        return $dec;
    }

    protected static function decToHex(string $dec): string
    {
        if (bccomp($dec, '0') === 0) {
            return '0';
        }
        $hex = '';
        $remaining = $dec;
        while (bccomp($remaining, '0') > 0) {
            $hex = dechex((int) bcmod($remaining, '16')) . $hex;
            $remaining = bcdiv($remaining, '16');
        }

        return $hex;
    }
}
