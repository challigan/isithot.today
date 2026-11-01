import Foundation
import IsItLogic
import IsItModel
import Testing

/// Leeds's page on screen, and approximate IP location named by its answer.
private let onLeeds = OnScreen(
  target: .city(slug: "leeds-gb", name: "Leeds"), name: "Leeds", country: "GB", units: .c)
private let onIP = OnScreen(target: .ip, name: "Leeds", country: "GB", units: .c)

/// The card's buttons, as "id, title, action".
private func buttons(_ card: NotificationCard?) -> [String] {
  card?.buttons.map { "\($0.id), \($0.title), \($0.action)" } ?? []
}

/// The Today card (spec 10.2, item 5), as plain values: which kind shows when, with which words
/// and buttons, and when it shows none.
@Suite("The notifications card, as plain values")
struct NotificationCardTests {
  @Test("a chosen place: get a notification the evening before, Turn on or Not now")
  func chosen() throws {
    let card = try #require(NotificationCard.card(NotificationsState(), onScreen: onLeeds))
    #expect(card.kind == .chosen)
    #expect(card.line == "Get a notification the evening before snow is likely here.")
    #expect(card.line == AppCopy.cardChosen)
    #expect(
      buttons(card) == ["card-turn-on, Turn on, turnOn", "card-not-now, Not now, notNow"])
    // Permission not asked yet, or allowed, shows it alike.
    for permission in [AlertSync.Permission.notDetermined, .authorized, .provisional] {
      let state = NotificationsState(permission: permission)
      #expect(NotificationCard.card(state, onScreen: onLeeds) == card, "\(permission)")
    }
  }

  @Test("approximate location: choose a place first, Use my location, Search or Not now")
  func approximate() throws {
    let card = try #require(NotificationCard.card(NotificationsState(), onScreen: onIP))
    #expect(card.kind == .approximate)
    #expect(card.line == AppCopy.cardApprox)
    #expect(
      buttons(card) == [
        "card-use-my-location, Use my location, useMyLocation", "card-search, Search, search",
        "card-not-now, Not now, notNow",
      ])
  }

  @Test("refused at this session's Turn on: off in Settings, Open Settings or Not now")
  func refused() throws {
    var state = NotificationsState(permission: .denied)
    state.cardRefused = true
    let card = try #require(NotificationCard.card(state, onScreen: onLeeds))
    #expect(card.kind == .refused)
    #expect(card.line == "Notifications are off for this app in Settings.")
    #expect(
      buttons(card) == [
        "card-open-settings, Open Settings, openSettings", "card-not-now, Not now, notNow",
      ])
  }

  @Test("refused at Turn on, then allowed in iOS Settings: the offer again, not the refusal")
  func refusedThenAllowed() throws {
    for permission in [AlertSync.Permission.authorized, .provisional] {
      var state = NotificationsState(permission: permission)
      state.cardRefused = true
      let card = try #require(NotificationCard.card(state, onScreen: onLeeds))
      #expect(card.kind == .chosen, "\(permission)")
      #expect(card == NotificationCard.card(NotificationsState(), onScreen: onLeeds))
      #expect(NotificationCard.card(state, onScreen: onIP)?.kind == .approximate, "\(permission)")
    }
  }

  @Test("turned on this session: Done, with no buttons, even once a switch is on and it's put away")
  func turnedOn() throws {
    var state = NotificationsState(
      settings: AlertSettings(prefs: AlertPrefs(evening: true)), permission: .authorized,
      cardDismissed: true)
    state.cardTurnedOn = true
    let card = try #require(NotificationCard.card(state, onScreen: onLeeds))
    #expect(card.kind == .turnedOn)
    #expect(
      card.line
        == "Done. You'll get a notification the evening before snow is likely here. You can "
        + "change this in Settings.")
    #expect(card.buttons.isEmpty)
  }

  @Test("put away, a notification on, or refused before this session: no card")
  func noCard() {
    let dismissed = NotificationsState(cardDismissed: true)
    #expect(NotificationCard.card(dismissed, onScreen: onLeeds) == nil)
    for prefs in [AlertPrefs(evening: true), AlertPrefs(morning: true)] {
      let on = NotificationsState(settings: AlertSettings(prefs: prefs), permission: .authorized)
      #expect(NotificationCard.card(on, onScreen: onLeeds) == nil, "\(prefs)")
    }
    let denied = NotificationsState(permission: .denied)
    #expect(NotificationCard.card(denied, onScreen: onLeeds) == nil)
    #expect(NotificationCard.card(denied, onScreen: onIP) == nil)
    // Refused this session, then put away: gone.
    var refused = NotificationsState(permission: .denied, cardDismissed: true)
    refused.cardRefused = true
    #expect(NotificationCard.card(refused, onScreen: onLeeds) == nil)
  }

  @Test("\"possible\" alone switches nothing on, so the card still offers to")
  func possibleAloneIsOff() throws {
    let state = NotificationsState(settings: AlertSettings(prefs: AlertPrefs(possible: true)))
    #expect(try #require(NotificationCard.card(state, onScreen: onLeeds)).kind == .chosen)
  }

  @Test("every card's words are about snow, and no two buttons share an id")
  func snowOnly() {
    var states: [NotificationsState] = [
      NotificationsState(), NotificationsState(permission: .denied),
    ]
    states[1].cardRefused = true
    var on = NotificationsState()
    on.cardTurnedOn = true
    states.append(on)
    for state in states {
      for screen in [onLeeds, onIP] {
        guard let card = NotificationCard.card(state, onScreen: screen) else {
          Issue.record("no card for \(state)")
          continue
        }
        for word in [card.line] + card.buttons.map(\.title) {
          #expect(otherTopic(in: word) == nil, "\(word)")
          #expect(!word.lowercased().contains("alert"), "\(word)")
        }
        #expect(Set(card.buttons.map(\.id)).count == card.buttons.count)
      }
    }
  }
}
