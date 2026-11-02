import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

// The app's notifications (phases 8.1 and 8.4a; iOS build spec, sections 12.1 and 12.2; design
// 4.6), with a fake server, clock, store, location and system. Where you are is the free place:
// the phone's cell while location access is allowed, otherwise approximate. Each suite has a
// minute's limit, so a call held and never released fails there, not at the Linux job's limit.

/// Another token than the fixtures', as a new one from the system would be.
private let otherToken = String(repeating: "a1", count: 32)

/// A searched place's point: a place on screen that is never where you are.
private let searchedLeeds = Target.coords(
  .init(source: .search, lat: 53.8, lon: -1.55, name: "Leeds"))

/// The server's words for where you are it couldn't find (put-unlocated's).
private let unlocated = NotificationsState.Status.placeRefused(
  "We couldn't tell where you are from your internet connection. Try again later, or use your "
    + "location.")

/// Where you are at the phone's point `target`.
private func here(_ target: Target) -> HerePlace {
  guard case .coords(let point) = target else { return .ip }
  return .device(point)
}

/// The PUT the model makes for `prefs` with where you are at `here`, with `token`, as
/// `sortedJSON` writes it: evening on, approximate, unless said.
private func put(
  _ prefs: AlertPrefs = AlertPrefs(evening: true), at here: HerePlace = .ip, token: String,
  units: Units = .c, env: RegistrationBody.Env = .sandbox, appVersion: String = "1.0 (42)"
) throws -> DeviceCall {
  let body = AlertSync.body(
    token: token, env: env, here: here, units: units, prefs: prefs, appVersion: appVersion)
  return DeviceCall(
    method: .put, path: "/api/v1/devices", body: try sortedJSON(JSONEncoder().encode(body)))
}

/// The DELETE, or the test, for `token`.
private func identity(_ method: HTTPMethod, token: String) throws -> DeviceCall {
  DeviceCall(
    method: method, path: method == .post ? "/api/v1/devices/test" : "/api/v1/devices",
    body: try sortedJSON(Data((#"{"app":"snow","token":""# + token + #""}"#).utf8)))
}

/// A minute and a day, seconds.
private let minute: TimeInterval = 60
private let day: TimeInterval = 86_400

@MainActor
@Suite("The notifications at launch", .timeLimit(.minutes(1)))
struct NotificationsLaunchTests {
  @Test("all off, the start reads the permission and location access, and asks for neither")
  func offStaysQuiet() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.platform.calls == ["permission"])
    #expect(h.location.calls == ["access", "fix"])
    #expect(h.transport.requests.isEmpty)
    #expect(h.model.state.permission == .authorized)
    #expect(h.model.state.locationAccess == .granted)
    #expect(h.model.state.status == .ok)
  }

  @Test("on, the start registers, and the token brings the PUT, which alertSync.v2 keeps")
  func launchRegistersWhileOn() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, replies: [try deviceReply("put-here-ip")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.platform.calls == ["permission", "register"])
    #expect(h.transport.requests.isEmpty)
    let token = try fixtureToken()
    h.model.tokenArrived(token)
    await h.model.synced()
    #expect(try h.requests == [try put(token: token)])
    #expect(try h.requests.first?.body == deviceSentJSON("put-here-ip"))
    let kept = try registration(at: now)
    #expect(h.store.loadRegistration() == kept)
    #expect(h.model.state.registration == kept)
    #expect(kept.fingerprint == AlertSync.fingerprint(try sentBody("put-here-ip")))
    #expect(kept.token == token)
    #expect(kept.env == .sandbox)
    #expect(kept.units == .c)
    #expect(h.model.state.status == .ok)
  }

  @Test("no token yet is a resting state, and every return registers again")
  func noTokenIsRest() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), settings: eveningOn)
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
    let h = NotificationsHarness(now: try devicesMoment(), settings: eveningOn)
    await h.model.becameActive()
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    #expect(h.platform.calls.isEmpty)
    #expect(h.location.calls.isEmpty)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("the same registration is sent again after 7 days, not after 6")
  func heartbeat() async throws {
    let now = try devicesMoment()
    for (days, puts) in [(7.0, 1), (6.0, 0)] {
      // The phone's own cell, which the hourly refresh leaves alone.
      let h = NotificationsHarness(
        now: now, settings: eveningAt(phoneInLeeds),
        registration: try registration(
          "put-here-device", at: now.addingTimeInterval(-days * day)),
        location: FakeLocation(fixes: [located(phoneInLeeds)]),
        replies: [try deviceReply("put-here-device")])
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
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("put-here-ip")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(try h.requests == [try put(token: otherToken)])
    #expect(h.store.loadRegistration()?.token == otherToken)
  }

  @Test("denied at the start: every switch off, the record deleted with the token kept")
  func deniedAtLaunchDeletes() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now), permission: .denied,
      location: FakeLocation(fixes: [located(phoneInLeeds)]), replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.store.loadSettings().prefs == AlertPrefs())
    // The phone's cell stays while location access is allowed: it is no notification's.
    #expect(h.store.loadSettings().here == cell(phoneInLeeds))
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
      now: now, settings: eveningOn, registration: try registration(at: now),
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
      now: now, settings: eveningOn, registration: try registration(at: now),
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
      now: try devicesMoment(), settings: eveningOn, permission: .denied)
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

  @Test("Settings appearing reads the permission and location access again and acts on them")
  func refreshPermission() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(access: .denied)
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now), location: location,
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.locationAccess == .denied)
    h.platform.current = .denied
    location.change(access: .notDetermined)
    await h.model.refreshPermission()
    await h.model.synced()
    #expect(h.model.state.permission == .denied)
    #expect(h.model.state.locationAccess == .notDetermined)
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.platform.reads == 2)
    // Read, never asked, and no fix taken.
    #expect(location.calls == ["access", "access"])
  }

  @Test("a token that comes while the start reads the permission waits for it")
  func aTokenDuringTheStartWaitsForThePermission() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      permission: .notDetermined, replies: [try deviceReply("put-here-ip")])
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

  @Test("a change of units while the start reads the permission is the one sent")
  func aChangeDuringTheStartIsSent() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, replies: [try deviceReply("put-here-ip")])
    h.platform.hold(.permission, number: 1)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.platform.reads == 1 }, "the start never read the permission")
    h.model.screenChanged(target: leedsCity, units: .f)
    h.platform.release(.permission, number: 1)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken(), units: .f)])
    #expect(h.platform.reads == 1)
  }

  @Test("the registration carries the environment and the version it is given")
  func theBodyCarriesEnvAndVersion() async throws {
    let token = try fixtureToken()
    for (env, version) in [(RegistrationBody.Env.sandbox, "1.0 (42)"), (.production, "1.2 (7)")] {
      let h = NotificationsHarness(
        now: try devicesMoment(), settings: eveningOn,
        replies: [try deviceReply("put-here-ip")], env: env, appVersion: version)
      h.model.tokenArrived(token)
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.synced()
      #expect(try h.requests == [try put(token: token, env: env, appVersion: version)])
      #expect(h.store.loadRegistration()?.env == env)
    }
  }
}

