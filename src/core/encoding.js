// Character encoding name normalization and multi-encoding fallback decoding.

const encodingAliasMap = {
  // Simplified Chinese
  GB: 'gbk',
  GBK: 'gbk',
  GB2312: 'gb2312',
  GB_2312: 'gb2312',
  GB18030: 'gb18030',
  GB_18030: 'gb18030',
  // Traditional Chinese
  BIG5: 'big5',
  BIG_5: 'big5',
  BIG5_HKSCS: 'big5',
  // UTF / ASCII
  'UTF-8': 'utf-8',
  UTF8: 'utf-8',
  UTF_8: 'utf-8',
  UNICODEUTF8: 'utf-8',
  'UTF-16': 'utf-16',
  UTF16: 'utf-16',
  'UTF-16LE': 'utf-16le',
  'UTF-16BE': 'utf-16be',
  UCS2: 'utf-16le',
  'UCS-2': 'utf-16le',
  ASCII: 'ascii',
  'US-ASCII': 'ascii',
  // Western
  'WINDOWS-1252': 'windows-1252',
  CP1252: 'windows-1252',
  'ISO-8859-1': 'windows-1252',
  'ISO8859-1': 'windows-1252',
  LATIN1: 'windows-1252',
  // Japanese
  SHIFT_JIS: 'shift_jis',
  SHIFTJIS: 'shift_jis',
  SJIS: 'shift_jis',
  MS_KANJI: 'shift_jis',
  'EUC-JP': 'euc-jp',
  EUC_JP: 'euc-jp',
  EUCJP: 'euc-jp',
  // Korean
  'EUC-KR': 'euc-kr',
  EUC_KR: 'euc-kr',
  EUCKR: 'euc-kr',
  'KS_C_5601-1987': 'euc-kr',
  // Other
  'ISO-2022-JP': 'iso-2022-jp',
  'ISO-2022-KR': 'iso-2022-kr',
};

/**
 * Normalize an encoding name (e.g. from CED) into a label understood by TextDecoder.
 * Example: "GBK" -> "gbk", "Shift_JIS" -> "shift_jis".
 */
export function normalizeEncoding(enc) {
  if (!enc) return 'utf-8';
  let upper = String(enc).trim().toUpperCase();
  // Strip trailing hints such as "UTF-8 (BOM)".
  upper = upper.replace(/\(.*?\)/g, '').trim();
  if (encodingAliasMap[upper]) return encodingAliasMap[upper];
  return upper.replace(/_/g, '-').toLowerCase();
}

// Fallback order: detected encoding first, then common CJK encodings.
const FALLBACK_ENCODINGS = [
  'utf-8',
  'gbk',
  'gb18030',
  'big5',
  'gb2312',
  'shift_jis',
  'euc-jp',
  'euc-kr',
  'windows-1252',
];

// When two decodings score identically (e.g. CED mislabels GBK bytes as Big5 and
// both yield the same number of CJK glyphs), prefer the encoding that is more
// likely to be the true payload for this project's (Simplified Chinese) content.
// UTF-8/GB18030/GBK/GB2312 outrank Big5/Shift_JIS, and pure Latin-1 guesses last.
const TIEBREAK_PREFERENCE = [
  'utf-8',
  'gb18030',
  'gbk',
  'gb2312',
  'big5',
  'shift_jis',
  'euc-jp',
  'euc-kr',
  'windows-1252',
];

function tiebreakRank(enc) {
  const idx = TIEBREAK_PREFERENCE.indexOf(enc);
  return idx === -1 ? TIEBREAK_PREFERENCE.length : idx;
}

/**
 * Try decoding raw bytes with multiple encodings and pick the most meaningful one.
 *
 * @param {Uint8Array} bytes
 * @param {string} detectedEncoding Raw encoding detected by CED (may be normalized later).
 * @returns {{ text: string, score: number, encoding: string }}
 */
