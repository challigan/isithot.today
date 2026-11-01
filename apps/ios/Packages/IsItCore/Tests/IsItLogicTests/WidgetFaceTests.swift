import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// What the vectors don't reach of a widget's face (packages/mobile `widgetFace`, ported as
/// `WidgetFace`): a day without forecasts, one forecast of six, a week day without counts and a
/// day without its band label (an answer saved before they existed); the locked and stale faces
/// whole; and, across every vector face, the links, what VoiceOver reads, and the words.
@Suite("A widget's face")
struct WidgetFaceTests {
  let answers = FixtureAnswers()

  /// durham-tomorrow's first entry at its own moment, 6:05pm: Tomorrow, Yes, 4cm, six of six.
  func durham() throws -> WidgetEntry {
    let now = try #require(ApiJSON.parseDate(try Fixtures.info("durham-tomorrow").now))
    let plan = WidgetPlanner.entries(
      try answers("durham-tomorrow"), fetchedAt: now, now: now, unlocked: true)
    return try #require(plan.entries.first)
  }

  /// durham-tomorrow's tomorrow (`snow.days.1`), its JSON changed by `edit` first.
  func tomorrow(_ edit: (inout [String: Any]) -> Void) throws -> ApiSnowDay {
    let root = try #require(
      try JSONSerialization.jsonObject(with: Fixtures.data("durham-tomorrow")) as? [String: Any])
    let snow = try #require(root["snow"] as? [String: Any])
    let days = try #require(snow["days"] as? [[String: Any]])
    var day = try #require(days.dropFirst().first)
    edit(&day)
    return try ApiJSON.decoder().decode(
      ApiSnowDay.self, from: JSONSerialization.data(withJSONObject: day))
  }

  /// `entry` with `day` as its middle day, and `week` as its rows when given.
  func entry(_ entry: WidgetEntry, day: ApiSnowDay?, week: [WidgetDay]? = nil) -> WidgetEntry {
    WidgetEntry(
      date: entry.date, state: entry.state, placeName: entry.placeName, slot: entry.slot,
      day: day, now: entry.now, week: week ?? entry.week, palette: entry.palette)
  }

  @Test("no dots, and no count read, for a day no forecast has data for")
  func noDotsWithoutForecasts() throws {
    let durham = try durham()
    let face = WidgetFace(entry(durham, day: try tomorrow { $0["total"] = 0 }), unit: .cm)
    #expect(face.agreement == nil)
    #expect(face.agreementShort == "")
    #expect(face.spoken == "Durham. Tomorrow: Yes. Snow, 4cm.")
    #expect(face.spokenShort == "Tomorrow: Yes. Snow, 4cm.")
    #expect(face.spokenGauge == "Tomorrow: Yes.")
    #expect(face.detail == "Snow · 4cm")
  }

  @Test("one forecast of six expects snow, in the singular")
  func oneForecastExpects() throws {
    let face = WidgetFace(entry(try durham(), day: try tomorrow { $0["snowy"] = 1 }), unit: .cm)
    #expect(face.agreement?.snowy == 1)
    #expect(face.agreement?.total == 6)
    #expect(face.agreementShort == "1 of 6 forecasts")
    #expect(face.spoken.hasSuffix(" 1 of 6 forecasts expects snow."))
    #expect(face.spokenGauge == "Tomorrow: 1 of 6 forecasts expects snow.")
  }

  @Test("a week day without counts, or without forecasts, has no dots")
  func aWeekDayWithoutCountsHasNoDots() throws {
    let durham = try durham()
    let friday = try #require(durham.week.first)
    #expect(friday.label == "Fri")
    func counted(_ snowy: Int?, _ total: Int?) -> WidgetDay {
      WidgetDay(
        date: friday.date, label: friday.label, band: friday.band, bandLabel: friday.bandLabel,
        amount: friday.amount, snowy: snowy, total: total)
    }
    let rows = WidgetFace(
      entry(durham, day: durham.day, week: [counted(nil, nil), counted(0, 0), counted(6, nil)]),
      unit: .cm
    ).week
    #expect(rows.map(\.agreement) == [nil, nil, nil])
    #expect(
      rows.map(\.spoken) == [
        "Friday, 8cm, heavy snow", "Friday, 8cm, heavy snow, 0 of 0 forecasts expect snow",
        "Friday, 8cm, heavy snow",
      ])
  }

  @Test("a day saved without its band label reads core's label for its reason or band")
  func aDayWithoutItsBandLabel() throws {
    let durham = try durham()
    let warm = WidgetFace(
      entry(
        durham,
        day: try tomorrow {
          $0["bandLabel"] = nil
          $0["reason"] = "warm"
          $0["band"] = "nosnow"
          $0["amount"] = 0
        }),
      unit: .cm)
    #expect(warm.detail == "Too warm")
    #expect(warm.inline == "Tomorrow: Too warm")
    let snow = WidgetFace(entry(durham, day: try tomorrow { $0["bandLabel"] = nil }), unit: .cm)
    #expect(snow.detail == "Snow · 4cm")
    #expect(snow.inline == "Tomorrow: Snow")
    #expect(snow.spokenShort == "Tomorrow: Yes. Snow, 4cm. 6 of 6 forecasts expect snow.")
  }

  /// Every string of `face`'s other than its message is empty, and it has no agreement, Now or
  /// rows: the locked and stale faces say one thing.
  func saysOnly(_ message: String, _ face: WidgetFace) {
    #expect(face.message == message)
    #expect(
      [face.inline, face.spoken, face.spokenShort, face.spokenGauge]
        == Array(repeating: message, count: 4))
    #expect(face.band == .nosnow)
    #expect(
      [face.place, face.slot, face.answer, face.detail, face.agreementShort, face.slotAnswer]
        .allSatisfy { $0.isEmpty })
    #expect(face.agreement == nil)
    #expect(face.now == nil)
    #expect(face.week.isEmpty)
    #expect(face.weekLink == "")
  }

  @Test("locked, the face says only that the app turns widgets on, and taps through to it")
  func lockedSaysOnlyItsLine() throws {
    let now = try #require(ApiJSON.parseDate(try Fixtures.info("aberdeen-snow").now))
    let plan = WidgetPlanner.entries(
      try answers("aberdeen-snow"), fetchedAt: now, now: now, unlocked: false)
    let face = WidgetFace(try #require(plan.entries.first), unit: .cm)
    #expect(face.state == .locked)
    #expect(face.link == "willitsnow://upgrade")
    saysOnly(AppCopy.widgetLocked, face)
  }

  @Test("stale, the face says only that there is no recent forecast, and taps through to Today")
  func staleSaysOnlyItsLine() throws {
    let now = try #require(ApiJSON.parseDate(try Fixtures.info("aberdeen-snow").now))
    let plan = WidgetPlanner.entries(nil, fetchedAt: now, now: now, unlocked: true)
    let face = WidgetFace(try #require(plan.entries.first), unit: .cm)
    #expect(face.state == .stale)
    #expect(face.link == "willitsnow://view/today")
    saysOnly(AppCopy.widgetStale, face)
  }

  @Test("each face's links open their views: Today, or the upgrade when locked, and the week")
  func theLinksOpenTheirViews() throws {
    let faces = try vectorFaces().map(\.face)
    #expect(Set(faces.map(\.state)) == Set(WidgetEntry.State.allCases))
    for face in faces {
      let opens: DeepLink.Route = face.state == .locked ? .upgrade : .view(.today)
      #expect(DeepLink.parse(face.link) == opens, "\(face.link)")
      if face.state == .ok {
        #expect(DeepLink.parse(face.weekLink) == .view(.week), "\(face.weekLink)")
      } else {
        #expect(face.weekLink == "")
      }
    }
  }

  /// What VoiceOver reads of `face`: each family's sentence, Now's and the rows'.
  func spoken(_ face: WidgetFace) -> [String] {
    [face.spoken, face.spokenShort, face.spokenGauge] + [face.now?.spoken].compactMap { $0 }
      + face.week.map(\.spoken)
  }

  @Test("a middle dot is shown, never read")
  func noMiddleDotIsRead() throws {
    let faces = try vectorFaces().map(\.face)
    #expect(faces.contains { $0.detail.contains("·") && $0.slotAnswer.contains("·") })
    for text in faces.flatMap(spoken) {
      #expect(!text.contains("·"), "\(text)")
    }
  }

  @Test("each sentence VoiceOver reads ends with one full stop")
  func everySentenceEnds() throws {
    for face in try vectorFaces().map(\.face) {
      let sentences: [String?] = [
        face.spoken, face.spokenShort, face.spokenGauge, face.now?.spoken,
      ]
      for text in sentences.compactMap({ $0 }) {
        #expect(text.hasSuffix("."), "\(text)")
        #expect(!text.contains(".."), "\(text)")
      }
    }
  }

  /// The words of `entry` that are the answer's own, as the server wrote them: the place, the
  /// day's answer and band label, Now's answer and verdict, and the rows' labels; each also
  /// starting in lower case, as a row reads its band label mid-sentence. Longest first, so a
  /// shorter one never splits a longer one.
  func answersWords(_ entry: WidgetEntry) -> [String] {
    let day = entry.day.map { day in
      [day.answer, day.bandLabel ?? "", day.reason.flatMap(CoreCopy.snowReasonLabel) ?? ""]
        + [CoreCopy.snowBandLabel(day.band) ?? ""]
    }
    let words =
      [entry.placeName] + (day ?? []) + [entry.now?.answer, entry.now?.verdict].compactMap { $0 }
      + entry.week.flatMap { [$0.label, $0.bandLabel] }
    let both = words.filter { !$0.isEmpty }.flatMap {
      [$0, $0.prefix(1).lowercased() + $0.dropFirst()]
    }
    return Set(both).sorted { $0.count > $1.count }
  }

  @Test("a face words snow alone: what is left once the answer's own words are taken out")
  func snowOnly() throws {
    var checked = 0
    for (entry, face) in try vectorFaces() {
      let shown =
        [
          face.link, face.place, face.slot, face.answer, face.detail, face.agreementShort,
          face.slotAnswer, face.inline, face.message, face.spoken, face.spokenShort,
          face.spokenGauge, face.weekLink,
        ] + [face.now?.label, face.now?.text, face.now?.spoken].compactMap { $0 }
        + face.week.flatMap { [$0.label, $0.bandLabel, $0.spoken] }
      let words = answersWords(entry)
      for text in shown {
        let own = words.reduce(text) { $0.replacingOccurrences(of: $1, with: " ") }
        #expect(otherTopic(in: own) == nil, "\(text)")
        checked += 1
      }
    }
    #expect(checked > 500)
    // The check sees a face's own words: one that worded rain itself would fail.
    #expect(otherTopic(in: "Tomorrow: rain likely.") == "rain")
  }

  @Test(
    "the medium's rows read as the app's week page reads the same days",
    arguments: ["aberdeen-snow", "durham-tomorrow"])
  func theWeekRowsReadAsTheAppsDo(_ fixture: String) throws {
    let now = try #require(ApiJSON.parseDate(try Fixtures.info(fixture).now))
    let res = try answers(fixture)
    let entry = try #require(
      WidgetPlanner.entries(res, fetchedAt: now, now: now, unlocked: true).entries.first)
    let rows = WidgetFace(entry, unit: .cm).week
    let page = try #require(HomePage(res, view: .week, at: now, phase: .ready).week?.rows)
    #expect(rows.count == 4)
    // A week's seven labels are distinct, so a row is matched by its label.
    for row in rows {
      let same = try #require(page.first { $0.label == row.label }, "\(row.label)")
      #expect(row.spoken == same.spoken)
      #expect(row.bandLabel == same.bandLabel)
    }
  }
}
