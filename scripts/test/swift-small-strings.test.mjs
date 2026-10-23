import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CHAIN,
  PAIR,
  constants,
  firstWord,
  moveWide,
  secondWord,
  smallStrings,
} from '../swift-small-strings.mjs';

const SCRIPT = new URL('../swift-small-strings.mjs', import.meta.url).pathname;

/** Instruction words as an arm64 binary holds them, little-endian. */
const code = (...words) => {
  const bytes = Buffer.alloc(words.length * 4);
  words.forEach((w, i) => bytes.writeUInt32LE(w >>> 0, i * 4));
  return bytes;
};

// Move-wide encoders, for cases the compiler output below doesn't cover.
const movz = (rd, imm, hw = 0, wide = true) =>
  ((wide ? 0x80000000 : 0) | 0x52800000 | (hw << 21) | (imm << 5) | rd) >>> 0;
const movk = (rd, imm, hw, wide = true) =>
  ((wide ? 0x80000000 : 0) | 0x72800000 | (hw << 21) | (imm << 5) | rd) >>> 0;
const NOP = 0xd503201f;
const RET = 0xd65f03c0;

// Real code: LLVM 21 compiling `swiftc -O` IR of the debug hooks for arm64-apple-ios17.0
// (docs/DECISIONS.md). Each comment is llvm-objdump's.
const UITEST = [
  0xd28ea5b3, // mov  x19, #0x752d
  0xf2ae8d33, // movk x19, #0x7469, lsl #16
  0xf2ce6cb3, // movk x19, #0x7365, lsl #32
  0xf2e00e93, // movk x19, #0x74, lsl #48
  0xf9400808, // ldr  x8, [x0, #0x10]
];
const UMP_GEOGRAPHY = [
  0xd28c2e54, // mov  x20, #0x6172          second word: "raphy", 0xED (13 bytes)
  0xf2ad0e14, // movk x20, #0x6870, lsl #16
  0xf2c00f34, // movk x20, #0x79, lsl #32
  0xf2fda014, // movk x20, #0xed00, lsl #48
  0xd28ea5b5, // mov  x21, #0x752d          first word: "-umpGeog"
  0xf2ae0db5, // movk x21, #0x706d, lsl #16
  0xf2cca8f5, // movk x21, #0x6547, lsl #32
  0xf2ecedf5, // movk x21, #0x676f, lsl #48
  0xf9400816, // ldr  x22, [x0, #0x10]
];
const LOOPBACK = [
  0xd2800628, // mov  x8, #0x31             second word: "1", 0xE9 (9 bytes)
  0xf2fd2008, // movk x8, #0xe900, lsl #48
  0xd2864620, // mov  x0, #0x3231           first word: "127.0.0."
  0xf2a5c6e0, // movk x0, #0x2e37, lsl #16
  0xf2c5c600, // movk x0, #0x2e30, lsl #32
  0xf2e5c600, // movk x0, #0x2e30, lsl #48
  0xeb00029f, // cmp  x20, x0
];
const FIXTURE = [
  0xd28cc5b3, // mov  x19, #0x662d          "-fixture", exactly 8 bytes
  0xf2af0d33, // movk x19, #0x7869, lsl #16
  0xf2ceae93, // movk x19, #0x7574, lsl #32
  0xf2ecae53, // movk x19, #0x6572, lsl #48
  0x9100e014, // add  x20, x0, #0x38
  0x52800036, // mov  w22, #0x1
  0xd2fd0018, // mov  x24, #-0x1800000000000000   second word: 0xE8, nothing more
];
// The same "-uitest" scheduled for LLVM's generic CPU, its moves among others': the MOVKs come 3,
// 6 and 9 instructions after the MOVZ.
const UITEST_SPREAD = [
  0xd28ea5b5, // mov  x21, #0x752d
  0xf9400817, // ldr  x23, [x0, #0x10]
  0xaa0003f4, // mov  x20, x0
  0xf2ae8d35, // movk x21, #0x7469, lsl #16
  0x9100a016, // add  x22, x0, #0x28
  0x52800033, // mov  w19, #0x1
  0xf2ce6cb5, // movk x21, #0x7365, lsl #32
  0x910006f8, // add  x24, x23, #0x1
  0xd2fce019, // mov  x25, #-0x1900000000000000
  0xf2e00e95, // movk x21, #0x74, lsl #48
];
// Six literals passed to one function, for the generic CPU: their words are built side by side,
// so "-uitest" (x0) takes 26 instructions, and the second words sit nearer other strings than
// their own ("raphy", -umpGeography's, is next to -resetStore's first word).
const SIX_ARGUMENTS = [
  0xd2864628, // mov  x8, #0x3231
  0xd28c25aa, // mov  x10, #0x612d
  0xd28ea5a0, // mov  x0, #0x752d
  0xd28ea5a2, // mov  x2, #0x752d
  0xd28c2e43, // mov  x3, #0x6172
  0xd28e45a4, // mov  x4, #0x722d
  0xf2a5c6e8, // movk x8, #0x2e37, lsl #16
  0xf2ad2e0a, // movk x10, #0x6970, lsl #16
  0xf2ae8d20, // movk x0, #0x7469, lsl #16
  0xf2ae0da2, // movk x2, #0x706d, lsl #16
  0xf2ad0e03, // movk x3, #0x6870, lsl #16
  0xf2ae6ca4, // movk x4, #0x7365, lsl #16
  0xd28e4de5, // mov  x5, #0x726f
  0xd28e45a6, // mov  x6, #0x722d
  0xd2800634, // mov  x20, #0x31
  0xf2c5c608, // movk x8, #0x2e30, lsl #32
  0xd28dcd29, // mov  x9, #0x6e69
  0xf2ce49ea, // movk x10, #0x724f, lsl #32
  0xf2ce6ca0, // movk x0, #0x7365, lsl #32
  0xf2cca8e2, // movk x2, #0x6547, lsl #32
  0xf2c00f23, // movk x3, #0x79, lsl #32
  0xf2ce8ca4, // movk x4, #0x7465, lsl #32
  0xf2a00ca5, // movk x5, #0x65, lsl #16
  0xf2aeade6, // movk x6, #0x756f, lsl #16
  0xf2fd2014, // movk x20, #0xe900, lsl #48
  0xf2e5c608, // movk x8, #0x2e30, lsl #48
  0xf2fd4009, // movk x9, #0xea00, lsl #48
  0xf2eced2a, // movk x10, #0x6769, lsl #48
  0xf2e00e80, // movk x0, #0x74, lsl #48
  0xf2ecede2, // movk x2, #0x676f, lsl #48
  0xf2fda003, // movk x3, #0xed00, lsl #48
  0xf2ee8a64, // movk x4, #0x7453, lsl #48
  0xf2fd6005, // movk x5, #0xeb00, lsl #48
  0xf2ccae86, // movk x6, #0x6574, lsl #32
  0xd2fce001, // mov  x1, #-0x1900000000000000
  0xd2fcc007, // mov  x7, #-0x1a00000000000000
];
const JSON_SUFFIX = [
  0xd28d45c0, // mov  x0, #0x6a2e           ".json"
  0xf2adee60, // movk x0, #0x6f73, lsl #16
  0xf2c00dc0, // movk x0, #0x6e, lsl #32
  0x910043f4, // add  x20, sp, #0x10
  0xd2fca001, // mov  x1, #-0x1b00000000000000    second word: 0xE5
];

