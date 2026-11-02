import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

// The app's notifications (phase 8.1; iOS build spec, sections 12.1 and 12.2), with a fake
// server, clock, store, location and system. Each suite has a minute's limit, so a call held and
// never released fails there, not at the Linux job's limit.

/// The phone's own point in Leeds, and the next cell north.
private let phoneInLeeds = Target.device(lat: 53.8, lon: -1.55)
private let phoneFurtherNorth = Target.device(lat: 53.9, lon: -1.55)

/// Another token than the fixtures', as a new one from the system would be.
private let otherToken = String(repeating: "a1", count: 32)

/// The PUT the model makes for `settings` with `token`, as `sortedJSON` writes it.
private func put(
  _ settings: AlertSettings, token: String, units: Units = .c, env: RegistrationBody.Env = .sandbox,
  appVersion: String = "1.0 (42)"
) throws -> DeviceCall {
  let place = try #require(settings.place?.target)
  let body = try #require(
    AlertSync.body(
      token: token, env: env, place: place, units: units, prefs: settings.prefs,
      appVersion: appVersion))
  return DeviceCall(
    method: .put, path: "/api/v1/devices", body: try sortedJSON(JSONEncoder().encode(body)))
}

/// The DELETE, or the test, for `token`.
private func identity(_ method: HTTPMethod, token: String) throws -> DeviceCall {
  DeviceCall(
    method: method, path: method == .post ? "/api/v1/devices/test" : "/api/v1/devices",
    body: try sortedJSON(Data((#"{"app":"snow","token":""# + token + #""}"#).utf8)))
}

/// A day, seconds.
private let day: TimeInterval = 86_400

@MainActor
@Suite("The notifications at launch", .timeLimit(.minutes(1)))
struct NotificationsLaunchTests {
  @Test("all off, the start reads the permission and does nothing more")
  func offStaysQuiet() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.platform.calls == ["permission"])
    #expect(h.transport.requests.isEmpty)
    #expect(h.model.state.permission == .authorized)
    #expect(h.model.state.status == .ok)
  }

  @Test("on, the start registers, and the token brings the PUT, which alertSync.v1 keeps")
  func launchRegistersWhileOn() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, replies: [try deviceReply("put-leeds")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.platform.calls == ["permission", "register"])
    #expect(h.transport.requests.isEmpty)
    let token = try fixtureToken()
    h.model.tokenArrived(token)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: token)])
    #expect(try h.requests.first?.body == deviceSentJSON("put-leeds"))
    let kept = try registration(at: now)
    #expect(h.store.loadRegistration() == kept)
    #expect(h.model.state.registration == kept)
    #expect(kept.fingerprint == AlertSync.fingerprint(try sentBody("put-leeds")))
    #expect(kept.token == token)
    #expect(kept.env == .sandbox)
    #expect(kept.units == .c)
    #expect(h.model.state.status == .ok)
  }

  @Test("no token yet is a resting state, and every return registers again")
  func noTokenIsRest() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), settings: eveningInLeeds)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    #expect(h.model.state.status == .ok)
    #expect(h.platform.registers == 1)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.platform.registers == 2)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("before the start, a return does nothing")
  func nothingBeforeTheStart() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), settings: eveningInLeeds)
    await h.model.becameActive()
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    #expect(h.platform.calls.isEmpty)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("the same registration is sent again after 7 days, not after 6")
  func heartbeat() async throws {
    let now = try devicesMoment()
    for (days, puts) in [(7.0, 1), (6.0, 0)] {
      let h = NotificationsHarness(
        now: now, settings: eveningInLeeds,
        registration: try registration(at: now.addingTimeInterval(-days * day)),
        replies: [try deviceReply("put-leeds")])
      h.model.tokenArrived(try fixtureToken())
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.synced()
      #expect(try h.requests.count == puts, "\(days) days")
    }
  }

  @Test("a new token is simply sent: the old one's record isn't deleted")
  func aNewTokenIsPutWithoutDeletingTheOld() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("put-leeds")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: otherToken)])
    #expect(h.store.loadRegistration()?.token == otherToken)
  }

  @Test("denied at the start: every switch off, the record deleted with the token kept")
  func deniedAtLaunchDeletes() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      permission: .denied, replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.store.loadSettings().prefs == AlertPrefs())
    #expect(h.store.loadSettings().place == eveningInLeeds.place)
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.store.loadRegistration() == nil)
    #expect(h.model.state.registration == nil)
    #expect(h.platform.registers == 0)
    #expect(h.model.state.permission == .denied)
  }

  @Test("never asked, yet on or registered (another phone's backup): forgotten here only")
  func notDeterminedForgetsOnThePhoneOnly() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      permission: .notDetermined, replies: [try deviceReply("delete")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.store.loadSettings().prefs == AlertPrefs())
    #expect(h.store.loadRegistration() == nil)
    #expect(h.model.state.registration == nil)
    #expect(h.transport.requests.isEmpty)
    #expect(h.platform.calls == ["permission"])
    // A registration kept with every switch off is forgotten the same way.
    let off = NotificationsHarness(
      now: now, registration: try registration(at: now), permission: .notDetermined,
      replies: [try deviceReply("delete")])
    off.model.screenChanged(target: leedsCity, units: .c)
    await off.model.synced()
    #expect(off.store.loadRegistration() == nil)
    #expect(off.transport.requests.isEmpty)
  }

  @Test("denied on a return: the record is deleted")
  func deniedOnReturnDeletes() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.platform.current = .denied
    await h.model.becameActive()
    await h.model.synced()
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.store.loadSettings().prefs == AlertPrefs())
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("the permission coming back turns nothing on")
  func permissionBackTurnsNothingOn() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds, permission: .denied)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.settings.prefs == AlertPrefs())
    h.platform.current = .authorized
    await h.model.becameActive()
    await h.model.refreshPermission()
    await h.model.synced()
    #expect(h.model.state.permission == .authorized)
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.platform.registers == 0)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("Settings appearing reads the permission again and acts on it")
  func refreshPermission() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    h.platform.current = .denied
    await h.model.refreshPermission()
    await h.model.synced()
    #expect(h.model.state.permission == .denied)
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.platform.reads == 2)
  }

  @Test("a token that comes while the start reads the permission waits for it")
  func aTokenDuringTheStartWaitsForThePermission() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      permission: .notDetermined, replies: [try deviceReply("put-leeds")])
    h.platform.hold(.permission, number: 1)
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.platform.reads == 1 }, "the start never read the permission")
    h.model.tokenArrived(otherToken)
    h.model.screenChanged(target: leedsCity, units: .f)
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.isEmpty)
    h.platform.release(.permission, number: 1)
    await h.model.synced()
    // Another phone's backup: forgotten here, and nothing was sent with this phone's token.
    #expect(h.transport.requests.isEmpty)
    #expect(h.store.loadRegistration() == nil)
    #expect(h.platform.reads == 1)
  }

  @Test("a change of place or units while the start reads the permission is the one sent")
  func aChangeDuringTheStartIsSent() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds, replies: [try deviceReply("put-leeds")])
    h.platform.hold(.permission, number: 1)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.platform.reads == 1 }, "the start never read the permission")
    h.model.screenChanged(target: leedsCity, units: .f)
    h.platform.release(.permission, number: 1)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken(), units: .f)])
    #expect(h.platform.reads == 1)
  }

  @Test("the registration carries the environment and the version it is given")
  func theBodyCarriesEnvAndVersion() async throws {
    let token = try fixtureToken()
    for (env, version) in [(RegistrationBody.Env.sandbox, "1.0 (42)"), (.production, "1.2 (7)")] {
      let h = NotificationsHarness(
        now: try devicesMoment(), settings: eveningInLeeds,
        replies: [try deviceReply("put-leeds")], env: env, appVersion: version)
      h.model.tokenArrived(token)
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.synced()
      #expect(
        try h.requests
          == [try put(eveningInLeeds, token: token, env: env, appVersion: version)])
      #expect(h.store.loadRegistration()?.env == env)
    }
  }
}