@MainActor
@Suite("The notification switches", .timeLimit(.minutes(1)))
struct NotificationSwitchTests {
  @Test("the first switch asks, then turns on for where you are, and the card goes")
  func firstSwitchAsks() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined,
      replies: [try deviceReply("put-here-ip")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.setSwitch(.evening, on: true)
    #expect(h.platform.calls == ["permission", "request", "permission", "register"])
    #expect(h.model.state.settings == eveningOn)
    #expect(h.store.loadSettings() == eveningOn)
    #expect(h.model.state.permission == .authorized)
    #expect(h.model.state.cardDismissed)
    #expect(h.store.loadCardDismissed())
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
  }

  @Test("allowed already, the first switch asks nothing")
  func firstSwitchAllowed() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.morning, on: true)
    #expect(h.platform.requests == 0)
    #expect(h.model.state.settings.prefs == AlertPrefs(morning: true))
    #expect(h.platform.registers == 1)
  }

  @Test("the prompt refused: every switch stays off, and the denied line shows")
  func firstSwitchRefused() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: true)
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
    await h.model.setSwitch(.evening, on: true)
    #expect(h.platform.requests == 1)
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.model.state.permission == .denied)
  }

  @Test("at approximate location a switch turns on, for the server to find where you are")
  func aSwitchAtApproximateLocationRegistersIP() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined,
      location: FakeLocation(access: .denied), replies: [try deviceReply("put-here-ip")])
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.setSwitch(.evening, on: true)
    #expect(h.platform.calls == ["permission", "request", "permission", "register"])
    #expect(h.model.state.settings == eveningOn)
    #expect(h.model.state.here == HereState(place: .ip))
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
    #expect(try h.requests.first?.body == deviceSentJSON("put-here-ip"))
    #expect(h.model.state.registration?.response.here?.name == "Leeds")
    #expect(h.model.state.registration?.response.here?.follows == .ip)
    // Location was read, never asked for.
    #expect(h.location.calls == ["access"])
  }

  @Test("with location allowed, a switch registers the phone's own cell, which alerts.v2 keeps")
  func aSwitchWithLocationRegistersTheCell() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), location: FakeLocation(fixes: [located(phoneInLeeds)]),
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: phoneInLeeds, units: .c)
    await h.model.setSwitch(.evening, on: true)
    await h.model.synced()
    #expect(h.model.state.settings == eveningAt(phoneInLeeds))
    #expect(h.store.loadSettings() == eveningAt(phoneInLeeds))
    #expect(h.model.state.here == HereState(place: here(phoneInLeeds)))
    #expect(try h.requests == [try put(at: here(phoneInLeeds), token: fixtureToken())])
    #expect(try h.requests.first?.body == deviceSentJSON("put-here-device"))
    #expect(h.model.state.registration?.response.here?.follows == .device)
    // The phone's point on screen (launch step 4's) is no fix of the model's, and with no cell
    // kept it isn't where you are yet: the start takes its own fix, which finds the phone there.
    #expect(h.location.calls == ["access", "fix"])
  }

  @Test("the cell kept from an earlier launch stands for where you are until a fix comes")
  func theKeptCellStands() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: AlertSettings(here: cell(phoneInLeeds)),
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: true)
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneInLeeds), token: fixtureToken())])
    #expect(h.model.state.settings == eveningAt(phoneInLeeds))
  }

  @Test("possible goes off with the second of the others, and the record is deleted")
  func possibleGoesWithTheOthers() async throws {
    let now = try devicesMoment()
    let both = AlertSettings(prefs: AlertPrefs(evening: true, possible: true))
    let h = NotificationsHarness(
      now: now, settings: both, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.setSwitch(.evening, on: false)
    await h.model.synced()
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.store.loadSettings() == AlertSettings())
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
    #expect(h.model.state.registration == nil)
  }

  @Test("possible alone can't be turned on, and asks nothing")
  func possibleAloneStaysOff() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.possible, on: true)
    await h.model.synced()
    #expect(h.model.state.settings.prefs == AlertPrefs())
    #expect(h.platform.requests == 0)
    #expect(h.transport.requests.isEmpty)
  }

  @Test("a second switch, or possible, changes the registration")
  func moreSwitches() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.setSwitch(.possible, on: true)
    await h.model.synced()
    let prefs = AlertPrefs(evening: true, possible: true)
    #expect(h.store.loadSettings() == AlertSettings(prefs: prefs))
    #expect(try h.requests == [try put(prefs, token: fixtureToken())])
    #expect(h.platform.requests == 0)
  }

  @Test("two taps on the first switch, while its prompt is out, ask once")
  func twoTapsAskOnce() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    h.platform.hold(.request, number: 1)
    let first = Task { await h.model.setSwitch(.evening, on: true) }
    #expect(await yieldUntil { h.platform.requests == 1 }, "the prompt never showed")
    let second = Task { await h.model.setSwitch(.evening, on: true) }
    for _ in 0..<100 { await Task.yield() }
    h.platform.release(.request, number: 1)
    await first.value
    await second.value
    #expect(h.platform.requests == 1)
    #expect(h.platform.registers == 1)
    #expect(h.model.state.settings == eveningOn)
  }
}

