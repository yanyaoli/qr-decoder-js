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
  upper = upper.replace(/\(.*?\)/g, '').trim();
  if (encodingAliasMap[upper]) return encodingAliasMap[upper];
  return upper.replace(/_/g, '-').toLowerCase();
}

// Fallback candidate list: standard universal CJK and western encodings
const FALLBACK_ENCODINGS = [
  'utf-8',
  'gb18030',
  'gbk',
  'big5',
  'gb2312',
  'shift_jis',
  'euc-jp',
  'euc-kr',
  'windows-1252',
];

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
 * Universal text readability scorer.
 * Gives positive points for valid readable CJK and printable ASCII,
 * while heavily penalizing mojibake (replacement character \uFFFD) and unexpected control codes.
 * Contains ZERO project-specific heuristics.
 *
 * @param {string} text
 * @returns {number}
 */
export function scoreText(text) {
  if (!text) return -Infinity;

  // CJK unified ideographs + kana + hangul
  const cjkCount = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/g) || []).length;
  const replacementCount = (text.match(/\uFFFD/g) || []).length;

  let printable = 0;
  let garbage = 0;

  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Printable characters + whitespace (\t, \n, \r)
    if ((c >= 0x20 && c !== 0x7f) || c === 0x09 || c === 0x0a || c === 0x0d) {
      printable++;
    } else {
      garbage++;
    }
  }

  // Heavy penalties for common mojibake sequences when multi-byte bytes are misinterpreted as Latin-1
  let mojibakePenalty = 0;
  if (/[¹ÐÖ¿ÅÆÑÌ]/.test(text)) mojibakePenalty += 40;
  if (/Ã.|Â./.test(text)) mojibakePenalty += 30;

  const ratioPenalty = text.length > 0 ? (replacementCount + garbage) / text.length : 1;

  return (
    cjkCount * 10 +
    printable * 2 -
    mojibakePenalty -
    (replacementCount + garbage) * 100 -
    (ratioPenalty > 0.4 ? 10000 : 0)
  );
}

/**
 * Decode raw QR bytes with multi-encoding fallback.
 * Uses native TextDecoder with automatic validation and heuristic scoring.
 *
 * @param {Uint8Array} bytes
 * @param {string} [detectedEncoding] Encoding suggested by external detector (e.g. CED).
 * @returns {{ text: string, score: number, encoding: string }}
 */
export function decodeWithFallback(bytes, detectedEncoding) {
  // 1. Strict UTF-8 verification: if bytes form completely valid UTF-8 without error,
  // UTF-8 has the highest confidence.
  let validUtf8 = false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    validUtf8 = true;
  } catch {
    // Not valid UTF-8
  }

  const candidates = [normalizeEncoding(detectedEncoding), ...FALLBACK_ENCODINGS];
  const unique = [];
  for (const enc of candidates) {
    if (enc && !unique.includes(enc)) unique.push(enc);
  }

  let best = { text: '', score: -Infinity, encoding: 'utf-8' };

  for (const enc of unique) {
    try {
      const decoder = new TextDecoder(enc, { fatal: false });
      const text = decoder.decode(bytes);
      let score = scoreText(text);

      if (validUtf8 && enc === 'utf-8') {
        score += 5000;
      }

      if (
        score > best.score ||
        (score === best.score && tiebreakRank(enc) < tiebreakRank(best.encoding))
      ) {
        best = { text, score, encoding: enc };
      }
    } catch {
      // Skip unsupported encodings in current JS environment
    }
  }

  return best;
}