@MainActor
@Suite("The notification switches", .timeLimit(.minutes(1)))
struct NotificationSwitchTests {
  @Test("the first switch asks, then turns on for the place on screen, and the card goes")
  func firstSwitchAsks() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined,
      replies: [try deviceReply("put-leeds")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity))
    #expect(h.platform.calls == ["permission", "request", "permission", "register"])
    #expect(h.model.state.settings == eveningInLeeds)
    #expect(h.store.loadSettings() == eveningInLeeds)
    #expect(h.model.state.permission == .authorized)
    #expect(h.model.state.cardDismissed)
    #expect(h.store.loadCardDismissed())
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken())])
  }

  @Test("allowed already, the first switch asks nothing")
  func firstSwitchAllowed() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.morning, on: true, onScreen: onScreen(leedsCity))
    #expect(h.platform.requests == 0)
    #expect(h.model.state.settings.prefs == AlertPrefs(morning: true))
    #expect(h.platform.registers == 1)
  }

  @Test("the prompt refused: every switch stays off, and the denied line shows")
  func firstSwitchRefused() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity))
    #expect(h.platform.requests == 1)
    #expect(h.model.state.settings == AlertSettings())
    #expect(h.store.loadSettings() == AlertSettings())
    #expect(h.model.state.permission == .denied)
    #expect(h.platform.registers == 0)
    #expect(!h.model.state.cardDismissed)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("denied in iOS Settings, a switch asks (at once) and stays off")
  func firstSwitchDenied() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .denied)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity))
    #expect(h.platform.requests == 1)
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.model.state.permission == .denied)
  }

  @Test("the phone's own place on screen: the notifications follow the phone")
  func firstSwitchOnThePhonesPlaceFollows() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.screenChanged(target: phoneInLeeds, units: .c)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(phoneInLeeds))
    #expect(h.model.state.settings.place == .follows(phoneInLeeds))
    #expect(h.store.loadSettings().place == .follows(phoneInLeeds))
  }

  @Test("on approximate location, with no place kept, a switch does nothing: the gate shows")
  func firstSwitchAtApproximateDoesNothing() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(.ip))
    #expect(h.platform.calls == ["permission"])
    #expect(h.model.state.settings == AlertSettings())
    #expect(h.store.loadSettings() == AlertSettings())
  }

  @Test("a place already kept is the one turned on, whatever is on screen")
  func aKeptPlaceIsTurnedOn() async throws {
    let kept = AlertSettings(place: .chosen(leedsCity, name: "Leeds"))
    let h = NotificationsHarness(now: try devicesMoment(), settings: kept)
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(.ip))
    #expect(h.model.state.settings == eveningInLeeds)
  }

  @Test("possible goes off with the second of the others, and the record is deleted")
  func possibleGoesWithTheOthers() async throws {
    let now = try devicesMoment()
    let both = AlertSettings(
      prefs: AlertPrefs(evening: true, possible: true), place: .chosen(leedsCity, name: "Leeds"))
    let h = NotificationsHarness(
      now: now, settings: both, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.setSwitch(.evening, on: false, onScreen: onScreen(leedsCity))
    await h.model.synced()
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.store.loadSettings().prefs == AlertPrefs())
    #expect(h.store.loadSettings().place == both.place)
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.model.state.registration == nil)
  }

  @Test("possible alone can't be turned on, and asks nothing")
  func possibleAloneStaysOff() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.possible, on: true, onScreen: onScreen(leedsCity))
    await h.model.synced()
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.platform.requests == 0)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("a second switch, or possible, changes the registration")
  func moreSwitches() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.setSwitch(.possible, on: true, onScreen: onScreen(leedsCity))
    await h.model.synced()
    var settings = eveningInLeeds
    settings.prefs.possible = true
    #expect(h.store.loadSettings() == settings)
    #expect(try h.requests == [try put(settings, token: fixtureToken())])
    #expect(h.platform.requests == 0)
  }

  @Test("two taps on the first switch, while its prompt is out, ask once")
  func twoTapsAskOnce() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    h.platform.hold(.request, number: 1)
    let first = Task { await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity)) }
    #expect(await yieldUntil { h.platform.requests == 1 }, "the prompt never showed")
    let second = Task {
      await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity))
    }
    for _ in 0..<100 { await Task.yield() }
    h.platform.release(.request, number: 1)
    await first.value
    await second.value
    #expect(h.platform.requests == 1)
    #expect(h.platform.registers == 1)
    #expect(h.model.state.settings == eveningInLeeds)
  }
}

