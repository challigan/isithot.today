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
      all += [row.detail].compactMap { $0 }
      if case .mail(let draft) = row.action {
        all += [draft.fallback.title, draft.fallback.body, draft.fallback.copyAddress]
        all.append(draft.fallback.copied)
      }
    }
  }
  return all + [screen.version].compactMap { $0 }
}

/// For sale at £1.99, with Family Sharing on.
private let forSale = PurchaseState(product: .ready(price: "£1.99", familyShareable: true))

/// Every state of the product StoreKit can give.
private let products: [PurchaseState.Product] = [
  .loading, .unavailable, .blocked, .ready(price: "£1.99", familyShareable: true),
]

/// The icons of Settings → Notifications and its "Where you are" page, drawn between the units
/// and the upgrade card rather than as one of `sections` (NotificationSettingsTests).
private let notificationIcons: Set<SettingsScreen.Icon> = [
  .evening, .morning, .possible, .notificationPlace, .test, .openSettings, .warnings, .myLocation,
]

@Suite("Settings, as plain values")
struct SettingsScreenTests {
  let version = AppVersion(version: "1.0", build: "112")

  /// The upgrade card's rows in `screen`, as "id, title".
  func upgradeRows(_ screen: SettingsScreen) throws -> [String] {
    let upgrade = try #require(screen.sections.first { $0.id == "upgrade" })
    #expect(upgrade.heading == nil)
    return upgrade.rows.map { "\($0.id), \($0.title)" }
  }

