<?php
// A QR code, made here: the e-receipt's code (_lib/ereceipt.php) as a PNG,
// for the e-mail and the receipt page. The host has PHP 7.3 and no
// Composer, so no library: this is ISO/IEC 18004 for what the receipt
// needs and nothing more — byte mode, error correction level M, versions 1
// to 10 (up to 213 bytes; the receipt's code is under 100).
//
// The method follows Project Nayuki's reference encoder (MIT): function
// patterns, Reed-Solomon over GF(256), interleaved blocks, the eight masks
// scored by the standard's penalty rules. tests/qr/ereceipt.test.mjs reads
// the codes back with a real scanner (zbarimg).
//
// ⚠ PHP 7.3 on the production host — see core.php.

declare(strict_types=1);

if (!defined('RAYA_QR')) {
    http_response_code(404);
    exit;
}

// Level M, per version: [EC codewords per block, [[blocks, data codewords each], …]].
const QR_CODE_BLOCKS = [
    1 => [10, [[1, 16]]],
    2 => [16, [[1, 28]]],
    3 => [26, [[1, 44]]],
    4 => [18, [[2, 32]]],
    5 => [24, [[2, 43]]],
    6 => [16, [[4, 27]]],
    7 => [18, [[4, 31]]],
    8 => [22, [[2, 38], [2, 39]]],
    9 => [22, [[3, 36], [2, 37]]],
    10 => [26, [[4, 43], [1, 44]]],
];
// Centres of the alignment patterns, per version.
const QR_CODE_ALIGN = [
    1 => [], 2 => [6, 18], 3 => [6, 22], 4 => [6, 26], 5 => [6, 30],
    6 => [6, 34], 7 => [6, 22, 38], 8 => [6, 24, 42], 9 => [6, 26, 46], 10 => [6, 28, 50],
];

/**
 * The modules of a QR code for $text (bytes, as given): rows of booleans,
 * true for dark. Throws when the text is too long for version 10.
 */
function qr_code_matrix(string $text): array
{
    $length = strlen($text);
    $version = 0;
    foreach (QR_CODE_BLOCKS as $v => $spec) {
        $dataBytes = 0;
        foreach ($spec[1] as $group) {
            $dataBytes += $group[0] * $group[1];
        }
        if (4 + ($v < 10 ? 8 : 16) + 8 * $length <= 8 * $dataBytes) {
            $version = $v;
            break;
        }
    }
    if ($version === 0) {
        throw new InvalidArgumentException('QR code: text too long');
    }
    list($ecLength, $groups) = QR_CODE_BLOCKS[$version];
    $capacity = 0;
    foreach ($groups as $group) {
        $capacity += $group[0] * $group[1];
    }

    // The bit stream: mode 0100 (bytes), the length, the bytes, a terminator,
    // then pad bytes up to the capacity.
    $bits = '0100' . str_pad(decbin($length), $version < 10 ? 8 : 16, '0', STR_PAD_LEFT);
    for ($i = 0; $i < $length; $i++) {
        $bits .= str_pad(decbin(ord($text[$i])), 8, '0', STR_PAD_LEFT);
    }
    $bits .= str_repeat('0', min(4, 8 * $capacity - strlen($bits)));
    $bits .= str_repeat('0', (8 - strlen($bits) % 8) % 8);
    $data = [];
    foreach (str_split($bits, 8) as $byte) {
        $data[] = bindec($byte);
    }
    for ($pad = 0xEC; count($data) < $capacity; $pad ^= 0xEC ^ 0x11) {
        $data[] = $pad;
    }

    // Split into blocks, add each block's error correction, interleave.
    $divisor = qr_code_rs_divisor($ecLength);
    $blocks = [];
    $offset = 0;
    foreach ($groups as $group) {
        for ($b = 0; $b < $group[0]; $b++) {
            $chunk = array_slice($data, $offset, $group[1]);
            $offset += $group[1];
            $blocks[] = [$chunk, qr_code_rs_remainder($chunk, $divisor)];
        }
    }
    $codewords = [];
    $longest = max(array_map(function ($b) {
        return count($b[0]);
    }, $blocks));
    for ($i = 0; $i < $longest; $i++) {
        foreach ($blocks as $block) {
            if ($i < count($block[0])) {
                $codewords[] = $block[0][$i];
            }
        }
    }
    for ($i = 0; $i < $ecLength; $i++) {
        foreach ($blocks as $block) {
            $codewords[] = $block[1][$i];
        }
    }

    // The function patterns, then the data, then the best mask.
    $size = 17 + 4 * $version;
    $modules = array_fill(0, $size, array_fill(0, $size, false));
    $function = $modules;
    $set = function (int $x, int $y, bool $dark) use (&$modules, &$function) {
        $modules[$y][$x] = $dark;
        $function[$y][$x] = true;
    };
    for ($i = 0; $i < $size; $i++) {
        $set(6, $i, $i % 2 === 0);
        $set($i, 6, $i % 2 === 0);
    }
    foreach ([[3, 3], [$size - 4, 3], [3, $size - 4]] as $centre) {
        for ($dy = -4; $dy <= 4; $dy++) {
            for ($dx = -4; $dx <= 4; $dx++) {
                $x = $centre[0] + $dx;
                $y = $centre[1] + $dy;
                if ($x >= 0 && $x < $size && $y >= 0 && $y < $size) {
                    $distance = max(abs($dx), abs($dy));
                    $set($x, $y, $distance !== 2 && $distance !== 4);
                }
            }
        }
    }
    $align = QR_CODE_ALIGN[$version];
    $last = count($align) - 1;
    foreach ($align as $i => $ay) {
        foreach ($align as $j => $ax) {
            if (($i === 0 && $j === 0) || ($i === 0 && $j === $last) || ($i === $last && $j === 0)) {
                continue; // where the finders are
            }
            for ($dy = -2; $dy <= 2; $dy++) {
                for ($dx = -2; $dx <= 2; $dx++) {
                    $set($ax + $dx, $ay + $dy, max(abs($dx), abs($dy)) !== 1);
                }
            }
        }
    }
    qr_code_format($set, $size, 0); // reserves the format areas; redrawn with the chosen mask
    if ($version >= 7) {
        $rem = $version;
        for ($i = 0; $i < 12; $i++) {
            $rem = ($rem << 1) ^ (($rem >> 11) * 0x1F25);
        }
        $versionBits = $version << 12 | $rem;
        for ($i = 0; $i < 18; $i++) {
            $dark = (($versionBits >> $i) & 1) === 1;
            $a = $size - 11 + $i % 3;
            $b = intdiv($i, 3);
            $set($a, $b, $dark);
            $set($b, $a, $dark);
        }
    }

    // Codewords in the zigzag: two columns at a time, from the right,
    // up then down, around the function patterns.
    $bit = 0;
    $total = 8 * count($codewords);
    for ($right = $size - 1; $right >= 1; $right -= 2) {
        if ($right === 6) {
            $right = 5;
        }
        $upward = (($right + 1) & 2) === 0;
        for ($vert = 0; $vert < $size; $vert++) {
            $y = $upward ? $size - 1 - $vert : $vert;
            for ($j = 0; $j < 2; $j++) {
                $x = $right - $j;
                if (!$function[$y][$x] && $bit < $total) {
                    $modules[$y][$x] = (($codewords[$bit >> 3] >> (7 - ($bit & 7))) & 1) === 1;
                    $bit++;
                }
            }
        }
    }

    $best = null;
    $bestScore = PHP_INT_MAX;
    for ($mask = 0; $mask < 8; $mask++) {
        $candidate = qr_code_masked($modules, $function, $mask);
        $setOn = function (int $x, int $y, bool $dark) use (&$candidate) {
            $candidate[$y][$x] = $dark;
        };
        qr_code_format($setOn, $size, $mask);
        $score = qr_code_penalty($candidate);
        if ($score < $bestScore) {
            $best = $candidate;
            $bestScore = $score;
        }
    }
    return $best;
}

