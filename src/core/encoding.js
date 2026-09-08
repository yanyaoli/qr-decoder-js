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

  let best = { text: '', score: -Infinity, encoding: '' };
  for (const enc of unique) {
    try {
      const decoder = new TextDecoder(enc, { fatal: false });
      const text = decoder.decode(bytes);
      const score = scoreDecodedText(text);
      if (score > best.score) {
        best = { text, score, encoding: enc };
      }
    } catch (e) {
      // Skip encodings not supported by this environment.
    }
  }
  return best;
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
