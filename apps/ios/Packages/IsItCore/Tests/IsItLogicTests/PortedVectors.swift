/// One vector file phase 3 (or a later phase) must cover, and the port that checks it: nil until
/// it is ported.
struct PortedVector: Sendable {
  /// The vector file's name, without `.json`.
  let file: String
  /// The pull request that ports it, and the Swift it ports to (spec section 9.2).
  let by: String
  let port: VectorPort?

  init(_ file: String, by: String, port: VectorPort?) {
    self.file = file
    self.by = by
    self.port = port
  }
}

/// Every vector file phase 3 must cover (iOS build spec, sections 7.4, 9.2 and 19), phase 5's
/// `page.json`, phase 6's `search.json` and the saved places' `saved.json`, with its port.
/// `VectorCoverageTests` runs each port, and fails for each file whose port is still nil, and for
/// a file pnpm mobile:generate writes that isn't listed here, so none is skipped.
///
/// To port a file: write the Swift; define its port in a test file of its own, as
/// `extension VectorPort { static let grid = VectorPort { file in ... } }`, checking every case
/// of every function in the file (`file.compare`, or `file.forEachCase` for expectations of its
/// own); then change the file's `port: nil` below to that port (`port: .grid`). Entries stand
/// apart, so porters working in parallel change lines that don't touch.
enum PortedVectors {
  static let all: [PortedVector] = [
    // core roundToGrid
    PortedVector("grid", by: "3.2: GridRounding.round", port: .grid),

    // client targetKey, deviceTarget, searchTarget, targetFromQuery
    PortedVector("target", by: "3.2: Target.key, Target(query:), Target(search:)", port: .target),

    // client todayQuery, freshQuery, searchQuery
    PortedVector("query", by: "3.2: TodayQuery.build", port: .query),

    // core localDateTime
    PortedVector("placeTime", by: "3.3: PlaceTime.local(_:in:)", port: .placeTime),

    // core showsTomorrow, defaultView, viewLabel
    PortedVector(
      "tomorrow", by: "3.3: MiddleDay.showsTomorrow, .defaultView, .label", port: .tomorrow),

    // client hourUntil, dayUntil, usableUntil, hold, outOfDate, nextRefreshAt
    PortedVector("freshness", by: "3.3: Freshness", port: .freshness),

    // client pickHour, middleDay, updatedLine
    PortedVector("hours", by: "3.3: HourPicker.pick, UpdatedLine.text", port: .hours),

    // core question
    PortedVector("questions", by: "3.3: Questions.snow", port: .questions),

    // core viewDisplay's models strip
    PortedVector("strip", by: "3.3: StripGeometry", port: .strip),

    // client widgetEntries
    PortedVector("widget", by: "3.4: WidgetPlanner.entries", port: .widget),

    // client alertPlaceAllowed, registrationBody, fingerprint, alertAction
    PortedVector("alerts", by: "3.4: AlertSync.action, .body, .fingerprint", port: .alerts),

    // client parseDeepLink, notificationRoute
    PortedVector("links", by: "3.4: DeepLink.parse, .route(payload:)", port: .links),

    // client addRecent, removeRecent
    PortedVector("recent", by: "3.4: RecentPlaces", port: .recent),

    // packages/mobile homePage (the app's page, from core and the client) and homeTopBar (5.4),
    // core creditParts
    PortedVector("page", by: "5.1: HomePage, Credits.parts; 5.4: HomeTopBar", port: .page),

    // client searchInput, resultDetail (the place picker's search box)
    PortedVector("search", by: "6.1: PlaceSearch.input, .detail", port: .search),

    // client isSaved, canSave, savePlace, unsavePlace, choosePlace, shownRecent (the picker's
    // saved places, in the website's look's step 4)
    PortedVector("saved", by: "Look step 4: SavedPlaces", port: .saved),
  ]
}
