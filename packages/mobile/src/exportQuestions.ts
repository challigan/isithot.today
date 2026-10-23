/**
 * `Questions.swift` (iOS build spec, section 7.1): the question above each answer, from core's
 * own `question()`, called for each view, with and without a place, and with `tomorrow` false and
 * true. With a place, the question is a template with a `{place}` slot, so core's table of
 * questions needn't be exported and the Swift needs no rules of its own: it picks a template and
 * puts the place in.
 */
import { VIEWS, question, type View } from '@isithot/core';
import { generatedHeader, swiftCase, swiftIdentifier, swiftString } from './swift';

export const QUESTIONS_PATH =
  'apps/ios/Packages/IsItCore/Sources/IsItModel/Generated/Questions.swift';

export const QUESTIONS_SOURCE = 'packages/core/src/copy.ts (question)';

/** Where a template's place goes, in the Swift and in core's answer when asked for it. */
export const PLACE_SLOT = '{place}';

export interface QuestionTemplate {
  view: View;
  tomorrow: boolean;
  withPlace: boolean;
  /** Core's question; with a place, `PLACE_SLOT` stands for it, once. */
  text: string;
}

/** Every template, by view (in `VIEWS`' order), then `tomorrow`, then without a place first. */
export function questionTemplates(): QuestionTemplate[] {
  const templates: QuestionTemplate[] = [];
  for (const view of VIEWS) {
    for (const tomorrow of [false, true]) {
      for (const withPlace of [false, true]) {
        const text = question(withPlace ? PLACE_SLOT : null, view, 'snow', tomorrow);
        const slots = text.split(PLACE_SLOT).length - 1;
        if (slots !== (withPlace ? 1 : 0)) {
          throw new Error(`question() gave ${JSON.stringify(text)}, with ${slots} place slots`);
        }
        templates.push({ view, tomorrow, withPlace, text });
      }
    }
  }
  return templates;
}

export function questionsSwift(): string {
  return [
    generatedHeader(QUESTIONS_SOURCE),
    '',
    'import Foundation',
    '',
    '/// The question above each answer, worded by core: "Will it snow today?", "Is it snowing in',
    '/// Leeds right now?". Templates, made by calling core\'s `question()` for every case.',
    'public enum Questions {',
    "  /// Where a template's place goes.",
    `  public static let slot = ${swiftString(PLACE_SLOT)}`,
    '',
    "  /// Core's `question(place, view, 'snow', tomorrow)`. `tomorrow` changes only the middle",
    '  /// view, and a nil or empty place asks without one, as core does.',
    '  public static func snow(view: AppView, place: String?, tomorrow: Bool) -> String {',
    '    guard let place, !place.isEmpty else {',
    '      return template(view: view, tomorrow: tomorrow, withPlace: false)',
    '    }',
    '    return template(view: view, tomorrow: tomorrow, withPlace: true)',
    '      .replacingOccurrences(of: slot, with: place)',
    '  }',
    '',
    '  /// The question for a view, with `slot` once for the place, or without a place.',
    '  public static func template(view: AppView, tomorrow: Bool, withPlace: Bool) -> String {',
    '    switch (view, tomorrow, withPlace) {',
    ...questionTemplates().flatMap((t) =>
      swiftCase(
        '    ',
        `(.${swiftIdentifier(t.view)}, ${t.tomorrow}, ${t.withPlace})`,
        swiftString(t.text),
      ),
    ),
    '    }',
    '  }',
    '}',
    '',
  ].join('\n');
}