describe('moveWide', () => {
  it('decodes MOVZ, MOVK and MOVN, 64-bit and 32-bit', () => {
    expect(moveWide(0xd28ea5b3)).toEqual({
      kind: 'movz',
      wide: true,
      rd: 19,
      shift: 0n,
      imm: 0x752dn,
    });
    expect(moveWide(0xf2e00e93)).toMatchObject({ kind: 'movk', rd: 19, shift: 48n, imm: 0x74n });
    expect(moveWide(0x52800036)).toMatchObject({ kind: 'movz', wide: false, rd: 22, imm: 1n });
    expect(moveWide(0x92800000)).toMatchObject({ kind: 'movn', wide: true, rd: 0 });
  });

  it('is null for anything else, and for a 32-bit move shifted past 16', () => {
    for (const word of [NOP, RET, 0xf9400808, 0xeb00029f, 0x94000000]) {
      expect(moveWide(word)).toBeNull();
    }
    expect(moveWide(movz(1, 0x2d2d, 2, false))).toBeNull();
  });
});

describe('constants', () => {
  it('joins the MOVKs to the MOVZ that starts them, on its register only', () => {
    expect(constants(code(...UITEST))).toEqual([{ at: 0, value: 0x007473657469752dn }]);
    expect(constants(code(...UITEST_SPREAD))).toEqual([
      { at: 0, value: 0x007473657469752dn },
      { at: 5, value: 1n },
      { at: 8, value: 0xe700000000000000n },
    ]);
    // Another register's moves in between change nothing.
    const interleaved = code(movz(3, 0x4142), movz(4, 0xffff), movk(3, 0x4344, 1), movk(4, 1, 1));
    expect(constants(interleaved).map((c) => c.value)).toEqual([0x43444142n, 0x1ffffn]);
  });

  it('stops at the next constant for the same register, or a piece it already has', () => {
    const restarted = code(movz(5, 0x6161), movz(5, 0x6262), movk(5, 0x6363, 1));
    expect(constants(restarted).map((c) => c.value)).toEqual([0x6161n, 0x63636262n]);
    const again = code(movz(6, 0x6161), movk(6, 0x6262, 1), movk(6, 0x6363, 1));
    expect(constants(again).map((c) => c.value)).toEqual([0x62626161n]);
    const narrowed = code(movz(7, 0x6161), movk(7, 0x6262, 1, false));
    expect(constants(narrowed).map((c) => c.value)).toEqual([0x6161n]);
  });

  it('joins MOVKs up to CHAIN instructions on, and no further', () => {
    const late = (gap) => code(movz(6, 0x6161), ...Array(gap).fill(NOP), movk(6, 0x6262, 1));
    expect(constants(late(8)).map((c) => c.value)).toEqual([0x62626161n]);
    expect(constants(late(26)).map((c) => c.value)).toEqual([0x62626161n]);
    expect(constants(late(CHAIN - 1)).map((c) => c.value)).toEqual([0x62626161n]);
    expect(constants(late(CHAIN)).map((c) => c.value)).toEqual([0x6161n]);
  });

  it('reads only whole words', () => {
    expect(constants(Buffer.concat([code(...UITEST), Buffer.from([0x2d, 0x75])]))).toHaveLength(1);
    expect(constants(Buffer.alloc(3))).toEqual([]);
  });
});

