import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

extension VectorPort {
  /// `page.json`: packages/mobile `homePage`, the app's page made of core's and the client's
  /// rules, ported as `HomePage`, for every fixture and view at its own moment, at an hour ahead,
  /// the last minute before `usableUntil` and at it, across 6pm, after each kind of request (with
  /// the server's message, `in.message`), with blocks taken out (`in.without`) and with no answer
  /// at all; and core `creditParts`, ported as `Credits.parts`. Where the page shows one of the
  /// answer's own objects, the vector names its path in the fixture (`shown`), and the middle
  /// page's strip is checked against `StripGeometry` for that day, which `strip.json` checks
  /// against core.
  static let page = VectorPort { file in
    let answers = FixtureAnswers()

    struct Input: Decodable, Sendable, CustomStringConvertible {
      let fixture: String?
      let without: [String]?
      let view: AppView
      let now: Int
      let phase: HomePage.Phase
      let message: String?
      let placeName: String?

      var description: String {
        let answer = fixture.map { name in
          without.map { "\(name) without \($0.joined(separator: ", "))" } ?? name
        }
        let said = message.map { " \"\($0)\"" } ?? ""
        let place = placeName.map { ", place \"\($0)\"" } ?? ""
        return "\(answer ?? "no answer") at \(now), \(view), \(phase)\(said)\(place)"
      }
    }
    struct Line: Decodable, Sendable, Equatable {
      let text: String
      let out: Bool
    }
    struct Day: Decodable, Sendable {
      let heading: String
      let summary: String
      let limited: String?
      let lines: [Line]
    }
    struct Footer: Decodable, Sendable {
      let updated: String?
      let notice: String?
    }
    struct Page: Decodable, Sendable {
      let view: AppView
      let state: HomePage.State
      let tomorrow: Bool
      let label: String
      let band: SnowBand?
      let question: String
      let answer: String
      let heading: String
      let verdict: String?
      let detail: String?
      let shown: String?
      let day: Day?
      let retry: String?
      let footer: Footer?
    }
    try file.forEachCase("homePage", input: Input.self, output: Page.self) { item in
      let input = item.input
      let expected = item.output
      let label = "page.json case \(item.index): homePage(\(input))"
      let res = try input.fixture.map { try answers($0, without: input.without ?? []) }
      let page = HomePage(
        res,
        view: input.view,
        at: Date(epochMs: input.now),
        phase: input.phase,
        message: input.message,
        placeName: input.placeName
      )
      #expect(page.view == expected.view, "\(label): view")
      #expect(page.state == expected.state, "\(label): state")
      #expect(page.tomorrow == expected.tomorrow, "\(label): tomorrow")
      #expect(page.band == expected.band, "\(label): band")
      #expect(page.palette == Palettes.snow(expected.band ?? .nosnow), "\(label): palette")
      #expect(page.day?.lines.map { Line(text: $0.text, out: $0.out) } == expected.day?.lines)
      // Every string on the page, in order, the same text code unit for code unit.
      let texts: [String?] = [
        page.label, page.question, page.answer, page.headingLabel, page.verdict, page.detail,
        page.retry, page.day?.heading, page.day?.summary, page.day?.limited,
        page.footer?.updated, page.footer?.notice,
      ]
      let want: [String?] = [
        expected.label, expected.question, expected.answer, expected.heading, expected.verdict,
        expected.detail, expected.retry, expected.day?.heading, expected.day?.summary,
        expected.day?.limited, expected.footer?.updated, expected.footer?.notice,
      ]
      #expect(texts == want, "\(label): text")
      #expect(sameText(texts, want), "\(label): text code unit for code unit")
      #expect((page.day == nil) == (expected.day == nil), "\(label): day")
      #expect((page.footer == nil) == (expected.footer == nil), "\(label): footer")
      // The middle page's strip is the shown day's, and its rows are the strip's models.
      if let day = page.day, let name = input.fixture, let unit = res?.snow?.unit {
        let shown = try #require(
          try Fixtures.object(ApiSnowDay.self, at: expected.shown, in: name), "\(label): day")
        #expect(day.strip == StripGeometry(day: shown, unit: unit), "\(label): strip")
        #expect(day.lines.map(\.name) == day.strip.items.map(\.name), "\(label): names")
        #expect(day.lines.map(\.value) == day.strip.items.map(\.value), "\(label): values")
      }
      // The footer passes the answer's links, places and credits through.
      if let res, let footer = page.footer {
        #expect(footer.outboundIntro == CoreCopy.outboundIntro, "\(label): links' intro")
        #expect(footer.links == (res.links ?? []), "\(label): links")
        #expect(footer.nearbyLabel == CoreCopy.nearby, "\(label): nearby label")
        #expect(footer.nearby == (res.nearby ?? []), "\(label): nearby")
        #expect(footer.credits == res.attribution.map(Credits.parts), "\(label): credits")
      }
    }

    struct Credit: Decodable, Sendable, CustomStringConvertible {
      let text: String

      var description: String { "\"\(text)\"" }
    }
    try file.compare("creditParts", input: Credit.self, output: [CreditPart].self) {
      Credits.parts($0.text)
    }
  }
}
