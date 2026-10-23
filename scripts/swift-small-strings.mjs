#!/usr/bin/env node
/**
 * The short string literals in an optimised Swift binary for arm64, which strings(1) can't see.
 * Swift keeps a string of up to 15 bytes inside the String value itself (a small string), and the
 * optimiser builds a literal one in registers with MOVZ and MOVK, 16 bits at a time, so its bytes
 * are never next to each other in the file. Every debug hook's name is that short (-uitest,
 * -fixture, -umpGeography…), so scripts/check-archive.sh and apps/ios/ci/release-check.sh look for
 * them here as well as in strings' output.
 *
 *   node scripts/swift-small-strings.mjs <binary>    each literal once, a line each
 *
 * It reads every aligned 32-bit word of the file as an instruction (each slice's code is
 * aligned), rebuilds each constant a MOVZ starts and the MOVKs after it complete, on the same
 * register within the next few instructions, and keeps those that are the first word of an ASCII
 * small string: printable bytes, then only zeros. A string of more than 8 bytes goes on in a
 * second word, whose top byte is 0xE0 plus its length, which is looked for among the constants
 * nearby. Literals under 4 bytes are left out, as strings(1) leaves them out. Checked against
 * LLVM 21's arm64 code for a probe of the debug hooks (docs/DECISIONS.md).
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** How many instructions after a MOVZ the MOVKs that complete its constant may come. */
export const CHAIN = 8;
/** How many instructions apart a small string's two words may be built. */
export const PAIR = 16;
/** The shortest literal kept. */
export const MIN_LENGTH = 4;

// The move-wide instructions, without the width bit (bit 31): opc in bits 29 and 30, then 100101.
const OPCODE = 0x7f800000;
const KINDS = new Map([
  [0x12800000, 'movn'],
  [0x52800000, 'movz'],
  [0x72800000, 'movk'],
]);

/** The move-wide instruction `word` is, or null: its kind, width, register, shift and immediate. */
export function moveWide(word) {
  const kind = KINDS.get((word & OPCODE) >>> 0);
  if (!kind) return null;
  const wide = word >>> 31 === 1;
  const hw = (word >>> 21) & 3;
  // A 32-bit move can only shift by 0 or 16.
  if (!wide && hw > 1) return null;
  return { kind, wide, rd: word & 31, shift: BigInt(hw * 16), imm: BigInt((word >>> 5) & 0xffff) };
}

/** Each constant a MOVZ starts, with the MOVKs that follow it on its register: `{ at, value }`. */
export function constants(bytes) {
  const count = Math.floor(bytes.length / 4);
  const word = (i) => bytes.readUInt32LE(i * 4);
  const found = [];
  for (let i = 0; i < count; i++) {
    const start = moveWide(word(i));
    if (start?.kind !== 'movz') continue;
    let value = start.imm << start.shift;
    for (let j = i + 1; j < Math.min(count, i + 1 + CHAIN); j++) {
      const next = moveWide(word(j));
      if (next?.rd !== start.rd) continue;
      // Another constant for the same register: this one is finished.
      if (next.kind !== 'movk' || next.wide !== start.wide) break;
      value = (value & ~(0xffffn << next.shift)) | (next.imm << next.shift);
    }
    found.push({ at: i, value });
  }
  return found;
}

const printable = (byte) => byte >= 0x20 && byte <= 0x7e;
const byteAt = (value, i) => Number((value >> BigInt(i * 8)) & 0xffn);

/** The text of a small string's first word: printable bytes, then only zeros; or null. */
export function firstWord(value) {
  let text = '';
  for (let i = 0; i < 8; i++) {
    const byte = byteAt(value, i);
    if (byte === 0) return text && value >> BigInt(i * 8) === 0n ? text : null;
    if (!printable(byte)) return null;
    text += String.fromCharCode(byte);
  }
  return text;
}

/**
 * A second word of an ASCII small string of 8 to 15 bytes: 0xE0 plus the length in the top byte,
 * then the bytes after the eighth and only zeros. `{ length, text }`, or null.
 */
export function secondWord(value) {
  const top = Number(value >> 56n);
  if (top < 0xe8 || top > 0xef) return null;
  const length = top - 0xe0;
  let text = '';
  for (let i = 0; i < 7; i++) {
    const byte = byteAt(value, i);
    if (i < length - 8) {
      if (!printable(byte)) return null;
      text += String.fromCharCode(byte);
    } else if (byte !== 0) return null;
  }
  return { length, text };
}

/** The second word built nearest the first word at `found[n]`, within PAIR instructions. */
function pairOf(found, n) {
  let best = null;
  for (const k of [n - 1, n + 1]) {
    const step = k < n ? -1 : 1;
    for (let m = k; m >= 0 && m < found.length; m += step) {
      const distance = Math.abs(found[m].at - found[n].at);
      if (distance > PAIR) break;
      const second = secondWord(found[m].value);
      if (second && (!best || distance < best.distance)) best = { ...second, distance };
      if (second) break;
    }
  }
  return best;
}

/**
 * Every ASCII small-string literal the binary's instructions build, in order and each once. A
 * first word of 8 bytes is joined to its second word when one is near it; otherwise its 8 bytes
 * stand alone.
 */
export function smallStrings(bytes) {
  const found = constants(bytes);
  const seen = new Set();
  found.forEach((constant, n) => {
    const text = firstWord(constant.value);
    if (text === null) return;
    const literal = text.length === 8 ? text + (pairOf(found, n)?.text ?? '') : text;
    if (literal.length >= MIN_LENGTH) seen.add(literal);
  });
  return [...seen];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [path, ...rest] = process.argv.slice(2);
  if (!path || rest.length) {
    console.error('usage: swift-small-strings.mjs <binary>');
    process.exit(2);
  }
  const literals = smallStrings(readFileSync(path));
  if (literals.length) process.stdout.write(`${literals.join('\n')}\n`);
}