@MainActor
@Suite("The notification place", .timeLimit(.minutes(1)))
struct NotificationPlaceTests {
  @Test("a chosen place never follows browsing")
  func aChosenPlaceNeverFollowsBrowsing() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now))
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.screenChanged(target: durham, units: .c)
    h.model.screenChanged(target: phoneFurtherNorth, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    #expect(h.store.loadSettings() == eveningInLeeds)
  }

  @Test("a place that follows the phone moves with the phone's place on screen")
  func aFollowedPlaceFollowsTheScreen() async throws {
    let now = try devicesMoment()
    let following = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneInLeeds))
    let h = NotificationsHarness(
      now: now, settings: following, registration: try registration("put-device", at: now),
      replies: [try deviceReply("put-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: phoneInLeeds, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    // A city chosen on screen is browsing: it moves nothing.
    h.model.screenChanged(target: durham, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.model.screenChanged(target: phoneFurtherNorth, units: .c)
    await h.model.synced()
    let moved = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneFurtherNorth))
    #expect(h.store.loadSettings() == moved)
    #expect(try h.requests == [try put(moved, token: fixtureToken())])
    // The phone's place on screen showing the start's own cell takes no fix of its own.
    #expect(h.location.calls.isEmpty)
  }

  @Test("a followed place takes its own fix with location allowed, and never asks for it")
  func aFollowedPlaceTakesItsOwnFix() async throws {
    let now = try devicesMoment()
    let following = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneInLeeds))
    let location = FakeLocation(access: .denied, fixes: [located(phoneFurtherNorth)])
    let h = NotificationsHarness(
      now: now, settings: following, registration: try registration("put-device", at: now),
      location: location, replies: [try deviceReply("put-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(location.calls == ["access"])
    #expect(h.transport.requests.isEmpty)
    location.change(access: .granted)
    await h.model.becameActive()
    await h.model.synced()
    let moved = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneFurtherNorth))
    #expect(location.calls == ["access", "access", "fix"])
    #expect(h.store.loadSettings() == moved)
    #expect(try h.requests == [try put(moved, token: fixtureToken())])
    // Never asked: location not yet decided is no fix, and no prompt.
    location.change(access: .notDetermined)
    await h.model.becameActive()
    #expect(location.calls == ["access", "access", "fix", "access"])
  }

  @Test("the start's own fix, with a city on screen, moves the followed place")
  func theStartsOwnFix() async throws {
    let following = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneInLeeds))
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: following,
      location: FakeLocation(fixes: [located(phoneFurtherNorth)]),
      replies: [try deviceReply("put-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    let moved = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneFurtherNorth))
    #expect(try h.requests == [try put(moved, token: fixtureToken())])
  }

  @Test("a fix that lands after a place was chosen changes nothing")
  func aLateFixMovesNothing() async throws {
    let following = AlertSettings(prefs: AlertPrefs(evening: true), place: .follows(phoneInLeeds))
    let location = FakeLocation(fixes: [located(phoneFurtherNorth)])
    location.holdFix(1)
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: following, location: location,
      replies: [try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { location.calls.contains("fix") }, "the start never took a fix")
    await h.model.choosePlace(.onScreen(leedsCity, name: "Leeds"))
    location.releaseFix(1)
    await h.model.synced()
    #expect(h.store.loadSettings() == eveningInLeeds)
    #expect(try h.requests.last == put(eveningInLeeds, token: fixtureToken()))
    #expect(try h.requests.allSatisfy { $0 == (try put(eveningInLeeds, token: fixtureToken())) })
  }

  @Test("a change of units is sent")
  func unitsSync() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.model.screenChanged(target: leedsCity, units: .f)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken(), units: .f)])
    #expect(h.store.loadRegistration()?.units == .f)
  }

  @Test("with no units known yet and none registered, the PUT waits for them")
  func noUnitsWaits() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds, replies: [try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: nil)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken())])
  }

  @Test("units not known at the start come with the first switch, in Settings or on the card")
  func unitsComeWithTheFirstSwitch() async throws {
    for card in [false, true] {
      let h = NotificationsHarness(
        now: try devicesMoment(), replies: [try deviceReply("put-leeds")])
      // An offline first launch: step 6 had no answer's units to give.
      h.model.screenChanged(target: leedsCity, units: nil)
      await h.model.synced()
      if card {
        await h.model.turnOnFromCard(onScreen: onScreen(leedsCity, units: .c))
      } else {
        await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity, units: .c))
      }
      h.model.tokenArrived(try fixtureToken())
      await h.model.synced()
      #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken())], "card \(card)")
      #expect(h.model.state.registration != nil, "card \(card)")
    }
  }

  @Test("the registration's units stand in for units not known yet")
  func registeredUnitsStand() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now.addingTimeInterval(8 * day), settings: eveningInLeeds,
      registration: try registration(at: now), replies: [try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: nil)
    await h.model.synced()
    #expect(try h.requests == [try put(eveningInLeeds, token: fixtureToken())])
  }

  @Test("Use my location asks for location only then, and follows the phone")
  func myLocationAsksOnlyThen() async throws {
    let location = FakeLocation(access: .notDetermined, fixes: [located(phoneInLeeds)])
    location.holdFix(1)
    let h = NotificationsHarness(now: try devicesMoment(), location: location)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(location.calls.isEmpty)
    let choosing = Task { await h.model.choosePlace(.myLocation) }
    #expect(await yieldUntil { location.calls.contains("fix") }, "no fix was asked for")
    #expect(h.model.state.locating)
    location.releaseFix(1)
    await choosing.value
    #expect(!h.model.state.locating)
    #expect(location.calls == ["access", "request", "fix"])
    #expect(h.model.state.settings.place == .follows(phoneInLeeds))
    #expect(h.store.loadSettings().place == .follows(phoneInLeeds))
    #expect(h.model.state.placeProblem == nil)
  }

  @Test("Use my location denied, or with no fix, says so; a later success clears it")
  func myLocationProblems() async throws {
    let location = FakeLocation(access: .denied)
    let h = NotificationsHarness(now: try devicesMoment(), location: location)
    await h.model.choosePlace(.myLocation)
    #expect(h.model.state.placeProblem == .locationDenied)
    #expect(location.calls == ["access"])
    #expect(!h.model.state.locating)
    location.change(access: .granted, fixes: [.unavailable])
    await h.model.choosePlace(.myLocation)
    #expect(h.model.state.placeProblem == .locationUnavailable)
    location.change(access: .granted, fixes: [.denied])
    await h.model.choosePlace(.myLocation)
    #expect(h.model.state.placeProblem == .locationDenied)
    #expect(h.model.state.settings.place == nil)
    location.change(access: .granted, fixes: [located(phoneFurtherNorth)])
    await h.model.choosePlace(.myLocation)
    #expect(h.model.state.placeProblem == nil)
    #expect(h.model.state.settings.place == .follows(phoneFurtherNorth))
    // The prompt refused at the tap.
    let refused = NotificationsHarness(
      now: try devicesMoment(), location: FakeLocation(access: .notDetermined, answer: .denied))
    await refused.model.choosePlace(.myLocation)
    #expect(refused.model.state.placeProblem == .locationDenied)
  }

  @Test("the place on screen chosen, and the kept one kept")
  func choosingThePlaceOnScreen() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("put-durham")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: durham, units: .c)
    await h.model.synced()
    await h.model.choosePlace(.kept)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.choosePlace(.onScreen(durham, name: "Durham"))
    await h.model.synced()
    let inDurham = AlertSettings(
      prefs: AlertPrefs(evening: true), place: .chosen(durham, name: "Durham"))
    #expect(h.store.loadSettings() == inDurham)
    #expect(try h.requests == [try put(inDurham, token: fixtureToken())])
    #expect(try h.requests.first?.body == deviceSentJSON("put-durham"))
  }

  @Test("a place the server refuses: its words in the status line, the registration as it was")
  func aPlaceTheServerRefuses() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("put-bad-place")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    let nowhere = Target.city(slug: "nowhere-xx", name: "Nowhere")
    await h.model.choosePlace(.onScreen(nowhere, name: "Nowhere"))
    await h.model.synced()
    #expect(try h.requests.first?.body == deviceSentJSON("put-bad-place"))
    #expect(h.model.state.status == .placeRefused("There is no page for that place."))
    #expect(h.store.loadRegistration() == (try registration(at: now)))
  }
}

