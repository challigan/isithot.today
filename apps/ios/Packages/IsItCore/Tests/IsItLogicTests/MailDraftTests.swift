import Foundation
import IsItLogic
import IsItModel
import Testing

@Suite("The emails Settings writes: Contact us and Report an ad")
struct MailDraftTests {
  /// 3:05pm in London on 23 October 2026 (BST).
  let afternoon = Date(epochMs: 1_792_764_300_000)

  @Test("Contact us: the support address, nothing filled in, and where to write without mail")
  func contactUs() throws {
    let draft = MailDraft.contactUs()
    #expect(draft.address == "support@willitsnow.today")
    #expect(draft.address == Constants.Site.contactEmail)
    #expect(draft.subject == nil)
    #expect(draft.body == nil)
    #expect(try #require(draft.url).absoluteString == "mailto:support@willitsnow.today")
    #expect(draft.fallback.title == "Contact us")
    #expect(
      draft.fallback.body
        == "Email support@willitsnow.today. Tell us what happened, and the version number at the "
        + "end of Settings.")
    #expect(draft.fallback.address == "support@willitsnow.today")
    #expect(draft.fallback.copyAddress == "Copy address")
    #expect(draft.fallback.copied == "Copied.")
    #expect(draft.fallback.close == "Close")
  }

  @Test("Report an ad: section 10.7's subject and body, with the phone's time and the place")
  func reportAd() throws {
    #expect(ApiJSON.parseDate("2026-10-23T14:05:00Z") == afternoon)
    let draft = MailDraft.reportAd(
      version: AppVersion(version: "1.0", build: "112"),
      place: "Leeds",
      at: afternoon,
      zone: "Europe/London"
    )
    #expect(draft.address == "support@willitsnow.today")
    #expect(draft.subject == "Report an ad (willitsnow.today 1.0)")
    #expect(
      draft.body
        == "Time: 2026-10-23 15:05 Europe/London\nPlace: Leeds\nWhat was wrong with the ad:\n")
    // As JavaScript's encodeURIComponent encodes each, so a space is %20, never "+".
    #expect(
      try #require(draft.url).absoluteString
        == "mailto:support@willitsnow.today?subject=Report%20an%20ad%20(willitsnow.today%201.0)"
        + "&body=Time%3A%202026-10-23%2015%3A05%20Europe%2FLondon%0APlace%3A%20Leeds%0A"
        + "What%20was%20wrong%20with%20the%20ad%3A%0A")
    #expect(draft.fallback.title == "Report an ad")
    #expect(
      draft.fallback.body
        == "Email support@willitsnow.today with a screenshot of the ad and the time you saw it.")
    #expect(draft.fallback.copyAddress == "Copy address")
    #expect(draft.fallback.copied == "Copied.")
  }

  @Test("a place's name is encoded whole, whatever it holds")
  func encoding() throws {
    let draft = MailDraft.reportAd(
      version: nil,
      place: "Saint-Étienne & Co's “x” ?=#+%",
      at: afternoon,
      zone: "Europe/London"
    )
    let url = try #require(draft.url).absoluteString
    #expect(url.hasPrefix("mailto:support@willitsnow.today?subject=Report%20an%20ad&body=Time"))
    // node -e 'console.log(encodeURIComponent("Saint-Étienne & Co's “x” ?=#+%"))'
    #expect(
      url.contains(
        "Place%3A%20Saint-%C3%89tienne%20%26%20Co's%20%E2%80%9Cx%E2%80%9D%20%3F%3D%23%2B%25%0A"))
  }

  @Test("without a version the subject is the row's own words; without a place, an empty line")
  func unknowns() {
    let draft = MailDraft.reportAd(version: nil, place: nil, at: afternoon, zone: "Europe/London")
    #expect(draft.subject == "Report an ad")
    #expect(
      draft.body == "Time: 2026-10-23 15:05 Europe/London\nPlace: \nWhat was wrong with the ad:\n")
  }

  @Test("the phone's time, in figures with its own zone")
  func phoneTime() throws {
    func at(_ iso: String) throws -> Date { try #require(ApiJSON.parseDate(iso)) }
    #expect(
      MailDraft.phoneTime(afternoon, zone: "Europe/London") == "2026-10-23 15:05 Europe/London")
    #expect(
      MailDraft.phoneTime(try at("2026-12-01T09:05:59Z"), zone: "Europe/London")
        == "2026-12-01 09:05 Europe/London")
    #expect(
      MailDraft.phoneTime(try at("2026-12-01T18:45:00Z"), zone: "Asia/Kolkata")
        == "2026-12-02 00:15 Asia/Kolkata")
    #expect(
      MailDraft.phoneTime(try at("2026-12-01T23:59:00Z"), zone: "UTC") == "2026-12-01 23:59 UTC")
    #expect(
      MailDraft.phoneTime(try at("2026-12-01T00:00:00Z"), zone: "America/Denver")
        == "2026-11-30 17:00 America/Denver")
    // A zone the system doesn't know reads as UTC, under the name it was given.
    #expect(
      MailDraft.phoneTime(try at("2026-12-01T09:05:00Z"), zone: "Nowhere/Else")
        == "2026-12-01 09:05 Nowhere/Else")
  }
}