describe('firstWord and secondWord', () => {
  it('reads a first word: printable bytes, then only zeros', () => {
    expect(firstWord(0x007473657469752dn)).toBe('-uitest');
    expect(firstWord(0x657275747869662dn)).toBe('-fixture');
    expect(firstWord(0x776f6e2dn)).toBe('-now');
    expect(firstWord(0n)).toBeNull();
    expect(firstWord(0x0a74697475n)).toBeNull(); // a line feed
    expect(firstWord(0x7400657469752dn)).toBeNull(); // a zero, then more text
    expect(firstWord(0xe700000000000000n)).toBeNull();
  });

  it('reads a second word: 0xE0 and the length on top, the rest of the text, then zeros', () => {
    expect(secondWord(0xed00007968706172n)).toEqual({ length: 13, text: 'raphy' });
    expect(secondWord(0xe900000000000031n)).toEqual({ length: 9, text: '1' });
    expect(secondWord(0xe800000000000000n)).toEqual({ length: 8, text: '' });
    expect(secondWord(0xe700000000000000n)).toBeNull(); // 7 bytes: no second word
    expect(secondWord(0xa900000000000031n)).toBeNull(); // not ASCII
    expect(secondWord(0xe900000000003131n)).toBeNull(); // more text than its length
    expect(secondWord(0xe900000000000001n)).toBeNull();
  });
});

