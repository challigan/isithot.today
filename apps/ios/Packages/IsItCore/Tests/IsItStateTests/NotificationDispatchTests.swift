import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

/// Each event the system gives, to the models (iOS build spec, section 12.3), with an app and a
/// notifications model on one fake server and one clock.
@MainActor
@Suite("The notifications' events, to the models", .timeLimit(.minutes(1)))
struct NotificationDispatchTests {
  /// An app on `place` and a notifications model kept as `registration` says, at `now`, on one
  /// server answering `replies` in order.
  func models(
    now: Date, place: Target = leedsCity, registration: AlertRegistration? = nil,
    settings: AlertSettings = AlertSettings(), replies: [FakeTransport.Reply]
  ) -> (app: Harness, notifications: NotificationsHarness) {
    let transport = FakeTransport(replies)
    let clock = TestClock(now)
    let app = Harness(
      now: now, store: .init(place: place, units: .c), replies: [], transport: transport,
      clock: clock)
    let notifications = NotificationsHarness(
      now: now, settings: settings, registration: registration, transport: transport,
      clock: clock)
    return (app, notifications)
  }

  @Test("a tap that launched the app waits for the launch, then opens on its place and view")
  func aTapDuringTheLaunchWaits() async throws {
    let now = try fixtureNow("durham-tomorrow")
    let (app, notifications) = models(
      now: now,
      replies: [
        try FakeTransport.fixture("leeds-dry"), try FakeTransport.fixture("durham-tomorrow"),
      ])
    let inbox = NotificationInbox()
    inbox.post(.tapped(try Fixtures.payload("durham-evening")))
    inbox.attach {
      await NotificationDispatch.handle($0, app: app.model, notifications: notifications.model)
    }
    await inbox.drained()
    #expect(app.model.route == .place(durham, view: .today))
    #expect(app.transport.requests.isEmpty)
    await app.model.launch()
    #expect(app.model.route == nil)
    #expect(app.model.target == durham)
    #expect(app.store.loadPlace() == durham)
    #expect(app.model.recents.first?.name == "Durham")
    #expect(app.model.view == .today)
    #expect(
      app.transport.urls.last
        == "https://willitsnow.today/api/v1/today?place=durham-gb&units=c&ahead=snow")
    #expect(app.hooks.routes == [.place(durham, view: .today)])
  }

  @Test("an old notification opens its place on the view for the time of day there")
  func anOldTapOpensOnTheDefaultView() async throws {
    let now = try fixtureNow("durham-tomorrow")
    let (app, notifications) = models(
      now: now, registration: try registration("put-durham", at: now),
      replies: [
        try FakeTransport.fixture("leeds-dry"), try FakeTransport.fixture("durham-tomorrow"),
      ])
    await app.model.launch()
    app.model.view = .week
    let handled = await NotificationDispatch.handle(
      .tapped(try Fixtures.payload("durham-old")), app: app.model,
      notifications: notifications.model)
    #expect(handled)
    #expect(app.hooks.routes == [.place(durham, view: nil)])
    #expect(app.model.target == durham)
    // Durham at 6:05pm: the view for the time of day is Now.
    #expect(app.model.view == MiddleDay.defaultView(try fixture("durham-tomorrow"), at: now))
    #expect(app.model.view == .now)
  }

  @Test("the registration's zone tells the place's date, ahead of the answer on screen's")
  func theRegistrationsZoneDecides() async throws {
    // Noon on 17 December: the 17th in Durham, the 18th at UTC+14.
    let now = Date(epochMs: 1_797_508_800_000)
    let payload = try Fixtures.payload("durham-evening")
    var routes: [DeepLink.Route?] = []
    for registered in [false, true] {
      let (app, notifications) = models(
        now: now, place: durham,
        registration: registered
          ? try registration("put-durham", at: now, timezone: "Pacific/Kiritimati") : nil,
        replies: [try FakeTransport.fixture("durham-tomorrow")])
      await app.model.launch()
      await NotificationDispatch.handle(
        .tapped(payload), app: app.model, notifications: notifications.model)
      routes.append(app.hooks.routes.last)
    }
    // From the answer on screen, Durham's own zone: still the day the notification was about.
    #expect(routes == [.place(durham, view: .today), .place(durham, view: nil)])
  }

  @Test("a tap whose payload routes nowhere opens nothing")
  func aMalformedTapOpensNothing() async throws {
    let now = try fixtureNow("durham-tomorrow")
    let (app, notifications) = models(
      now: now, replies: [try FakeTransport.fixture("leeds-dry")])
    await app.model.launch()
    for json in [
      try Fixtures.payload("malformed"), nil, Data("[]".utf8), Data("not json".utf8),
    ] {
      let handled = await NotificationDispatch.handle(
        .tapped(json), app: app.model, notifications: notifications.model)
      #expect(!handled)
    }
    #expect(app.model.target == leedsCity)
    #expect(app.hooks.routes.isEmpty)
    #expect(app.transport.requests.count == 1)
  }

  @Test("a notification arriving in the foreground asks again, quietly")
  func arrivedRefetches() async throws {
    let now = try fixtureNow("durham-tomorrow")
    let (app, notifications) = models(
      now: now, place: durham, replies: [try FakeTransport.fixture("durham-tomorrow")])
    await app.model.launch()
    #expect(app.transport.requests.count == 1)
    let handled = await NotificationDispatch.handle(
      .arrived(try Fixtures.payload("durham-evening")), app: app.model,
      notifications: notifications.model)
    #expect(handled)
    #expect(app.transport.requests.count == 2)
    #expect(app.transport.urls.last?.contains("place=durham-gb") == true)
    #expect(app.model.target == durham)
    #expect(app.hooks.routes.isEmpty)
  }

  @Test("the token reaches the notifications; iOS Settings' link opens Settings")
  func tokenAndSettings() async throws {
    let now = try devicesMoment()
    let (app, notifications) = models(
      now: now, settings: eveningInLeeds,
      replies: [try FakeTransport.fixture("leeds-dry"), try deviceReply("put-leeds")])
    await app.model.launch()
    notifications.model.screenChanged(target: leedsCity, units: .c)
    await notifications.model.synced()
    let token = try fixtureToken()
    #expect(
      await NotificationDispatch.handle(
        .token(token), app: app.model, notifications: notifications.model))
    await notifications.model.synced()
    #expect(try notifications.requests.map(\.method) == [.put])
    #expect(notifications.store.loadRegistration()?.token == token)
    await NotificationDispatch.handle(
      .registrationFailed, app: app.model, notifications: notifications.model)
    await notifications.model.synced()
    #expect(app.transport.requests.count == 2)
    await NotificationDispatch.handle(
      .openSettings, app: app.model, notifications: notifications.model)
    #expect(app.hooks.routes == [.settings(.notifications)])
  }
}
