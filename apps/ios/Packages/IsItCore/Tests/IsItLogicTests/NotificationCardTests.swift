import Foundation
import IsItLogic
import IsItModel
import IsItTestSupport
import Testing

/// Notifications as the model has them while the screen shows where you are (or not, when
/// `showsHere` is false), in `permission`, with `prefs` on.
private func state(
  _ prefs: AlertPrefs = AlertPrefs(), permission: AlertSync.Permission = .notDetermined,
  showsHere: Bool = true
) -> NotificationsState {
  NotificationsState(
    settings: AlertSettings(prefs: prefs), permission: permission, showsHere: showsHere)
}

/// The card's buttons, as "id, title, action".
private func buttons(_ card: NotificationCard?) -> [String] {
  card?.buttons.map { "\($0.id), \($0.title), \($0.action)" } ?? []
}

/// The Today card (design 2.6), as plain values: which kind shows when, with which words and
/// buttons, and when it shows none.
@Suite("The notifications card, as plain values")
struct NotificationCardTests {
  @Test("where you are: get a notification the evening before, what is kept, Turn on or Not now")
  func offer() throws {
    let card = try #require(NotificationCard.card(state()))
    #expect(card.kind == .offer)
    #expect(card.line == "Get a notification the evening before snow is likely where you are.")
    #expect(card.line == AppCopy.cardOffer)
    #expect(
      card.kept
        == "Uses your location if you share it, otherwise a rough place from your internet "
        + "connection, which we keep while notifications are on.")
    #expect(card.kept == AppCopy.notifyHereKept)
    #expect(
      buttons(card) == ["card-turn-on, Turn on, turnOn", "card-not-now, Not now, notNow"])
    // Permission not asked yet, or allowed, shows it alike.
    for permission in [AlertSync.Permission.notDetermined, .authorized, .provisional] {
      #expect(NotificationCard.card(state(permission: permission)) == card, "\(permission)")
    }
  }

  @Test("where you are is approximate location, or the phone's point in its cell, never a choice")
  func whereYouAre() {
    guard case .coords(let leeds) = Target.device(lat: 53.8, lon: -1.55) else {
      Issue.record("Not a point")
      return
    }
    for here in [HerePlace.device(leeds), .ip] {
      #expect(NotificationCard.showsHere(.ip, here: here), "\(here)")
      #expect(!NotificationCard.showsHere(.city(slug: "leeds-gb", name: "Leeds"), here: here))
      #expect(!NotificationCard.showsHere(.city(slug: "leeds-gb"), here: here))
      #expect(
        !NotificationCard.showsHere(
          .coords(
            Target.Coordinates(
              source: .search, lat: 27.7, lon: 85.3, name: "Kathmandu", country: "NP")),
          here: here))
      // A searched place at where you are's own point is still a chosen place.
      #expect(
        !NotificationCard.showsHere(
          .coords(Target.Coordinates(source: .search, lat: 53.8, lon: -1.55, name: "Leeds")),
          here: here))
    }
    // The phone's point is where you are only in where you are's cell, named or not: an older
    // one (a recent place's, a notification's) isn't, nor any while where you are is approximate.
    let named = Target.coords(
      Target.Coordinates(source: .device, lat: 53.8, lon: -1.55, name: "Leeds"))
    #expect(NotificationCard.showsHere(.device(lat: 53.8, lon: -1.55), here: .device(leeds)))
    #expect(NotificationCard.showsHere(named, here: .device(leeds)))
    #expect(!NotificationCard.showsHere(.device(lat: 53.9, lon: -1.55), here: .device(leeds)))
    #expect(!NotificationCard.showsHere(.device(lat: 53.8, lon: -1.55), here: .ip))
    #expect(!NotificationCard.showsHere(named, here: .ip))
  }

  @Test("on a saved or searched place's page: no card, whatever it would say")
  func onlyWhereYouAre() {
    var states = [state(showsHere: false), state(permission: .denied, showsHere: false)]
    states[1].cardRefused = true
    var on = state(AlertPrefs(evening: true), permission: .authorized, showsHere: false)
    on.cardTurnedOn = true
    states.append(on)
    for shown in states {
      #expect(NotificationCard.card(shown) == nil, "\(shown)")
      var here = shown
      here.showsHere = true
      #expect(NotificationCard.card(here) != nil, "\(here)")
    }
  }

  @Test("refused at this session's Turn on: off in Settings, Open Settings or Not now")
  func refused() throws {
    var shown = state(permission: .denied)
    shown.cardRefused = true
    let card = try #require(NotificationCard.card(shown))
    #expect(card.kind == .refused)
    #expect(card.line == "Notifications are off for this app in Settings.")
    #expect(card.kept == nil)
    #expect(
      buttons(card) == [
        "card-open-settings, Open Settings, openSettings", "card-not-now, Not now, notNow",
      ])
  }

  @Test("refused at Turn on, then allowed in iOS Settings: the offer again, not the refusal")
  func refusedThenAllowed() throws {
    for permission in [AlertSync.Permission.authorized, .provisional] {
      var shown = state(permission: permission)
      shown.cardRefused = true
      let card = try #require(NotificationCard.card(shown))
      #expect(card.kind == .offer, "\(permission)")
      #expect(card == NotificationCard.card(state()))
    }
  }

  @Test("turned on this session: Done, with no buttons, even once a switch is on and it's put away")
  func turnedOn() throws {
    var shown = NotificationsState(
      settings: AlertSettings(prefs: AlertPrefs(evening: true)), permission: .authorized,
      showsHere: true, cardDismissed: true)
    shown.cardTurnedOn = true
    let card = try #require(NotificationCard.card(shown))
    #expect(card.kind == .turnedOn(name: nil))
    #expect(
      card.line
        == "Done. You'll get a notification the evening before snow is likely where you are. You "
        + "can change this in Settings.")
    #expect(card.line == AppCopy.cardOn)
    #expect(card.kept == nil)
    #expect(card.buttons.isEmpty)
  }

  @Test("turned on, once the server has named where you are: its town")
  func turnedOnNamed() throws {
    var shown = state(AlertPrefs(evening: true), permission: .authorized)
    shown.cardTurnedOn = true
    shown.registration = try registration("put-here-ip")
    let card = try #require(NotificationCard.card(shown))
    #expect(card.kind == .turnedOn(name: "Leeds"))
    #expect(
      card.line
        == "Done. You'll get a notification the evening before snow is likely near Leeds. You can "
        + "change this in Settings.")
    #expect(card.line == AppCopy.cardOnNamed(place: "Leeds"))
    #expect(card.buttons.isEmpty)
    // The phone's cell, an hour later in Newcastle by the connection.
    shown.registration = try registration("put-here-refresh")
    #expect(try #require(NotificationCard.card(shown)).kind == .turnedOn(name: "Newcastle"))
    // An answer about the phone's location, once approximate, names no town.
    shown.registration = try registration("put-here-device")
    #expect(try #require(NotificationCard.card(shown)).kind == .turnedOn(name: nil))
    shown.here = HereState(
      place: .device(Target.Coordinates(source: .device, lat: 53.8, lon: -1.55)))
    #expect(try #require(NotificationCard.card(shown)).kind == .turnedOn(name: "Leeds"))
  }

  @Test("put away, a notification on, or refused before this session: no card")
  func noCard() {
    #expect(NotificationCard.card(NotificationsState(showsHere: true, cardDismissed: true)) == nil)
    for prefs in [AlertPrefs(evening: true), AlertPrefs(morning: true)] {
      #expect(NotificationCard.card(state(prefs, permission: .authorized)) == nil, "\(prefs)")
    }
    #expect(NotificationCard.card(state(permission: .denied)) == nil)
    // Refused this session, then put away: gone.
    var refused = NotificationsState(permission: .denied, showsHere: true, cardDismissed: true)
    refused.cardRefused = true
    #expect(NotificationCard.card(refused) == nil)
  }

  @Test("\"possible\" alone switches nothing on, so the card still offers to")
  func possibleAloneIsOff() throws {
    #expect(try #require(NotificationCard.card(state(AlertPrefs(possible: true)))).kind == .offer)
  }

  @Test("every card's words are about snow, and no two buttons share an id")
  func snowOnly() throws {
    var states = [state(), state(permission: .denied)]
    states[1].cardRefused = true
    var on = state()
    on.cardTurnedOn = true
    states.append(on)
    on.registration = try registration("put-here-ip")
    states.append(on)
    for shown in states {
      let card = try #require(NotificationCard.card(shown), "no card for \(shown)")
      for word in [card.line] + [card.kept].compactMap { $0 } + card.buttons.map(\.title) {
        #expect(otherTopic(in: word) == nil, "\(word)")
        #expect(!word.lowercased().contains("alert"), "\(word)")
        #expect(!word.contains(" here"), "\(word)")
      }
      #expect(Set(card.buttons.map(\.id)).count == card.buttons.count)
    }
  }
}
