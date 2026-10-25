import Foundation
import IsItLogic
import IsItModel
import Testing

/// Every string Settings shows, so a test can read them all.
private func allWords(_ screen: SettingsScreen) -> [String] {
  var all = [screen.title, screen.close, screen.units.label, screen.units.footnote]
  all += screen.units.choices.map(\.name)
  for section in screen.sections {
    all += [section.heading].compactMap { $0 }
    for row in section.rows {
      all.append(row.title)
      if case .mail(let draft) = row.action {
        all += [draft.fallback.title, draft.fallback.body, draft.fallback.copyAddress]
        all.append(draft.fallback.copied)
      }
    }
  }
  return all + [screen.version].compactMap { $0 }
}

@Suite("Settings, as plain values")
struct SettingsScreenTests {
  let version = AppVersion(version: "1.0", build: "112")

  @Test("the free version: units, then privacy, Report an ad, about and help, then the version")
  func free() throws {
    let screen = SettingsScreen(units: .c, unlocked: false, privacyChoices: false, version: version)
    #expect(screen.title == "Settings")
    #expect(screen.close == "Close")
    #expect(screen.units.label == "Snow units")
    #expect(screen.units.choices.map(\.name) == ["cm", "in"])
    #expect(screen.units.choices.map(\.units) == [.c, .f])
    #expect(screen.units.selected == .c)
    #expect(screen.units.footnote == "Temperatures follow: cm with °C, inches with °F.")
    #expect(screen.sections.map(\.id) == ["privacy", "report", "about", "help"])
    #expect(screen.sections.map(\.heading) == ["Privacy", nil, "About", "Help"])
    #expect(
      screen.sections.map { $0.rows.map(\.title) } == [
        ["Your privacy", "Privacy policy"],
        ["Report an ad"],
        ["How it works", "Credits and licences", "Terms"],
        ["Contact us", "Support"],
      ])
    #expect(screen.version == "Version 1.0 (112)")
  }

  @Test("each row opens the right thing: willitsnow.today's own pages in Safari, emails, pages")
  func actions() throws {
    let screen = SettingsScreen(units: .f, unlocked: false, privacyChoices: false, version: version)
    let rows = Dictionary(
      uniqueKeysWithValues: screen.sections.flatMap(\.rows).map { ($0.id, $0.action) })
    let site = try #require(URL(string: "https://willitsnow.today"))
    #expect(rows["your-privacy"] == .page(.yourPrivacy))
    #expect(rows["privacy-policy"] == .open(site.appending(path: "privacy")))
    #expect(rows["report-ad"] == .reportAd)
    #expect(rows["how-it-works"] == .page(.howItWorks))
    #expect(rows["credits"] == .page(.credits))
    #expect(rows["terms"] == .open(site.appending(path: "terms")))
    #expect(rows["contact-us"] == .mail(.contactUs()))
    #expect(rows["support"] == .open(site.appending(path: "support")))
    #expect(rows.count == 8)
    #expect(Constants.Site.privacy == "https://willitsnow.today/privacy")
  }

  @Test("bought: no Report an ad, as there are no ads")
  func unlocked() {
    let screen = SettingsScreen(units: .c, unlocked: true, privacyChoices: false, version: version)
    #expect(screen.sections.map(\.id) == ["privacy", "about", "help"])
    #expect(!screen.sections.flatMap(\.rows).contains { $0.action == .reportAd })
  }

  @Test("Privacy choices only while the ads are on and Google's form is required")
  func privacyChoices() {
    let shown = SettingsScreen(units: .c, unlocked: false, privacyChoices: true, version: version)
    #expect(
      shown.sections[0].rows.map(\.title) == ["Privacy choices", "Your privacy", "Privacy policy"])
    #expect(shown.sections[0].rows[0].action == .privacyChoices)
    #expect(shown.sections[0].rows[0].id == "privacy-choices")
    let hidden = SettingsScreen(units: .c, unlocked: false, privacyChoices: false, version: version)
    #expect(!hidden.sections.flatMap(\.rows).contains { $0.action == .privacyChoices })
  }

  @Test("each row has its own icon, the one for what it opens, and the units row has the ruler's")
  func icons() throws {
    let screen = SettingsScreen(units: .c, unlocked: false, privacyChoices: true, version: version)
    let rows = screen.sections.flatMap(\.rows)
    #expect(
      rows.map { "\($0.id) \($0.icon)" } == [
        "privacy-choices privacyChoices", "your-privacy yourPrivacy", "privacy-policy policy",
        "report-ad reportAd", "how-it-works howItWorks", "credits credits", "terms terms",
        "contact-us contactUs", "support support",
      ])
    #expect(screen.units.icon == .units)
    // Every icon is some row's, and no two rows share one, so each row reads apart at a glance.
    let shown = [screen.units.icon] + rows.map(\.icon)
    #expect(Set(shown).count == shown.count)
    #expect(Set(shown) == Set(SettingsScreen.Icon.allCases))
    // The other versions drop rows, never change an icon.
    for unlocked in [false, true] {
      for choices in [false, true] {
        let other = SettingsScreen(
          units: nil, unlocked: unlocked, privacyChoices: choices, version: nil)
        for row in other.sections.flatMap(\.rows) {
          #expect(rows.first { $0.id == row.id }?.icon == row.icon, "\(row.id)")
        }
      }
    }
    // Your privacy's button to the policy is the same kind of row as Settings'.
    #expect(try #require(YourPrivacy(adsOn: true, privacyChoices: false).policy).icon == .policy)
  }

  @Test("before the first answer chose the units, neither choice is chosen")
  func noUnits() {
    let screen = SettingsScreen(units: nil, unlocked: false, privacyChoices: false, version: nil)
    #expect(screen.units.selected == nil)
    #expect(screen.version == nil)
  }

  @Test("the version line, from the bundle's two values, or none")
  func appVersion() {
    #expect(AppVersion(version: "1.0", build: "112")?.line == "Version 1.0 (112)")
    #expect(AppVersion(version: "1.0", build: nil) == nil)
    #expect(AppVersion(version: nil, build: "112") == nil)
    #expect(AppVersion(version: "", build: "112") == nil)
    #expect(AppVersion(version: "1.0", build: "") == nil)
  }

  @Test("every row has its own identifier, and no word names another app, site or weather")
  func noOtherTopic() {
    for unlocked in [false, true] {
      for choices in [false, true] {
        let screen = SettingsScreen(
          units: .c, unlocked: unlocked, privacyChoices: choices, version: version)
        let ids = screen.sections.flatMap(\.rows).map(\.id)
        #expect(Set(ids).count == ids.count)
        for word in allWords(screen) {
          #expect(otherTopic(in: word) == nil, "\(word)")
          #expect(!word.isEmpty)
        }
      }
    }
  }
}