/** The 15 format bits (level M and the mask), in both places, and the dark module. */
function qr_code_format(callable $set, int $size, int $mask)
{
    $data = 0 << 3 | $mask; // level M is 00
    $rem = $data;
    for ($i = 0; $i < 10; $i++) {
        $rem = ($rem << 1) ^ (($rem >> 9) * 0x537);
    }
    $bits = ($data << 10 | $rem) ^ 0x5412;
    $bit = function (int $i) use ($bits) {
        return (($bits >> $i) & 1) === 1;
    };
    for ($i = 0; $i <= 5; $i++) {
        $set(8, $i, $bit($i));
    }
    $set(8, 7, $bit(6));
    $set(8, 8, $bit(7));
    $set(7, 8, $bit(8));
    for ($i = 9; $i < 15; $i++) {
        $set(14 - $i, 8, $bit($i));
    }
    for ($i = 0; $i < 8; $i++) {
        $set($size - 1 - $i, 8, $bit($i));
    }
    for ($i = 8; $i < 15; $i++) {
        $set(8, $size - 15 + $i, $bit($i));
    }
    $set(8, $size - 8, true);
}

function qr_code_masked(array $modules, array $function, int $mask): array
{
    $size = count($modules);
    for ($y = 0; $y < $size; $y++) {
        for ($x = 0; $x < $size; $x++) {
            if ($function[$y][$x]) {
                continue;
            }
            switch ($mask) {
                case 0: $flip = ($x + $y) % 2 === 0; break;
                case 1: $flip = $y % 2 === 0; break;
                case 2: $flip = $x % 3 === 0; break;
                case 3: $flip = ($x + $y) % 3 === 0; break;
                case 4: $flip = (intdiv($x, 3) + intdiv($y, 2)) % 2 === 0; break;
                case 5: $flip = $x * $y % 2 + $x * $y % 3 === 0; break;
                case 6: $flip = ($x * $y % 2 + $x * $y % 3) % 2 === 0; break;
                default: $flip = (($x + $y) % 2 + $x * $y % 3) % 2 === 0;
            }
            if ($flip) {
                $modules[$y][$x] = !$modules[$y][$x];
            }
        }
    }
    return $modules;
}