@MainActor
@Suite("Keeping the server's record", .timeLimit(.minutes(1)))
struct NotificationSyncTests {
  @Test("a 429 is tried again once, at Retry-After, or a minute without a usable one")
  func aRetryAtRetryAfter() async throws {
    let now = try devicesMoment()
    let replies: [(FakeTransport.Reply, TimeInterval)] = [
      (try deviceReply("put-twice"), 50),
      (try deviceReply("rate-limited"), 60),
      (.answer(HTTPResponse(status: 429, body: Data())), 60),
    ]
    for (reply, wait) in replies {
      let h = NotificationsHarness(
        now: now, settings: eveningInLeeds, replies: [reply, try deviceReply("put-leeds")])
      h.model.tokenArrived(try fixtureToken())
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.synced()
      #expect(h.clock.pending == [now.addingTimeInterval(wait)], "\(wait)")
      #expect(h.model.state.status == .ok)
      #expect(h.model.state.registration == nil)
      #expect(await h.clock.runNext())
      await h.model.synced()
      #expect(try h.requests.count == 2)
      #expect(h.model.state.registration?.response == (try deviceResponse("put-leeds")))
      #expect(h.clock.pending.isEmpty)
    }
  }

  @Test("a change while a retry waits is sent at once, and the retry goes")
  func aChangeCancelsTheRetry() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds,
      replies: [try deviceReply("put-twice"), try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.clock.pending.count == 1)
    await h.model.setSwitch(.morning, on: true, onScreen: onScreen(leedsCity))
    await h.model.synced()
    #expect(h.clock.pending.isEmpty)
    #expect(try h.requests.count == 2)
    #expect(h.model.state.registration != nil)
  }

  @Test("changes while a PUT is out are sent together, once it is answered")
  func syncsCoalesce() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds,
      replies: [try deviceReply("put-leeds"), try deviceReply("put-leeds")])
    h.transport.hold(1)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.transport.requests.count == 1 }, "the PUT was never sent")
    await h.model.setSwitch(.morning, on: true, onScreen: onScreen(leedsCity))
    await h.model.setSwitch(.possible, on: true, onScreen: onScreen(leedsCity))
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.count == 1)
    h.transport.release(1)
    await h.model.synced()
    var all = eveningInLeeds
    all.prefs = AlertPrefs(evening: true, morning: true, possible: true)
    #expect(
      try h.requests == [
        try put(eveningInLeeds, token: fixtureToken()), try put(all, token: fixtureToken()),
      ])
    let body = try #require(
      AlertSync.body(
        token: fixtureToken(), env: .sandbox, place: leedsCity, units: .c, prefs: all.prefs,
        appVersion: "1.0 (42)"))
    #expect(h.store.loadRegistration()?.fingerprint == AlertSync.fingerprint(body))
  }

  @Test("offline, a change isn't saved, and says so; online on the next return, it is")
  func offlineNotSaved() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds,
      replies: [.failure(.notConnectedToInternet)])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.status == .notSaved)
    #expect(h.clock.pending.isEmpty)
    h.transport.replyNext([try deviceReply("put-leeds")])
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.status == .ok)
    #expect(h.store.loadRegistration() != nil)
    #expect(try h.requests.count == 2)
  }

  @Test("a heartbeat that fails says nothing")
  func aFailedHeartbeatSaysNothing() async throws {
    let now = try devicesMoment()
    let kept = try registration(at: now.addingTimeInterval(-8 * day))
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: kept,
      replies: [.failure(.timedOut)])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests.count == 1)
    #expect(h.model.state.status == .ok)
    #expect(h.store.loadRegistration() == kept)
    // A 500 is the same.
    h.transport.replyNext([.answer(HTTPResponse(status: 500, body: Data()))])
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.status == .ok)
  }

  @Test("a DELETE that fails isn't saved, and says so")
  func aFailedDeleteIsNotSaved() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: false, onScreen: onScreen(leedsCity))
    await h.model.synced()
    #expect(h.model.state.status == .notSaved)
    #expect(h.store.loadRegistration() != nil)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.status == .ok)
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("the DELETE names the record by the token last sent, not a newer one the server lacks")
  func aDeleteUsesTheTokenLastSent() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    // The new token's PUT didn't reach the server, so its record is still the old token's.
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.setSwitch(.evening, on: false, onScreen: onScreen(leedsCity))
    await h.model.synced()
    #expect(
      try h.requests == [
        try put(eveningInLeeds, token: otherToken), try identity(.delete, token: fixtureToken()),
      ])
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("a PUT answered 204 forgets the registration")
  func aPutAnswered204Forgets() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.tokenArrived(otherToken)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests.first?.method == .put)
    #expect(h.store.loadRegistration() == nil)
    #expect(h.model.state.status == .ok)
  }

  @Test("the registration's zone by its place's key, for the router")
  func zones() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(now: now, registration: try registration(at: now))
    #expect(h.model.zones == ["city:leeds-gb": "Europe/London"])
    let kathmandu = NotificationsHarness(
      now: now, registration: try registration("put-kathmandu", at: now))
    #expect(kathmandu.model.zones == ["search:27.7,85.3": "Asia/Kathmandu"])
    #expect(NotificationsHarness(now: now).model.zones.isEmpty)
  }
}