@MainActor
@Suite("Where you are", .timeLimit(.minutes(1)))
struct NotificationHereTests {
  @Test("browsing never moves where you are: a city, a searched place, approximate on screen")
  func browsingNeverMovesWhereYouAre() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now))
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.screenChanged(target: durham, units: .c)
    h.model.screenChanged(target: searchedLeeds, units: .c)
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    #expect(h.store.loadSettings() == eveningAt(phoneInLeeds))
    #expect(h.model.state.here == HereState(place: here(phoneInLeeds)))
  }

  @Test("the phone's point on screen in another cell asks for a fix, which moves where you are")
  func followsThePhonesPointOnScreen() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now),
      location: FakeLocation(fixes: [located(phoneFurtherNorth)]),
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: phoneInLeeds, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    // The phone's point on screen in the cell kept (launch step 4 has just fixed it) is where
    // you are already: the start takes no fix of its own.
    #expect(h.location.calls == ["access"])
    #expect(h.model.state.showsHere)
    // A city chosen on screen is browsing: it moves nothing, and asks for no fix.
    h.model.screenChanged(target: durham, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    #expect(h.location.calls == ["access"])
    // The picker's "Use my location" found the phone further north: the model's own fix, which
    // agrees, moves where you are.
    h.model.screenChanged(target: phoneFurtherNorth, units: .c)
    await h.model.synced()
    #expect(h.location.calls == ["access", "access", "fix"])
    #expect(h.store.loadSettings() == eveningAt(phoneFurtherNorth))
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
    #expect(h.model.state.showsHere)
  }

  @Test("an old point of the phone's on screen (a recent place) asks for a fix, which decides")
  func anOldPhonePointOnScreenMovesNothing() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(fixes: [located(phoneInLeeds)])
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now), location: location)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    // The phone further north on an earlier trip, chosen from Recent, while the phone is still
    // in Leeds: where you are stays, and nothing is sent.
    h.model.screenChanged(target: phoneFurtherNorth, units: .c)
    await h.model.synced()
    #expect(location.calls == ["access", "fix", "access", "fix"])
    #expect(h.transport.requests.isEmpty)
    #expect(h.store.loadSettings() == eveningAt(phoneInLeeds))
    #expect(h.model.state.here == HereState(place: here(phoneInLeeds)))
    // Nor is it where you are for the card.
    #expect(!h.model.state.showsHere)
  }

  @Test("a notification's point, with no fix or no location access, never stands for a fix")
  func aRoutedPointIsNoFix() async throws {
    let now = try devicesMoment()
    // The approximate place's notification opens its town as a device point (design decision
    // 24), whatever the phone's location is.
    let routed = Target.coords(.init(source: .device, lat: 53.8, lon: -1.55, name: "Leeds"))
    // Location allowed, but no fix and no cell kept (the delete forgot it).
    let allowed = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now))
    allowed.model.tokenArrived(try fixtureToken())
    allowed.model.screenChanged(target: .ip, units: .c)
    await allowed.model.synced()
    allowed.model.screenChanged(target: routed, units: .c)
    await allowed.model.synced()
    #expect(allowed.location.calls == ["access", "fix", "access", "fix"])
    #expect(allowed.transport.requests.isEmpty)
    #expect(allowed.store.loadSettings() == eveningOn)
    #expect(allowed.model.state.here == HereState(place: .ip))
    // Location not allowed: no fix is asked for, and none stands in once it is allowed.
    let location = FakeLocation(access: .denied)
    let denied = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      location: location)
    denied.model.tokenArrived(try fixtureToken())
    denied.model.screenChanged(target: routed, units: .c)
    await denied.model.synced()
    #expect(location.calls == ["access"])
    #expect(denied.model.state.here == HereState(place: .ip))
    location.change(access: .granted, fixes: [.unavailable])
    await denied.model.becameActive()
    await denied.model.synced()
    #expect(denied.model.state.here == HereState(place: .ip))
    #expect(denied.store.loadSettings() == eveningOn)
    #expect(denied.transport.requests.isEmpty)
  }

  @Test("a fix at the start and on each return, only with location allowed, never asking")
  func aFixOnlyWithLocationAllowed() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(access: .denied, fixes: [located(phoneFurtherNorth)])
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now), location: location,
      replies: [try deviceReply("put-here-device"), try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(location.calls == ["access"])
    #expect(h.transport.requests.isEmpty)
    location.change(access: .granted)
    await h.model.becameActive()
    await h.model.synced()
    #expect(location.calls == ["access", "access", "fix"])
    #expect(h.model.state.locationAccess == .granted)
    #expect(h.store.loadSettings() == eveningAt(phoneFurtherNorth))
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
    // Never asked: location not yet decided is no fix and no prompt, and where you are is
    // approximate again.
    location.change(access: .notDetermined)
    await h.model.becameActive()
    await h.model.synced()
    #expect(location.calls == ["access", "access", "fix", "access"])
    #expect(h.model.state.here == HereState(place: .ip))
    #expect(try h.requests.last == put(token: fixtureToken()))
  }

  @Test("location access taken back: where you are goes approximate, and the cell kept goes")
  func accessTakenBackGoesApproximate() async throws {
    let location = FakeLocation(fixes: [located(phoneInLeeds)])
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, location: location,
      replies: [try deviceReply("put-here-device"), try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.store.loadSettings() == eveningAt(phoneInLeeds))
    #expect(h.model.state.registration?.response.here?.follows == .device)
    location.change(access: .denied)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.locationAccess == .denied)
    #expect(h.model.state.here == HereState(place: .ip))
    #expect(h.store.loadSettings() == eveningOn)
    #expect(
      try h.requests == [
        try put(at: here(phoneInLeeds), token: fixtureToken()), try put(token: fixtureToken()),
      ])
    #expect(try h.requests.last?.body == deviceSentJSON("put-here-ip"))
    #expect(h.model.state.registration?.response.here?.follows == .ip)
    // Allowed again, with no fix: neither the cell nor the fix from before stands in.
    location.change(access: .granted, fixes: [.unavailable])
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.here == HereState(place: .ip))
    #expect(h.store.loadSettings() == eveningOn)
    #expect(try h.requests.count == 2)
  }

  @Test("the start's own fix, with a city on screen, moves where you are")
  func theStartsOwnFix() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningAt(phoneInLeeds),
      location: FakeLocation(fixes: [located(phoneFurtherNorth)]),
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
    #expect(h.store.loadSettings() == eveningAt(phoneFurtherNorth))
  }

  @Test("the start's sync waits for its fix, and sends the fix's cell")
  func theStartWaitsForItsFix() async throws {
    let location = FakeLocation(fixes: [located(phoneFurtherNorth)])
    location.holdFix(1)
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningAt(phoneInLeeds), location: location,
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { location.calls.contains("fix") }, "the start never took a fix")
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.isEmpty)
    location.releaseFix(1)
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
  }

  @Test("the token registering brings, while the start's fix is out, waits for it: one PUT")
  func aTokenDuringTheStartsFixWaits() async throws {
    let location = FakeLocation(fixes: [located(phoneFurtherNorth)])
    location.holdFix(1)
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningAt(phoneInLeeds), location: location,
      replies: [try deviceReply("put-here-device")])
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { location.calls.contains("fix") }, "the start never took a fix")
    #expect(h.platform.registers == 1)
    h.model.tokenArrived(try fixtureToken())
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.isEmpty)
    location.releaseFix(1)
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
  }

  @Test("a week away, the return's token waits for its fix: one PUT, with the new cell")
  func aTokenDuringAReturnsFixWaits() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(fixes: [located(phoneInLeeds), located(phoneFurtherNorth)])
    location.holdFix(2)
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now), location: location,
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    // The heartbeat is due, and the phone is in the next cell north.
    h.clock.now = now.addingTimeInterval(7 * day)
    let returning = Task { await h.model.becameActive() }
    #expect(
      await yieldUntil { location.calls.filter { $0 == "fix" }.count == 2 },
      "the return never took a fix")
    h.model.tokenArrived(try fixtureToken())
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.isEmpty)
    location.releaseFix(2)
    await returning.value
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneFurtherNorth), token: fixtureToken())])
  }

  @Test("location allowed while away: the return's fix comes before the hourly refresh, in one PUT")
  func aReturnsFixBeforeTheHourlyRefresh() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(access: .denied)
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now), location: location,
      replies: [try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    // Allowed in iOS Settings, then back more than an hour after the last PUT.
    location.change(access: .granted, fixes: [located(phoneInLeeds)])
    location.holdFix(1)
    h.clock.now = now.addingTimeInterval(61 * minute)
    let returning = Task { await h.model.becameActive() }
    #expect(await yieldUntil { location.calls.contains("fix") }, "the return never took a fix")
    h.model.tokenArrived(try fixtureToken())
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.isEmpty)
    location.releaseFix(1)
    await returning.value
    await h.model.synced()
    #expect(try h.requests == [try put(at: here(phoneInLeeds), token: fixtureToken())])
  }

  @Test("approximate, the set is sent again on becoming active an hour after the last, no sooner")
  func theHourlyRefresh() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      location: FakeLocation(access: .denied), replies: [try deviceReply("put-here-refresh")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.clock.now = now.addingTimeInterval(59 * minute)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    // An hour on, a sync that isn't a return to the app sends nothing.
    h.clock.now = now.addingTimeInterval(60 * minute)
    h.model.screenChanged(target: durham, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    await h.model.becameActive()
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
    #expect(try h.requests.first?.body == deviceSentJSON("put-here-refresh"))
    #expect(h.model.state.registration?.response.here?.name == "Newcastle")
    #expect(h.model.state.registration?.at == now.addingTimeInterval(60 * minute))
    // Half an hour after that: not yet again.
    h.clock.now = now.addingTimeInterval(90 * minute)
    await h.model.becameActive()
    await h.model.synced()
    #expect(try h.requests.count == 1)
  }

  @Test("the phone's own cell isn't sent again on becoming active, however long after")
  func noHourlyRefreshForThePhonesCell() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now),
      location: FakeLocation(fixes: [located(phoneInLeeds)]))
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    h.clock.now = now.addingTimeInterval(6 * day)
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
  }

  @Test("a change of units is sent")
  func unitsSync() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.model.screenChanged(target: leedsCity, units: .f)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken(), units: .f)])
    #expect(h.store.loadRegistration()?.units == .f)
  }

  @Test("with no units known yet and none registered, the PUT waits for them")
  func noUnitsWaits() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, replies: [try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: nil)
    await h.model.synced()
    #expect(h.transport.requests.isEmpty)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
  }

  @Test("units not known at the start wait for the first answer's, after a switch or the card")
  func unitsComeWithTheFirstAnswer() async throws {
    for card in [false, true] {
      let h = NotificationsHarness(
        now: try devicesMoment(), replies: [try deviceReply("put-here-ip")])
      // An offline first launch: step 6 had no answer's units to give.
      h.model.screenChanged(target: .ip, units: nil)
      await h.model.synced()
      if card {
        await h.model.turnOnFromCard()
      } else {
        await h.model.setSwitch(.evening, on: true)
      }
      h.model.tokenArrived(try fixtureToken())
      await h.model.synced()
      #expect(h.transport.requests.isEmpty, "card \(card)")
      // The first answer brings them (AppModel's `syncAlerts`).
      h.model.screenChanged(target: .ip, units: .c)
      await h.model.synced()
      #expect(try h.requests == [try put(token: fixtureToken())], "card \(card)")
      #expect(h.model.state.registration != nil, "card \(card)")
    }
  }

  @Test("the registration's units stand in for units not known yet")
  func registeredUnitsStand() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now.addingTimeInterval(8 * day), settings: eveningOn,
      registration: try registration(at: now), replies: [try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: nil)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
  }

  @Test("Use my location asks for location only then, and where you are takes the phone's cell")
  func useMyLocationAsksOnlyThen() async throws {
    let location = FakeLocation(access: .notDetermined, fixes: [located(phoneInLeeds)])
    location.holdFix(1)
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, location: location,
      replies: [try deviceReply("put-here-ip"), try deviceReply("put-here-device")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(location.calls == ["access"])
    #expect(h.model.state.locationAccess == .notDetermined)
    #expect(try h.requests == [try put(token: fixtureToken())])
    let locating = Task { await h.model.useMyLocation() }
    #expect(await yieldUntil { location.calls.contains("fix") }, "no fix was asked for")
    #expect(h.model.state.locating)
    location.releaseFix(1)
    await locating.value
    await h.model.synced()
    #expect(!h.model.state.locating)
    #expect(location.calls == ["access", "access", "request", "fix"])
    #expect(h.model.state.locationAccess == .granted)
    #expect(!h.model.state.locationUnavailable)
    #expect(h.model.state.here == HereState(place: here(phoneInLeeds)))
    #expect(h.store.loadSettings() == eveningAt(phoneInLeeds))
    #expect(try h.requests.last == put(at: here(phoneInLeeds), token: fixtureToken()))
    #expect(h.model.state.registration?.response.here?.follows == .device)
  }

  @Test("Use my location denied, or with no fix, says so; a later fix clears it")
  func useMyLocationProblems() async throws {
    let location = FakeLocation(access: .denied)
    let h = NotificationsHarness(now: try devicesMoment(), location: location)
    await h.model.useMyLocation()
    #expect(h.model.state.locationAccess == .denied)
    #expect(location.calls == ["access"])
    #expect(!h.model.state.locating)
    #expect(!h.model.state.locationUnavailable)
    location.change(access: .granted, fixes: [.unavailable])
    await h.model.useMyLocation()
    #expect(h.model.state.locationAccess == .granted)
    #expect(h.model.state.locationUnavailable)
    #expect(h.model.state.here == HereState(place: .ip))
    // The permission went while the fix was out.
    location.change(access: .granted, fixes: [.denied])
    await h.model.useMyLocation()
    #expect(h.model.state.locationAccess == .denied)
    #expect(!h.model.state.locationUnavailable)
    location.change(access: .granted, fixes: [located(phoneFurtherNorth)])
    await h.model.useMyLocation()
    #expect(h.model.state.locationAccess == .granted)
    #expect(!h.model.state.locationUnavailable)
    #expect(h.model.state.here == HereState(place: here(phoneFurtherNorth)))
    #expect(h.store.loadSettings().here == cell(phoneFurtherNorth))
    // Settings closing puts the line away.
    location.change(access: .granted, fixes: [.unavailable])
    await h.model.useMyLocation()
    #expect(h.model.state.locationUnavailable)
    h.model.dismissResults()
    #expect(!h.model.state.locationUnavailable)
    // The prompt refused at the tap.
    let refused = NotificationsHarness(
      now: try devicesMoment(), location: FakeLocation(access: .notDetermined, answer: .denied))
    await refused.model.useMyLocation()
    #expect(refused.model.state.locationAccess == .denied)
    #expect(refused.location.calls == ["access", "request"])
  }

  @Test("where you are the server can't find: its words in the status line, the set forgotten")
  func whereYouAreTheServerCantFind() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now),
      location: FakeLocation(access: .denied), replies: [try deviceReply("put-unlocated")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken())])
    #expect(try h.requests.first?.body == deviceSentJSON("put-unlocated"))
    #expect(h.model.state.status == unlocated)
    #expect(h.model.state.here == HereState(place: .ip, refused: true))
    // The server has forgotten the set: so has the phone, and the switches stay on.
    #expect(h.model.state.registration == nil)
    #expect(h.store.loadRegistration() == nil)
    #expect(h.model.state.settings == eveningOn)
    #expect(h.store.loadSettings() == eveningOn)
  }

  @Test("a set the server couldn't place waits until it changes or the app becomes active")
  func theRefusedSetWaits() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, location: FakeLocation(access: .denied),
      replies: [
        try deviceReply("put-unlocated"), try deviceReply("put-unlocated"),
        try deviceReply("put-here-ip"),
      ])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(try h.requests.count == 1)
    // The same set again, whatever is on screen: nothing, and the server's words stay.
    h.model.screenChanged(target: durham, units: .c)
    await h.model.refreshPermission()
    await h.model.synced()
    #expect(try h.requests.count == 1)
    #expect(h.model.state.status == unlocated)
    // Back in the app: sent once more.
    h.clock.now = now.addingTimeInterval(minute)
    await h.model.becameActive()
    await h.model.synced()
    #expect(try h.requests.count == 2)
    #expect(h.model.state.status == unlocated)
    #expect(h.model.state.here.refused)
    // A change to the set is sent at once.
    h.model.screenChanged(target: durham, units: .f)
    await h.model.synced()
    #expect(
      try h.requests == [
        try put(token: fixtureToken()), try put(token: fixtureToken()),
        try put(token: fixtureToken(), units: .f),
      ])
    #expect(h.model.state.status == .ok)
    #expect(h.model.state.here == HereState(place: .ip))
    #expect(h.model.state.registration != nil)
  }

  @Test("turned off, a set the server couldn't place is gone: turned on again, it is sent")
  func aRefusedSetTurnedOffAndOn() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, location: FakeLocation(access: .denied),
      replies: [try deviceReply("put-unlocated")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.synced()
    #expect(h.model.state.status == unlocated)
    await h.model.setSwitch(.evening, on: false)
    await h.model.synced()
    // Nothing to delete: the server forgot the set when it refused it.
    #expect(try h.requests.count == 1)
    #expect(h.model.state.status == .ok)
    #expect(h.model.state.here == HereState(place: .ip))
    await h.model.setSwitch(.evening, on: true)
    await h.model.synced()
    #expect(try h.requests == [try put(token: fixtureToken()), try put(token: fixtureToken())])
    #expect(h.model.state.status == unlocated)
    #expect(h.model.state.here == HereState(place: .ip, refused: true))
  }

  @Test("every place's zone by its key, for the router: where you are's and each saved place's")
  func zones() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(now: now, registration: try registration(at: now))
    #expect(h.model.zones == ["device:53.8,-1.55": "Europe/London"])
    let saved = [
      DeviceResponse.Saved(
        pid: "0123456789ab", name: "Durham", timezone: "Europe/London", query: "place=durham-gb",
        country: "GB"),
      DeviceResponse.Saved(
        pid: "ba9876543210", name: "Kathmandu", timezone: "Asia/Kathmandu",
        query: "lat=27.7&lon=85.3&source=search&name=Kathmandu", country: "NP"),
    ]
    let several = NotificationsHarness(
      now: now, registration: try registration("put-here-refresh", at: now, saved: saved))
    #expect(
      several.model.zones == [
        "device:55,-1.6": "Europe/London", "city:durham-gb": "Europe/London",
        "search:27.7,85.3": "Asia/Kathmandu",
      ])
    #expect(NotificationsHarness(now: now).model.zones.isEmpty)
  }

  @Test("the card shows only while the screen shows where you are: approximate, or its cell")
  func theCardsWhereYouAreFlag() async throws {
    // Where you are is the phone's cell in Leeds, kept; the fixes find no other.
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: AlertSettings(here: cell(phoneInLeeds)))
    #expect(!h.model.state.showsHere)
    let screens: [(Target, Bool)] = [
      (.ip, true), (leedsCity, false), (phoneInLeeds, true), (searchedLeeds, false),
      (durham, false), (phoneFurtherNorth, false),
    ]
    for (target, shows) in screens {
      h.model.screenChanged(target: target, units: .c)
      await h.model.synced()
      #expect(h.model.state.showsHere == shows, "\(target.key)")
      #expect((NotificationCard.card(h.model.state) != nil) == shows, "\(target.key)")
    }
    // The phone's point on screen comes to be where you are once a fix finds the phone there.
    h.location.change(access: .granted, fixes: [located(phoneFurtherNorth)])
    await h.model.becameActive()
    #expect(h.model.state.showsHere)
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
        now: now, settings: eveningOn, replies: [reply, try deviceReply("put-here-ip")])
      h.model.tokenArrived(try fixtureToken())
      h.model.screenChanged(target: leedsCity, units: .c)
      await h.model.synced()
      #expect(h.clock.pending == [now.addingTimeInterval(wait)], "\(wait)")
      #expect(h.model.state.status == .ok)
      #expect(h.model.state.registration == nil)
      #expect(await h.clock.runNext())
      await h.model.synced()
      #expect(try h.requests.count == 2)
      #expect(h.model.state.registration?.response == (try deviceResponse("put-here-ip")))
      #expect(h.clock.pending.isEmpty)
    }
  }

  @Test("a change while a retry waits is sent at once, and the retry goes")
  func aChangeCancelsTheRetry() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn,
      replies: [try deviceReply("put-twice"), try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.clock.pending.count == 1)
    await h.model.setSwitch(.morning, on: true)
    await h.model.synced()
    #expect(h.clock.pending.isEmpty)
    #expect(try h.requests.count == 2)
    #expect(h.model.state.registration != nil)
  }

  @Test("changes while a PUT is out are sent together, once it is answered")
  func syncsCoalesce() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn,
      replies: [try deviceReply("put-here-ip"), try deviceReply("put-here-ip")])
    h.transport.hold(1)
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    #expect(await yieldUntil { h.transport.requests.count == 1 }, "the PUT was never sent")
    await h.model.setSwitch(.morning, on: true)
    await h.model.setSwitch(.possible, on: true)
    for _ in 0..<100 { await Task.yield() }
    #expect(h.transport.requests.count == 1)
    h.transport.release(1)
    await h.model.synced()
    let all = AlertPrefs(evening: true, morning: true, possible: true)
    #expect(
      try h.requests == [try put(token: fixtureToken()), try put(all, token: fixtureToken())])
    let body = AlertSync.body(
      token: try fixtureToken(), env: .sandbox, here: .ip, units: .c, prefs: all,
      appVersion: "1.0 (42)")
    #expect(h.store.loadRegistration()?.fingerprint == AlertSync.fingerprint(body))
  }

  @Test("offline, a change isn't saved, and says so; online on the next return, it is")
  func offlineNotSaved() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, replies: [.failure(.notConnectedToInternet)])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.status == .notSaved)
    #expect(h.clock.pending.isEmpty)
    h.transport.replyNext([try deviceReply("put-here-ip")])
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.model.state.status == .ok)
    #expect(h.store.loadRegistration() != nil)
    #expect(try h.requests.count == 2)
  }

  @Test("a heartbeat, or the hourly refresh, that fails says nothing")
  func aFailedHeartbeatSaysNothing() async throws {
    let now = try devicesMoment()
    let kept = try registration(at: now.addingTimeInterval(-8 * day))
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: kept, replies: [.failure(.timedOut)])
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
    #expect(try h.requests.count == 2)
    #expect(h.model.state.status == .ok)
  }

  @Test("a DELETE that fails isn't saved, and says so")
  func aFailedDeleteIsNotSaved() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.setSwitch(.evening, on: false)
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
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    // The new token's PUT didn't reach the server, so its record is still the old token's.
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.setSwitch(.evening, on: false)
    await h.model.synced()
    #expect(
      try h.requests == [
        try put(token: otherToken), try identity(.delete, token: fixtureToken()),
      ])
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("a PUT answered 204 forgets the registration")
  func aPutAnswered204Forgets() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    h.model.tokenArrived(otherToken)
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(try h.requests.first?.method == .put)
    #expect(h.store.loadRegistration() == nil)
    #expect(h.model.state.status == .ok)
  }
}