describe('smallStrings', () => {
  it("finds the compiler's short literals, joining the two words of a longer one", () => {
    const binary = code(
      RET,
      ...UITEST,
      ...UMP_GEOGRAPHY,
      ...LOOPBACK,
      ...FIXTURE,
      ...JSON_SUFFIX,
      ...UITEST,
    );
    expect(smallStrings(binary)).toEqual([
      '-uitest',
      '-umpGeography',
      '127.0.0.1',
      '-fixture',
      '.json',
    ]);
  });

  it("finds literals whose moves the scheduler spread among other constants'", () => {
    expect(smallStrings(code(...UITEST_SPREAD))).toEqual(['-uitest']);
    // Each first word whole. The 8-byte ones are joined to the nearest second word, which here
    // is mostly the wrong one, so scripts/check-archive.sh matches them by their first 8 bytes.
    expect(smallStrings(code(...SIX_ARGUMENTS))).toEqual([
      '127.0.0.raphy',
      '-apiOrigraphy',
      '-uitest',
      '-umpGeography',
      '-resetStraphy',
      '-route',
    ]);
  });

  it('pairs with the nearest second word, before or after', () => {
    const after = code(...UMP_GEOGRAPHY.slice(4), NOP, ...UMP_GEOGRAPHY.slice(0, 4));
    expect(smallStrings(after)).toEqual(['-umpGeography']);
    // "URLProtocolStub": the 15-byte second word, then "URLProto".
    const stub = code(
      0xd28dec61, // mov  x1, #0x6f63
      0xf2aa6d81, // movk x1, #0x536c, lsl #16
      0xf2ceae81, // movk x1, #0x7574, lsl #32
      0xf2fdec41, // movk x1, #0xef62, lsl #48
      0xd28a4aa0, // mov  x0, #0x5255
      0xf2aa0980, // movk x0, #0x504c, lsl #16
      0xf2cdee40, // movk x0, #0x6f72, lsl #32
      0xf2edee80, // movk x0, #0x6f74, lsl #48
    );
    expect(smallStrings(stub)).toEqual(['URLProtocolStub']);
  });

  it('keeps 8 bytes alone when no second word is near', () => {
    const far = code(
      ...UMP_GEOGRAPHY.slice(4),
      ...Array(PAIR).fill(NOP),
      ...UMP_GEOGRAPHY.slice(0, 4),
    );
    expect(smallStrings(far)).toEqual(['-umpGeog']);
  });

  it('finds a 32-bit literal, and leaves out ones under 4 bytes', () => {
    const now = code(movz(8, 0x6e2d, 0, false), movk(8, 0x776f, 1, false));
    const short = code(movz(9, 0x6f2d, 0, true), movk(9, 0x6b, 1, true));
    expect(smallStrings(Buffer.concat([now, short]))).toEqual(['-now']);
  });

  it('finds nothing in text, data or code without such constants', () => {
    expect(smallStrings(Buffer.from('-uitest -fixture 127.0.0.1\0'))).toEqual([]);
    expect(smallStrings(code(NOP, RET, movz(1, 0xffff, 3), movz(2, 0x0102)))).toEqual([]);
  });
});

describe('the command', () => {
  const dir = mkdtempSync(join(tmpdir(), 'small-strings-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('prints each literal on a line, and nothing when there are none', () => {
    const binary = join(dir, 'binary');
    writeFileSync(binary, code(...UITEST, ...LOOPBACK));
    expect(execFileSync('node', [SCRIPT, binary], { encoding: 'utf8' })).toBe(
      '-uitest\n127.0.0.1\n',
    );
    const empty = join(dir, 'empty');
    writeFileSync(empty, '');
    expect(execFileSync('node', [SCRIPT, empty], { encoding: 'utf8' })).toBe('');
  });

  it('says how to use it', () => {
    let status = 0;
    try {
      execFileSync('node', [SCRIPT], { stdio: 'pipe' });
    } catch (err) {
      status = err.status;
    }
    expect(status).toBe(2);
  });
});