@MainActor
@Suite("The test notification", .timeLimit(.minutes(1)))
struct NotificationTestSendTests {
  @Test("each of the server's answers to a test shows as its own result")
  func testOutcomes() async throws {
    let now = try devicesMoment()
    let outcomes: [(String, AlertSync.TestOutcome)] = [
      ("test-sent", .sent), ("test-dryrun", .dryRun), ("test-limited", .limited),
      ("test-quiet", .quiet), ("test-unregistered", .notRegistered), ("test-down", .failed),
      ("rate-limited", .failed),
    ]
    for (name, outcome) in outcomes {
      let h = NotificationsHarness(
        now: now, settings: eveningInLeeds, registration: try registration(at: now),
        replies: [try deviceReply(name)])
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.sendTest()
      #expect(h.model.state.test == .done(outcome), "\(name)")
      #expect(try h.requests.first == identity(.post, token: fixtureToken()), "\(name)")
    }
  }

  @Test("a test names the record by the token last sent, not a newer one the server lacks")
  func aTestUsesTheTokenLastSent() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("test-sent")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.sent))
    #expect(
      try h.requests == [
        try put(eveningInLeeds, token: otherToken), try identity(.post, token: fixtureToken()),
      ])
  }

  @Test("a test Apple refuses forgets the registration, which is sent again")
  func aGoneTestRegistersAgain() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("test-gone"), try deviceReply("put-leeds")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.notRegistered))
    await h.model.synced()
    #expect(
      try h.requests == [
        try identity(.post, token: fixtureToken()), try put(eveningInLeeds, token: fixtureToken()),
      ])
    #expect(h.store.loadRegistration() != nil)
  }

  @Test("without a registration, the test syncs first; with no token, it fails, asking nothing")
  func aTestWithoutARegistrationSyncsFirst() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds,
      replies: [
        .failure(.notConnectedToInternet), try deviceReply("put-leeds"),
        try deviceReply("test-sent"),
      ])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.registration == nil)
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.sent))
    #expect(try h.requests.map(\.method) == [.put, .put, .post])

    let noToken = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds, replies: [try deviceReply("test-sent")])
    noToken.model.screenChanged(target: leedsCity, units: .c)
    await noToken.model.sendTest()
    #expect(noToken.model.state.test == .done(.failed))
    #expect(noToken.transport.requests.isEmpty)
  }

  @Test("a second tap while the test is out sends nothing more; it shows sending meanwhile")
  func oneTestAtATime() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("test-sent")])
    h.transport.hold(1)
    h.model.screenChanged(target: leedsCity, units: .c)
    let first = Task { await h.model.sendTest() }
    #expect(await yieldUntil { h.transport.requests.count == 1 }, "the test was never sent")
    #expect(h.model.state.test == .sending)
    await h.model.sendTest()
    #expect(h.transport.requests.count == 1)
    h.transport.release(1)
    await first.value
    #expect(h.model.state.test == .done(.sent))
    // Settings closing puts the result away.
    h.model.dismissResults()
    #expect(h.model.state.test == .idle)
  }
}