@MainActor
@Suite("The test notification", .timeLimit(.minutes(1)))
struct NotificationTestSendTests {
  @Test("each of the server's answers to a test shows as its own result")
  func testOutcomes() async throws {
    let now = try devicesMoment()
    let outcomes: [(String, AlertSync.TestOutcome)] = [
      ("test-sent", .sent(count: 1)), ("test-dryrun", .dryRun), ("test-limited", .limited),
      ("test-quiet", .quiet), ("test-unregistered", .notRegistered), ("test-down", .failed),
      ("rate-limited", .failed),
    ]
    for (name, outcome) in outcomes {
      let h = NotificationsHarness(
        now: now, settings: eveningOn, registration: try registration(at: now),
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
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("test-sent")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.sent(count: 1)))
    #expect(
      try h.requests == [
        try put(token: otherToken), try identity(.post, token: fixtureToken()),
      ])
  }

  @Test("a test Apple refuses forgets the registration, which is sent again")
  func aGoneTestRegistersAgain() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("test-gone"), try deviceReply("put-here-ip")])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.notRegistered))
    await h.model.synced()
    #expect(
      try h.requests == [
        try identity(.post, token: fixtureToken()), try put(token: fixtureToken()),
      ])
    #expect(h.store.loadRegistration() != nil)
  }

  @Test("without a registration, the test syncs first; with no token, it fails, asking nothing")
  func aTestWithoutARegistrationSyncsFirst() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn,
      replies: [
        .failure(.notConnectedToInternet), try deviceReply("put-here-ip"),
        try deviceReply("test-sent"),
      ])
    h.model.tokenArrived(try fixtureToken())
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    #expect(h.model.state.registration == nil)
    await h.model.sendTest()
    #expect(h.model.state.test == .done(.sent(count: 1)))
    #expect(try h.requests.map(\.method) == [.put, .put, .post])

    let noToken = NotificationsHarness(
      now: try devicesMoment(), settings: eveningOn, replies: [try deviceReply("test-sent")])
    noToken.model.screenChanged(target: leedsCity, units: .c)
    await noToken.model.sendTest()
    #expect(noToken.model.state.test == .done(.failed))
    #expect(noToken.transport.requests.isEmpty)
  }

  @Test("a second tap while the test is out sends nothing more; it shows sending meanwhile")
  func oneTestAtATime() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
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
    #expect(h.model.state.test == .done(.sent(count: 1)))
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
      now: now, settings: eveningOn, registration: try registration(at: now),
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

  @Test("the delete forgets the phone's cell too, until the next fix")
  func deleteMyDataForgetsTheCell() async throws {
    let now = try devicesMoment()
    let location = FakeLocation(fixes: [located(phoneInLeeds)])
    let h = NotificationsHarness(
      now: now, settings: eveningAt(phoneInLeeds),
      registration: try registration("put-here-device", at: now), location: location,
      replies: [try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    await h.model.synced()
    await h.model.deleteMyData()
    #expect(h.model.state.delete == .done)
    #expect(h.store.loadSettings() == AlertSettings())
    #expect(h.model.state.here == HereState(place: .ip))
    location.change(access: .granted, fixes: [located(phoneFurtherNorth)])
    await h.model.becameActive()
    await h.model.synced()
    #expect(h.store.loadSettings() == AlertSettings(here: cell(phoneFurtherNorth)))
    #expect(try h.requests == [try identity(.delete, token: fixtureToken())])
  }

  @Test("the delete names the record by the token last sent, not a newer one the server lacks")
  func deleteMyDataWithANewerToken() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [.failure(.notConnectedToInternet), try deviceReply("delete")])
    h.model.screenChanged(target: leedsCity, units: .c)
    h.model.tokenArrived(otherToken)
    await h.model.synced()
    #expect(h.model.state.registration?.token == (try fixtureToken()))
    await h.model.deleteMyData()
    #expect(
      try h.requests == [
        try put(token: otherToken), try identity(.delete, token: fixtureToken()),
      ])
    #expect(h.model.state.delete == .done)
    #expect(h.store.loadRegistration() == nil)
  }

  @Test("offline, the delete says it will try again, and the next sync deletes")
  func deleteMyDataOffline() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
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
      now: try devicesMoment(), settings: eveningOn,
      replies: [try deviceReply("put-here-ip"), try deviceReply("delete")])
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
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.turnOnFromCard()
    #expect(NotificationCard.card(h.model.state)?.kind == .turnedOn(name: nil))
    await h.model.deleteMyData()
    #expect(h.model.state.delete == .done)
    #expect(!h.model.state.cardTurnedOn)
    #expect(NotificationCard.card(h.model.state) == nil)
  }

  @Test("before the start, the delete starts the model first")
  func deleteMyDataBeforeTheStart() async throws {
    let now = try devicesMoment()
    let h = NotificationsHarness(
      now: now, settings: eveningOn, registration: try registration(at: now),
      replies: [try deviceReply("delete")])
    await h.model.deleteMyData()
    #expect(h.platform.reads == 1)
    #expect(h.model.state.delete == .done)
  }

  @Test("Not now puts the card away for good; Turn on is for where you are, approximate too")
  func theCard() async throws {
    let h = NotificationsHarness(now: try devicesMoment())
    h.model.dismissCard()
    #expect(h.model.state.cardDismissed)
    #expect(h.store.loadCardDismissed())

    let allowed = NotificationsHarness(
      now: try devicesMoment(), location: FakeLocation(access: .denied))
    allowed.model.screenChanged(target: .ip, units: .c)
    await allowed.model.turnOnFromCard()
    #expect(allowed.model.state.settings == eveningOn)
    #expect(allowed.store.loadSettings() == eveningOn)
    #expect(allowed.model.state.here == HereState(place: .ip))
    #expect(allowed.model.state.cardTurnedOn)
    #expect(!allowed.model.state.cardRefused)
    #expect(allowed.model.state.cardDismissed)
    #expect(allowed.store.loadCardDismissed())
    #expect(allowed.platform.registers == 1)

    let refused = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    await refused.model.turnOnFromCard()
    #expect(refused.model.state.cardRefused)
    #expect(!refused.model.state.cardTurnedOn)
    #expect(!refused.model.state.cardDismissed)
    #expect(refused.model.state.settings == AlertSettings())
  }

  @Test("the card's Done line names the town once the server has named where you are")
  func theCardNamesTheTown() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), location: FakeLocation(access: .denied),
      replies: [try deviceReply("put-here-ip")])
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.turnOnFromCard()
    #expect(NotificationCard.card(h.model.state)?.kind == .turnedOn(name: nil))
    h.model.tokenArrived(try fixtureToken())
    await h.model.synced()
    let card = NotificationCard.card(h.model.state)
    #expect(card?.kind == .turnedOn(name: "Leeds"))
    #expect(card?.line == AppCopy.cardOnNamed(place: "Leeds"))
    // A city's page shows no card, Done or not.
    h.model.screenChanged(target: durham, units: .c)
    #expect(NotificationCard.card(h.model.state) == nil)
    await h.model.synced()
  }

  @Test("the card's refusal goes once allowed in iOS Settings, and its Turn on then turns them on")
  func theRefusalGoesOnceAllowed() async throws {
    let h = NotificationsHarness(
      now: try devicesMoment(), permission: .notDetermined, answer: false)
    h.model.screenChanged(target: .ip, units: .c)
    await h.model.turnOnFromCard()
    #expect(NotificationCard.card(h.model.state)?.kind == .refused)
    // Open Settings, notifications allowed there, and back in the app.
    h.platform.current = .authorized
    await h.model.becameActive()
    #expect(NotificationCard.card(h.model.state)?.kind == .offer)
    await h.model.turnOnFromCard()
    #expect(NotificationCard.card(h.model.state)?.kind == .turnedOn(name: nil))
    #expect(h.model.state.settings == eveningOn)
    #expect(h.platform.requests == 1)
  }

  @Test("a Settings action before the launch's step 6 starts the model, once")
  func aSettingsActionBeforeTheLaunchStarts() async throws {
    let h = NotificationsHarness(now: try devicesMoment(), permission: .notDetermined)
    await h.model.setSwitch(.evening, on: true)
    #expect(h.platform.calls == ["permission", "request", "permission", "register"])
    #expect(h.model.state.settings == eveningOn)
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
      now: now, settings: eveningAt(phoneInLeeds), registration: kept, cardDismissed: true)
    #expect(h.model.state.settings == eveningAt(phoneInLeeds))
    #expect(h.model.state.registration == kept)
    #expect(h.model.state.cardDismissed)
    #expect(h.model.state.permission == .notDetermined)
    #expect(h.model.state.locationAccess == .notDetermined)
    #expect(h.platform.calls.isEmpty)
    #expect(h.location.calls.isEmpty)
  }
}
