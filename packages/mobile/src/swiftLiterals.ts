/**
 * The string literals in Swift source, for the guard that keeps every user-facing word out of the
 * app's Swift (iOS build spec, section 10 and Appendix D, phase 6's exit): every word on screen
 * and every accessibility label comes from the generated copy (`CoreCopy`, `AppCopy`,
 * `AppCredits`, `Constants`), the presenters that build on it, or the server's answer. This
 * module reads the literals, with where each one is; `packages/mobile/test/swiftLiterals.test.ts`
 * decides which of them look like prose and holds the allowlist.
 *
 * It is a small lexer, not a parser: it knows Swift's comments (nested block comments too),
 * string literals in every form (`"…"`, multi-line `"""…"""`, raw `#"…"#` with any number of
 * `#`, and their interpolations `\(…)`, which may hold literals of their own), and the brackets
 * around each literal, which give the call it is an argument of and its argument label. A
 * literal it can't close is an error, so a source it misreads fails the guard rather than
 * passing it.
 */

/** One string literal in a Swift file. */
export interface SwiftLiteral {
  /** The line it opens on, from 1. */
  line: number;
  /**
   * What it says: its escapes read (`\n`, `\t`, `\"`, `\\`, `\u{…}`), a line continuation
   * removed, and each interpolation `\(…)` as `{}`.
   */
  text: string;
  /**
   * The function, type or modifier it is an argument of, by its last name (`Text`,
   * `accessibilityIdentifier`, `fatalError`); `''` outside any call, in a closure's body or an
   * array or dictionary literal, or directly inside an interpolation.
   */
  callee: string;
  /** Its argument label (`verbatim`, `forResource`), or `''` when it has none. */
  label: string;
}

/** What encloses the code at a point: a call (by its callee), or another bracket. */
interface Frame {
  close: ')' | ']' | '}';
  callee: string;
}

const IDENTIFIER_END = /[\p{L}\p{N}_]$/u;

/** The identifier that ends `code`, if one does: a call's callee, or an argument's label. */
function lastIdentifier(code: string): string {
  const match = /([\p{L}_][\p{L}\p{N}_]*)$/u.exec(code);
  return match ? match[1]! : '';
}

/** A line continuation (`\` at a line's end) in a multi-line literal, until it is joined. */
const CONTINUED = '\uE000\n';

/**
 * A multi-line literal's text as Swift reads it: from the line after the opening delimiter to
 * the line before the closing one, less the closing delimiter's indentation on every line.
 */
function multiLineText(raw: string): string {
  const lines = raw.split('\n').slice(1);
  const indent = lines.pop() ?? '';
  return lines
    .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
    .join('\n')
    .replaceAll(CONTINUED, '');
}

/** Every string literal in `source`, in order, with interpolations' literals after their own. */
export function swiftLiterals(source: string): SwiftLiteral[] {
  const found: SwiftLiteral[] = [];
  const stack: Frame[] = [];
  let i = 0;
  // The line at `scanned`, counted on as far as each literal asks.
  let line = 1;
  let scanned = 0;

  const lineAt = (index: number): number => {
    for (; scanned < index; scanned++) if (source[scanned] === '\n') line++;
    return line;
  };

  /** The code before `index` on its own, back over spaces: what a literal or bracket follows. */
  const codeBefore = (index: number): string => {
    let j = index;
    while (j > 0 && /\s/.test(source[j - 1]!)) j--;
    return source.slice(Math.max(0, j - 200), j);
  };

  const skipLineComment = (): void => {
    while (i < source.length && source[i] !== '\n') i++;
  };

  const skipBlockComment = (): void => {
    let depth = 0;
    do {
      if (source.startsWith('/*', i)) {
        depth++;
        i += 2;
      } else if (source.startsWith('*/', i)) {
        depth--;
        i += 2;
      } else if (i >= source.length) {
        throw new Error(`An unclosed block comment at line ${lineAt(i)}`);
      } else {
        i++;
      }
    } while (depth > 0);
  };

  /** The literal opening at `i` (at its first `#` or quote), read up to its closing delimiter. */
  const readString = (): void => {
    const start = i;
    let hashes = 0;
    while (source[i] === '#') {
      hashes++;
      i++;
    }
    const multiLine = source.startsWith('"""', i);
    i += multiLine ? 3 : 1;
    const close = (multiLine ? '"""' : '"') + '#'.repeat(hashes);
    const escape = '\\' + '#'.repeat(hashes);
    const before = codeBefore(start);
    const frame = stack[stack.length - 1];
    const labelled = /([\p{L}_][\p{L}\p{N}_]*)\s*:$/u.exec(before);
    const literal: SwiftLiteral = {
      line: lineAt(start),
      text: '',
      callee: frame?.close === ')' ? frame.callee : '',
      label: labelled && !before.endsWith('::') ? labelled[1]! : '',
    };
    found.push(literal);
    let text = '';
    for (;;) {
      if (i >= source.length) throw new Error(`An unclosed string literal at line ${literal.line}`);
      if (source.startsWith(close, i)) {
        i += close.length;
        break;
      }
      if (!multiLine && source[i] === '\n') {
        throw new Error(`An unclosed string literal at line ${literal.line}`);
      }
      if (source.startsWith(escape, i)) {
        i += escape.length;
        const c = source[i]!;
        if (c === '(') {
          i++;
          stack.push({ close: ')', callee: '' });
          const depth = stack.length;
          // The interpolation's code, up to its own closing parenthesis.
          while (stack.length >= depth) {
            if (i >= source.length) {
              throw new Error(`An unclosed interpolation at line ${literal.line}`);
            }
            step();
          }
          text += '{}';
          continue;
        }
        i++;
        if (c === 'n') text += '\n';
        else if (c === 't') text += '\t';
        else if (c === 'r') text += '\r';
        else if (c === '0') text += '\0';
        else if (c === 'u' && source[i] === '{') {
          const end = source.indexOf('}', i);
          text += String.fromCodePoint(parseInt(source.slice(i + 1, end), 16));
          i = end + 1;
        } else if (c === '\n' || c === ' ' || c === '\t') {
          // A line continuation in a multi-line literal, up to its newline: marked, so the next
          // line loses its indentation before the two are joined.
          while (source[i - 1] !== '\n') i++;
          text += CONTINUED;
        } else text += c;
        continue;
      }
      text += source[i];
      i++;
    }
    literal.text = multiLine ? multiLineText(text) : text;
  };

  /** Reads one token of code at `i`: a comment, a literal, a bracket, or one character. */
  const step = (): void => {
    const c = source[i]!;
    if (source.startsWith('//', i)) return skipLineComment();
    if (source.startsWith('/*', i)) return skipBlockComment();
    if (c === '"') return readString();
    if (c === '#') {
      let j = i;
      while (source[j] === '#') j++;
      if (source[j] === '"') return readString();
      i = j;
      return;
    }
    if (c === '(') {
      const before = codeBefore(i);
      stack.push({ close: ')', callee: IDENTIFIER_END.test(before) ? lastIdentifier(before) : '' });
    } else if (c === '[') {
      stack.push({ close: ']', callee: '' });
    } else if (c === '{') {
      stack.push({ close: '}', callee: '' });
    } else if (c === ')' || c === ']' || c === '}') {
      const frame = stack.pop();
      if (frame?.close !== c) {
        throw new Error(`An unmatched ${c} at line ${lineAt(i)}`);
      }
    }
    i++;
  };

  while (i < source.length) step();
  if (stack.length > 0) throw new Error(`An unclosed ${stack[stack.length - 1]!.close} bracket`);
  return found;
}