/**
 * The standard's penalty for a masked symbol (lower is easier to read):
 * long runs of one colour, 2×2 blocks, finder-like patterns, and a balance
 * of dark and light far from half.
 */
function qr_code_penalty(array $m): int
{
    $size = count($m);
    $score = 0;
    $dark = 0;
    $lines = [];
    for ($i = 0; $i < $size; $i++) {
        $row = '';
        $column = '';
        for ($j = 0; $j < $size; $j++) {
            $row .= $m[$i][$j] ? '1' : '0';
            $column .= $m[$j][$i] ? '1' : '0';
        }
        $lines[] = $row;
        $lines[] = $column;
        $dark += substr_count($row, '1');
    }
    foreach ($lines as $line) {
        preg_match_all('/0{5,}|1{5,}/', $line, $runs);
        foreach ($runs[0] as $run) {
            $score += 3 + strlen($run) - 5;
        }
        $padded = '0000' . $line . '0000';
        $score += 40 * (preg_match_all('/(?=10111010000)/', $padded) + preg_match_all('/(?=00001011101)/', $padded));
    }
    for ($y = 0; $y < $size - 1; $y++) {
        for ($x = 0; $x < $size - 1; $x++) {
            $c = $m[$y][$x];
            if ($m[$y][$x + 1] === $c && $m[$y + 1][$x] === $c && $m[$y + 1][$x + 1] === $c) {
                $score += 3;
            }
        }
    }
    $total = $size * $size;
    return $score + 10 * intdiv(abs($dark * 20 - $total * 10), $total);
}

/** GF(256) product, modulo x^8 + x^4 + x^3 + x^2 + 1. */
function qr_code_gf_multiply(int $x, int $y): int
{
    $z = 0;
    for ($i = 7; $i >= 0; $i--) {
        $z = ($z << 1) ^ (($z >> 7) * 0x11D);
        $z ^= (($y >> $i) & 1) * $x;
    }
    return $z;
}

/** The Reed-Solomon generator polynomial of a degree, highest term first (its leading 1 left out). */
function qr_code_rs_divisor(int $degree): array
{
    $result = array_fill(0, $degree, 0);
    $result[$degree - 1] = 1;
    $root = 1;
    for ($i = 0; $i < $degree; $i++) {
        for ($j = 0; $j < $degree; $j++) {
            $result[$j] = qr_code_gf_multiply($result[$j], $root);
            if ($j + 1 < $degree) {
                $result[$j] ^= $result[$j + 1];
            }
        }
        $root = qr_code_gf_multiply($root, 0x02);
    }
    return $result;
}

function qr_code_rs_remainder(array $data, array $divisor): array
{
    $result = array_fill(0, count($divisor), 0);
    foreach ($data as $byte) {
        $factor = $byte ^ array_shift($result);
        $result[] = 0;
        foreach ($divisor as $i => $coefficient) {
            $result[$i] ^= qr_code_gf_multiply($coefficient, $factor);
        }
    }
    return $result;
}

/**
 * The code as a PNG: black on white, $scale pixels a module, with the
 * standard's quiet zone of four modules all round. 8-bit greyscale.
 */
function qr_code_png(string $text, int $scale = 6): string
{
    $matrix = qr_code_matrix($text);
    $quiet = 4;
    $modules = count($matrix) + 2 * $quiet;
    $pixels = $modules * $scale;
    $raw = '';
    for ($my = 0; $my < $modules; $my++) {
        $row = "\0"; // filter: none
        for ($mx = 0; $mx < $modules; $mx++) {
            $y = $my - $quiet;
            $x = $mx - $quiet;
            $dark = $y >= 0 && $x >= 0 && $y < count($matrix) && $x < count($matrix) && $matrix[$y][$x];
            $row .= str_repeat($dark ? "\x00" : "\xFF", $scale);
        }
        $raw .= str_repeat($row, $scale);
    }
    $chunk = function (string $type, string $body) {
        return pack('N', strlen($body)) . $type . $body . pack('N', crc32($type . $body));
    };
    return "\x89PNG\r\n\x1A\n"
        . $chunk('IHDR', pack('NNCCCCC', $pixels, $pixels, 8, 0, 0, 0, 0))
        . $chunk('IDAT', qr_code_zlib($raw))
        . $chunk('IEND', '');
}

/** zlib data for a PNG: compressed where the zlib extension is there, else stored as is. */
function qr_code_zlib(string $raw): string
{
    if (function_exists('gzcompress')) {
        return gzcompress($raw, 9);
    }
    $out = "\x78\x01";
    $blocks = str_split($raw, 65535);
    foreach ($blocks as $i => $block) {
        $length = strlen($block);
        $out .= chr($i === count($blocks) - 1 ? 1 : 0) . pack('vv', $length, $length ^ 0xFFFF) . $block;
    }
    return $out . pack('H*', hash('adler32', $raw));
}
