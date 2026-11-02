import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// The gallery's and the placeholder's face (iOS build spec, section 11.3): generated as JSON
/// from packages/mobile `widgetFace` (`WidgetSample.face`) and decoded once by `WidgetFace.sample`,
/// it is the face the Swift builds from the same fixture at the same moment.
@Suite("The widget gallery's sample")
struct WidgetSampleTests {
  @Test("it decodes, and is durham-tomorrow's face at 6:05pm as the Swift builds it")
  func sampleIsDurhamTomorrow() throws {
    let decoded = try JSONDecoder().decode(WidgetFace.self, from: Data(WidgetSample.face.utf8))
    #expect(WidgetFace.sample == decoded)
    #expect(WidgetFace.sample.state == .ok)
    let now = try #require(ApiJSON.parseDate(try Fixtures.info("durham-tomorrow").now))
    let res = try TodayResponse.decode(from: Fixtures.data("durham-tomorrow"))
    let entry = try #require(
      WidgetPlanner.entries(res, fetchedAt: now, now: now, unlocked: true).entries.first)
    #expect(WidgetFace.sample == WidgetFace(entry, unit: .cm))
  }

  @Test("it reads Tomorrow: Yes in Durham, 4cm, all six forecasts expecting snow")
  func sampleWords() {
    let face = WidgetFace.sample
    #expect(face.place == "Durham")
    #expect(face.slot == "Tomorrow")
    #expect(face.answer == "Yes.")
    #expect(face.detail == "Snow · 4cm")
    #expect(face.agreement?.snowy == 6)
    #expect(face.agreement?.total == 6)
    #expect(face.band == .snow)
    // Every day after Thursday, the middle day, to the week's end.
    #expect(face.week.map(\.label) == ["Fri", "Sat", "Sun", "Mon", "Tue"])
  }
}