@MainActor
@Suite("The card, Your privacy and the links", .timeLimit(.minutes(1)))
struct NotificationCardAndPrivacyTests {
  @Test("Turn off notifications and delete my data, with the token last sent")
  func deleteMyDataUsesTheLastToken() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.deleteMyData()
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.model.state.delete == .done)
    #expect(h.model.state.registration == nil)
    #expect(h.store.loadRegistration() == nil)
    #expect(h.store.loadSettings() == AlertSettings())
    #expect(h.model.state.settings == AlertSettings())
    #expect(h.store.loadCardDismissed())
    h.model.dismissResults()
    #expect(h.model.state.delete == .idle)
  }

  @Test("the delete names the record by the token last sent, not a newer one the server lacks")
  func deleteMyDataWithANewerToken() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.deleteMyData()
    #expect(
      try h.requests == [
        try put(eveningInLeeds, token: otherToken), try identity(.delete, token: fixtureToken()),
      ])
    #expect(h.model.state.delete == .done)
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("offline, the delete says it will try again, and the next sync deletes")
  func deleteMyDataOffline() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.deleteMyData()
    #expect(h.model.state.delete == .notYet)
    #expect(h.store.loadSettings() == AlertSettings())
    #expect(h.store.loadRegistration() != nil)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.delete == .done)
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("deleting while a PUT is out deletes what that PUT registered")
  func deleteWhileAPutIsOut() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningInLeeds,
      replies: [try deviceReply("put-leeds"), try deviceReply("delete")])
    h.transport.hold(1)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.transport.requests.count == 1 }, "the PUT was never sent")
    let deleting = Task { await h.model.deleteMyData() }
    #expect(await yieldUntil { h.model.state.delete == .deleting })
    h.transport.release(1)
    await deleting.value
    #expect(try h.requests.map(\.method) == [.put, .delete])
    #expect(h.model.state.delete == .done)
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("the delete puts the card away, even one this session's Turn on made say it was done")
  func deleteMyDataPutsTheCardAway() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    await h.model.turnOnFromCard(onScreen: onScreen(leedsCity))
    #expect(NotificationCard.card(h.model.state, onScreen: onScreen(leedsCity))?.kind == .turnedOn)
    await h.model.deleteMyData()
    #expect(h.model.state.delete == .done)
    #expect(!h.model.state.cardTurnedOn)
    #expect(NotificationCard.card(h.model.state, onScreen: onScreen(leedsCity)) == nil)
  }

  @Test("before the start, the delete starts the model first")
  func deleteMyDataBeforeTheStart() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    await h.model.deleteMyData()
    #expect(h.platform.reads == 1)
    #expect(h.model.state.delete == .done)
  }

  @Test("Not now puts the card away for good; Turn on takes the place on screen")
  func theCard() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.dismissCard()
    #expect(h.model.state.cardDismissed)
    #expect(h.store.loadCardDismissed())

    let kept = AlertSettings(place: .chosen(leedsCity, name: "Leeds"))
    let allowed = NotificationsHarness(now: try devicesMoment(), settings: kept)
    await allowed.model.turnOnFromCard(onScreen: onScreen(durham))
    let inDurham = AlertSettings(
      prefs: AlertPrefs(evening: true), place: .chosen(durham, name: "Durham"))
    #expect(allowed.model.state.settings == inDurham)
    #expect(allowed.store.loadSettings() == inDurham)
    #expect(allowed.model.state.cardTurnedOn)
    #expect(!allowed.model.state.cardRefused)
    #expect(allowed.model.state.cardDismissed)
    #expect(allowed.store.loadCardDismissed())
    #expect(allowed.platform.registers == 1)

    let refused = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    await refused.model.turnOnFromCard(onScreen: onScreen(durham))
    #expect(refused.model.state.cardRefused)
    #expect(!refused.model.state.cardTurnedOn)
    #expect(!refused.model.state.cardDismissed)
    #expect(refused.model.state.settings == AlertSettings())

    let approximate = NotificationsHarness(now: try devicesMoment())
    await approximate.model.turnOnFromCard(onScreen: onScreen(.ip))
    #expect(approximate.model.state.settings == AlertSettings())
    #expect(!approximate.model.state.cardTurnedOn)
    #expect(!approximate.model.state.cardRefused)
  }

  @Test("the card's refusal goes once allowed in iOS Settings, and its Turn on then turns them on")
  func theRefusalGoesOnceAllowed() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    let onLeeds = onScreen(leedsCity)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.turnOnFromCard(onScreen: onLeeds)
    #expect(NotificationCard.card(h.model.state, onScreen: onLeeds)?.kind == .refused)
    // Open Settings, notifications allowed there, and back in the app.
    h.platform.current = .authorized
    await h.model.becameActive()
    #expect(NotificationCard.card(h.model.state, onScreen: onLeeds)?.kind == .chosen)
    await h.model.turnOnFromCard(onScreen: onLeeds)
    #expect(NotificationCard.card(h.model.state, onScreen: onLeeds)?.kind == .turnedOn)
    #expect(h.model.state.settings == eveningInLeeds)
    #expect(h.platform.requests == 1)
  }

  @Test("a Settings action before the launch's step 6 starts the model, once")
  func aSettingsActionBeforeTheLaunchStarts() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    await h.model.setSwitch(.evening, on: true, onScreen: onScreen(leedsCity))
    #expect(h.platform.calls == ["permission", "request", "permission", "register"])
    #expect(h.model.state.settings == eveningInLeeds)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.platform.reads == 2)
    #expect(h.platform.registers == 1)
  }

  @Test("the links' requests count up")
  func requests() {
    let h = NotificationsHarness(now: Date(epochMs: 0))
    h.model.requestSettings()
    h.model.requestSettings()
    #expect(h.model.settingsRequests == 2)
    h.model.requestPicker(locating: true)
    #expect(h.model.pickerRequests == 1)
    #expect(h.model.pickerLocating)
    h.model.requestPicker(locating: false)
    #expect(h.model.pickerRequests == 2)
    #expect(!h.model.pickerLocating)
  }

  @Test("the three keys are read at once, and nothing is asked")
  func readsTheKeys() throws {
    let now = try devicesMoment()
    let kept = try registration(at: now)
    let h = NotificationsHarness(
      now: now, settings: eveningInLeeds, registration: kept, cardDismissed: true)
    #expect(h.model.state.settings == eveningInLeeds)
    #expect(h.model.state.registration == kept)
    #expect(h.model.state.cardDismissed)
    #expect(h.model.state.permission == .notDetermined)
    #expect(h.platform.calls.isEmpty)
  }
}