export function decodeWithFallback(bytes, detectedEncoding) {
  const candidates = [normalizeEncoding(detectedEncoding), ...FALLBACK_ENCODINGS];
  const unique = [];
  for (const enc of candidates) {
    if (enc && !unique.includes(enc)) unique.push(enc);
  }

  // If the raw bytes are valid UTF-8, that is a very strong signal: legacy CJK
  // byte streams (GBK/GB18030/Big5/Shift_JIS) are almost never valid UTF-8, while
  // genuinely UTF-8 payloads always are. Mis-decoding UTF-8 bytes as GB18030 can
  // otherwise produce MORE CJK glyphs and win the naive readability score.
  let validUtf8 = false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    validUtf8 = true;
  } catch {
    // Invalid UTF-8; fine.
  }

  let best = { text: '', score: -Infinity, encoding: '' };
  for (const enc of unique) {
    try {
      const decoder = new TextDecoder(enc, { fatal: false });
      const text = decoder.decode(bytes);
      let score = scoreDecodedText(text);
      if (validUtf8 && enc === 'utf-8') score += 5000;
      // Higher score wins; equal scores are broken by CJK-safe preference so a
      // wrong CED label (e.g. GBK bytes guessed as Big5) cannot silently win.
      if (
        score > best.score ||
        (score === best.score && tiebreakRank(enc) < tiebreakRank(best.encoding))
      ) {
        best = { text, score, encoding: enc };
      }
    } catch (e) {
      // Skip encodings not supported by this environment.
    }
  }
  return best;
}

/**
 * Text readability scorer. Rewards CJK (Chinese work orders) and JSON-ish payloads;
 * harshly penalizes mojibake left by mis-decoding UTF-8/GBK bytes as Latin-1 /
 * Windows-1252. Public, so callers can implement their own "low-confidence" checks.
 *
 * @param {string} text
 * @returns {number}
 */
export function scoreText(text) {
  if (!text) return -1e9;
  let score = 0;
  const cn = text.match(/[\u4e00-\u9fff]/g);
  if (cn) score += cn.length * 5;
  score += text.length;
  if (text.trim().startsWith('{') || text.trim().startsWith('[')) score += 20;

  // Common mojibake produced when Chinese bytes are read as ISO-8859 / Windows-1252.
  if (/[¹ÐÖ¿ÅÆÑÌ]/.test(text)) score -= 40;
  if (/Ã.|Â./.test(text)) score -= 30;
  const garbage = (text.match(/[€‚ƒ„…†‡ˆ‰Š‹ŒŽ'""•–—˜™š›œžŸ]/g) || []).length;
  score -= garbage * 10;

  return score;
}

/**
 * Character-set decoding with a CED sniffing function plus scorer fallback.
 *
 * Strategy ("double insurance"):
 *   1. Ask detectWithCed(rawBytes) for its best guess and decode with it.
 *   2. If that text scores highly (readable CJK / JSON), take it as-is.
 *   3. Otherwise run a multi-encoding candidate shoot-out (GB18030/GBK/GB2312/
 *      UTF-8/Big5) and return whichever scores best.
 *
 * @param {Uint8Array} rawBytes
 * @param {(bytes: Uint8Array) => string | null | undefined} detectWithCed
 * @returns {{ text: string, encoding: string, score: number }}
 */
export function decodeBytesWithFallback(rawBytes, detectWithCed) {
  let cedText = '';
  let cedEncoding = '';
  try {
    const enc = (detectWithCed && detectWithCed(rawBytes)) || 'utf-8';
    cedEncoding = normalizeEncoding(enc);
    cedText = new TextDecoder(cedEncoding, { fatal: false }).decode(rawBytes);
  } catch {
    cedText = '';
  }

  const cedScore = scoreText(cedText);
  if (cedScore > 10 && cedEncoding) {
    return { text: cedText, encoding: cedEncoding, score: cedScore };
  }

  // Low-confidence CED result: brute-force the common candidates.
  let bestText = cedText;
  let bestEncoding = cedEncoding || 'utf-8';
  let maxScore = cedScore;
  for (const enc of ['gb18030', 'gbk', 'gb2312', 'utf-8', 'big5']) {
    try {
      const t = new TextDecoder(enc, { fatal: false }).decode(rawBytes);
      const s = scoreText(t);
      if (s > maxScore) {
        maxScore = s;
        bestText = t;
        bestEncoding = enc;
      }
    } catch {
      // Unsupported / undecodable in this environment.
    }
  }
  return { text: bestText, encoding: bestEncoding, score: maxScore };
}

/**
 * Score a decoded string: readable text (CJK in particular) gains points, while
 * mojibake (U+FFFD) and control characters are heavily penalized.
 */
function scoreDecodedText(text) {
  if (!text) return -Infinity;

  const cjkCount = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;

  let garbage = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // NUL and unexpected control characters are treated as garbage.
    if (c === 0 || (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d)) garbage++;
  }

  const ratioPenalty = text.length > 0 ? (replacementCount + garbage) / text.length : 1;
  return (
    cjkCount * 10 +
    text.length * 2 -
    (replacementCount + garbage) * 100 -
    (ratioPenalty > 0.5 ? 10000 : 0)
  );
}