  @Test("the free version: units, the upgrade, privacy, Report an ad, about, help, the version")
  func free() throws {
    let screen = SettingsScreen(
      units: .c, unlocked: false, privacyChoices: false, purchase: forSale, version: version)
    #expect(screen.title == "Settings")
    #expect(screen.close == "Close")
    #expect(screen.units.label == "Snow units")
    #expect(screen.units.choices.map(\.name) == ["cm", "in"])
    #expect(screen.units.choices.map(\.units) == [.c, .f])
    #expect(screen.units.selected == .c)
    #expect(screen.units.footnote == "Temperatures follow: cm with °C, inches with °F.")
    #expect(screen.sections.map(\.id) == ["upgrade", "privacy", "report", "about", "help"])
    #expect(screen.sections.map(\.heading) == [nil, "Privacy", nil, "About", "Help"])
    #expect(
      screen.sections.map { $0.rows.map(\.title) } == [
        ["Remove ads and add widgets · £1.99", "Restore purchase"],
        ["Your privacy", "Privacy policy"],
        ["Report an ad"],
        ["How it works", "Credits and licences", "Terms"],
        ["Contact us", "Support"],
      ])
    #expect(screen.version == "Version 1.0 (112)")
    let upgrade = try #require(screen.sections.first).rows
    #expect(upgrade.map(\.id) == ["upgrade", "restore"])
    #expect(upgrade.map(\.action) == [.page(.upgrade), .restore])
    #expect(upgrade.map(\.icon) == [.upgrade, .restore])
    #expect(upgrade.map(\.detail) == [nil, nil])
    #expect(upgrade.map(\.busy) == [false, false])
  }

  @Test("each row opens the right thing: willitsnow.today's own pages in Safari, emails, pages")
  func actions() throws {
    let screen = SettingsScreen(
      units: .f, unlocked: false, privacyChoices: false, purchase: forSale, version: version)
    let rows = Dictionary(
      uniqueKeysWithValues: screen.sections.flatMap(\.rows).map { ($0.id, $0.action) })
    let site = try #require(URL(string: "https://willitsnow.today"))
    #expect(rows["upgrade"] == .page(.upgrade))
    #expect(rows["restore"] == .restore)
    #expect(rows["your-privacy"] == .page(.yourPrivacy))
    #expect(rows["privacy-policy"] == .open(site.appending(path: "privacy")))
    #expect(rows["report-ad"] == .reportAd)
    #expect(rows["how-it-works"] == .page(.howItWorks))
    #expect(rows["credits"] == .page(.credits))
    #expect(rows["terms"] == .open(site.appending(path: "terms")))
    #expect(rows["contact-us"] == .mail(.contactUs()))
    #expect(rows["support"] == .open(site.appending(path: "support")))
    #expect(rows.count == 10)
    #expect(Constants.Site.privacy == "https://willitsnow.today/privacy")
  }

  @Test("bought: the thanks and Restore purchase, and no Report an ad, as there are no ads")
  func unlocked() throws {
    let screen = SettingsScreen(
      units: .c, unlocked: true, privacyChoices: false, purchase: forSale, version: version)
    #expect(screen.sections.map(\.id) == ["upgrade", "privacy", "about", "help"])
    #expect(!screen.sections.flatMap(\.rows).contains { $0.action == .reportAd })
    #expect(
      try upgradeRows(screen) == [
        "thanks, Thank you. Ads are off and widgets are on.", "restore, Restore purchase",
      ])
    let upgrade = try #require(screen.sections.first).rows
    #expect(upgrade.map(\.action) == [.note, .restore])
    #expect(upgrade.map(\.icon) == [.thanks, .restore])
    // Bought whatever StoreKit says of the product: no price, no way to buy it again.
    for product in products {
      let other = SettingsScreen(
        units: .c, unlocked: true, privacyChoices: false, purchase: .init(product: product),
        version: version)
      #expect(try upgradeRows(other) == upgradeRows(screen), "\(product)")
    }
  }

  @Test("free with no price yet, none for sale or payments off: the way in, without a price")
  func aWayInWithoutAPrice() throws {
    for product in [PurchaseState.Product.loading, .unavailable, .blocked] {
      let screen = SettingsScreen(
        units: .c, unlocked: false, privacyChoices: false, purchase: .init(product: product),
        version: version)
      #expect(
        try upgradeRows(screen) == [
          "upgrade, Remove ads and add widgets", "restore, Restore purchase",
        ],
        "\(product)")
      let row = try #require(screen.sections.first?.rows.first)
      #expect(!row.title.contains("·"))
      #expect(!row.title.contains("£"))
      #expect(row.action == .page(.upgrade))
      #expect(row.icon == .upgrade)
    }
  }

  @Test("Restore purchase says its result beneath it, and takes no tap while restoring")
  func restoreSaysItsResult() throws {
    func row(_ restore: PurchaseState.Restore) throws -> SettingsScreen.Row {
      let screen = SettingsScreen(
        units: .c, unlocked: false, privacyChoices: false,
        purchase: .init(product: forSale.product, restore: restore), version: version)
      return try #require(screen.sections.flatMap(\.rows).first { $0.id == "restore" })
    }
    #expect(try row(.restored).detail == AppCopy.restored)
    #expect(try !row(.restored).busy)
    #expect(try row(.restoring).busy)
    #expect(try row(.restoring).detail == nil)
    #expect(try row(.nothingFound).detail == AppCopy.nothingToRestore)
    #expect(try row(.failed("x")).detail == "x")
    #expect(try row(.failed("")).detail == nil)
    #expect(try row(.idle).detail == nil)
    #expect(try !row(.idle).busy)
  }

  @Test("Privacy choices only while the ads are on and Google's form is required")
  func privacyChoices() throws {
    let shown = SettingsScreen(
      units: .c, unlocked: false, privacyChoices: true, purchase: forSale, version: version)
    let privacy = try #require(shown.sections.first { $0.id == "privacy" })
    #expect(privacy.rows.map(\.title) == ["Privacy choices", "Your privacy", "Privacy policy"])
    #expect(privacy.rows[0].action == .privacyChoices)
    #expect(privacy.rows[0].id == "privacy-choices")
    let hidden = SettingsScreen(
      units: .c, unlocked: false, privacyChoices: false, purchase: forSale, version: version)
    #expect(!hidden.sections.flatMap(\.rows).contains { $0.action == .privacyChoices })
  }

  @Test("each row has its own icon, the one for what it opens, and the units row has the ruler's")
  func icons() throws {
    let screen = SettingsScreen(
      units: .c, unlocked: false, privacyChoices: true, purchase: forSale, version: version)
    let bought = SettingsScreen(
      units: .c, unlocked: true, privacyChoices: false, purchase: forSale, version: version)
    let rows = screen.sections.flatMap(\.rows)
    let thanks = try #require(bought.sections.flatMap(\.rows).first { $0.id == "thanks" })
    #expect(
      rows.map { "\($0.id) \($0.icon)" } == [
        "upgrade upgrade", "restore restore",
        "privacy-choices privacyChoices", "your-privacy yourPrivacy", "privacy-policy policy",
        "report-ad reportAd", "how-it-works howItWorks", "credits credits", "terms terms",
        "contact-us contactUs", "support support",
      ])
    #expect(screen.units.icon == .units)
    // Every icon is some row's, and no two rows share one, so each row reads apart at a glance:
    // the free screen's, and the thanks that takes the upgrade row's place once bought. The rest
    // are the notifications' own (`notificationIcons`).
    let shown = [screen.units.icon] + rows.map(\.icon) + [thanks.icon]
    #expect(Set(shown).count == shown.count)
    #expect(Set(shown) == Set(SettingsScreen.Icon.allCases).subtracting(notificationIcons))
    // The other versions drop rows, never change an icon.
    let known = rows + [thanks]
    for unlocked in [false, true] {
      for choices in [false, true] {
        for product in products {
          let other = SettingsScreen(
            units: nil, unlocked: unlocked, privacyChoices: choices,
            purchase: .init(product: product), version: nil)
          for row in other.sections.flatMap(\.rows) {
            #expect(known.first { $0.id == row.id }?.icon == row.icon, "\(row.id)")
          }
        }
      }
    }
    // Your privacy's button to the policy is the same kind of row as Settings'.
    #expect(try #require(YourPrivacy(adsOn: true, privacyChoices: false).policy).icon == .policy)
  }

  @Test("the notifications' icons are their section's and page's, none a Settings row's")
  func notificationsOwnIcons() throws {
    let denied = NotificationsState(
      settings: AlertSettings(prefs: AlertPrefs(evening: true)), permission: .denied,
      registration: try registration("put-here-ip"))
    func icons(_ section: NotificationSettings) -> [SettingsScreen.Icon] {
      section.items.compactMap {
        switch $0 {
        case .toggle(let row): row.icon
        case .line: nil
        case .here(let row): row.icon
        case .row(let row): row.icon
        }
      } + [section.warnings?.icon].compactMap { $0 }
    }
    func icons(_ page: NotificationPlacePage) -> [SettingsScreen.Icon] {
      [page.place.icon] + [page.useMyLocation?.icon, page.openSettings?.icon].compactMap { $0 }
    }
    let section = icons(NotificationSettings(denied))
    let asking = icons(NotificationPlacePage(NotificationsState(locationAccess: .notDetermined)))
    let refused = icons(NotificationPlacePage(NotificationsState(locationAccess: .denied)))
    #expect(
      section == [
        .openSettings, .evening, .morning, .possible, .notificationPlace, .test, .warnings,
      ])
    #expect(asking == [.notificationPlace, .myLocation])
    #expect(refused == [.notificationPlace, .openSettings])
    // Within each, no two rows share one; together they are every notification icon.
    for shown in [section, asking, refused] {
      #expect(Set(shown).count == shown.count, "\(shown)")
    }
    #expect(Set(section + asking + refused) == notificationIcons)
    #expect(notificationIcons.isSubset(of: Set(SettingsScreen.Icon.allCases)))
  }

  @Test("before the first answer chose the units, neither choice is chosen")
  func noUnits() {
    let screen = SettingsScreen(
      units: nil, unlocked: false, privacyChoices: false, purchase: forSale, version: nil)
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
    let restores: [PurchaseState.Restore] = [
      .idle, .restoring, .restored, .nothingFound, .failed("x"),
    ]
    for unlocked in [false, true] {
      for choices in [false, true] {
        for product in products {
          for restore in restores {
            let screen = SettingsScreen(
              units: .c, unlocked: unlocked, privacyChoices: choices,
              purchase: .init(product: product, restore: restore), version: version)
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
  }
}
