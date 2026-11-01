import Foundation
import IsItLogic
import IsItModel

/// What the widget reads and writes in the App Group (spec 9.6): `SharedStore` on iOS. Never
/// `unlock.v1`'s writer: only `PurchaseModel` writes it.
public protocol WidgetStore: Sendable {
  /// The chosen place, or approximate IP location when there is none, or the group can't be read.
  func loadPlace() -> Target
  /// The units, or nil before the first answer chose them.
  func loadUnits() -> Units?
  /// `unlock.v1` as written: nil for nothing, junk, or a group the phone can't read yet.
  func loadUnlock() -> StoredUnlock?
  /// The last good answer, or nil (none, unreadable, or another store version's).
  func loadToday() -> SavedToday?
  /// Keeps `saved` as the last good answer, replacing the one before.
  func saveToday(_ saved: SavedToday) throws
}

/// StoreKit's entitlements, read from the widget: `StoreKitEntitlements` (IsItServices) on iOS.
/// It may never answer (V3); `WidgetTimeline` waits for it at most `checkWithin`.
public protocol EntitlementReader: Sendable {
  func entitlements() async -> [PurchaseFact]
}

/// A widget's timeline (spec 11.2): plain async code over the App Group, the API and StoreKit,
/// which `ForecastProvider` (IsItWidgetUI) hands to WidgetKit. It asks StoreKit beside the
/// answer, plans from the saved answer while it is recent, else asks the server once per query
/// (`FetchGate`) within a hard limit (`Deadline`), saves what it fetched for the app, falls back
/// to the saved answer for the same place, and plans and faces the entries (`WidgetPlanner`,
/// `WidgetFace`). Every path returns, and nothing throws.
public struct WidgetTimeline: Sendable {
  /// Where the plan's answer came from.
  public enum Source: String, Sendable {
    case locked, reused, fetched, saved, none
  }

  /// Why it is unlocked, or not.
  public enum Unlock: String, Sendable {
    case flag, storeKit, no
  }

  /// What StoreKit said, for the log line (V3): every `plan(at:)` asks, so `unasked` is a
  /// snapshot's alone (`saved(at:)`, which never asks).
  public enum StoreKitAnswer: Sendable, Equatable {
    case unasked, late
    case answered(Int)
  }

  /// One entry for WidgetKit: when it starts showing, and what it shows.
  public struct Entry: Sendable, Equatable {
    public let date: Date
    public let face: WidgetFace
  }

  /// The timeline: its entries, when WidgetKit should ask again, and what happened, for the log.
  public struct Plan: Sendable, Equatable {
    public let entries: [Entry]
    public let reload: WidgetPlan.Reload
    public let source: Source
    public let unlock: Unlock
    public let storeKit: StoreKitAnswer

    /// The provider's log line (decision 15): `key=value` tokens only, `family=…
    /// width=… height=… unlock=… storekit=unasked|late|answered:N source=… entries=N
    /// font=ok|missing`, never a place, key, URL or transaction.
    public func logLine(family: String, width: Int, height: Int, font: Bool) -> String {
      let told =
        switch storeKit {
        case .unasked: "unasked"
        case .late: "late"
        case .answered(let count): "answered:\(count)"
        }
      return "family=\(family) width=\(width) height=\(height) unlock=\(unlock.rawValue)"
        + " storekit=\(told) source=\(source.rawValue) entries=\(entries.count)"
        + " font=\(font ? "ok" : "missing")"
    }
  }

  /// The answer half, with no purchase check (also 7.4's).
  public struct Answer: Sendable, Equatable {
    public let response: TodayResponse?
    /// When the answer was fetched: now for one fetched now, else its `savedAt`; now without one.
    public let fetchedAt: Date
    public let source: Source
    /// The name the app keeps for the place (`Target.ownName`), else nil for the answer's.
    public let placeName: String?
  }

  /// The API it asks (read by WidgetBundleTests, which holds the extension's to its origin).
  public let client: APIClient
  /// The gate its request waits at (read by WidgetBundleTests, which holds the extension's to the
  /// process's one, `FetchGate.shared`).
  public let gate: FetchGate
  private let store: any WidgetStore
  private let entitlements: any EntitlementReader
  private let productID: String
  private let checkWithin: TimeInterval
  private let fetchWithin: TimeInterval

  /// `gate` has no default: the extension passes `.shared`, and each test a gate of its own.
  public init(
    store: any WidgetStore, client: APIClient, entitlements: any EntitlementReader,
    gate: FetchGate, productID: String = Constants.Purchase.productID,
    checkWithin: TimeInterval = TimeInterval(Constants.Purchase.widgetCheckMs) / 1000,
    fetchWithin: TimeInterval = TimeInterval(Constants.Client.requestTimeoutMs) / 1000
  ) {
    self.store = store
    self.client = client
    self.entitlements = entitlements
    self.gate = gate
    self.productID = productID
    self.checkWithin = checkWithin
    self.fetchWithin = fetchWithin
  }

  /// The timeline at `now` (spec 11.2). StoreKit is asked first and beside everything else, and
  /// waited for `checkWithin` at most from the start. `unlock.v1` saying unlocked unlocks, and
  /// StoreKit's answer is then only logged; otherwise a verified, unrevoked transaction for the
  /// product does (`PurchaseRules.owned`), and anything else locks: a locked plan never asks the
  /// server, and is reloaded only by the app when the flag says locked, or looks again after
  /// `Constants.Widget.retryMinutes` when there is no flag. Unlocked with the flag, the answer
  /// is `answer(at:)`'s; unlocked by StoreKit alone, only what is saved for the place: no flag is
  /// what an App Group the phone can't read yet gives, when the place reads as approximate IP
  /// location, so a request would put the network's town on the widget.
  public func plan(at now: Date) async -> Plan {
    async let facts = Deadline.value(within: checkWithin) { await entitlements.entitlements() }
    let flag = store.loadUnlock()
    let unlock: Unlock
    if flag?.unlocked == true {
      unlock = .flag
    } else if let held = await facts, PurchaseRules.owned(held, productID: productID) {
      unlock = .storeKit
    } else {
      unlock = .no
    }
    guard unlock != .no else {
      return Self.locked(at: now, flag: flag, storeKit: Self.told(await facts))
    }
    let answer = flag == nil ? savedAnswer(at: now) : await self.answer(at: now)
    return Self.planned(answer, at: now, unlock: unlock, storeKit: Self.told(await facts))
  }

  /// The answer for the place the app has chosen, with no purchase check. The saved answer when
  /// `WidgetSource.reuses` it, with no request; otherwise one request per query in this process
  /// (`gate`), as the app asks (`APIClient.request(for:units:)`), within `fetchWithin`, saved for
  /// the app (the guarded save, below); and when that fails, the saved answer when
  /// `WidgetSource.fallsBack` to it, else none.
  public func answer(at now: Date) async -> Answer {
    let target = store.loadPlace()
    let units = store.loadUnits()
    let key = target.key
    let saved = store.loadToday()
    let placeName = target.ownName
    if let saved, WidgetSource.reuses(saved, key: key, units: units, at: now) {
      return Answer(
        response: saved.response, fetchedAt: saved.savedAt, source: .reused, placeName: placeName)
    }
    let query = client.request(for: target, units: units)?.url.absoluteString ?? key
    let fetched = await gate.run(query) {
      let response = await Deadline.value(within: fetchWithin) {
        try? await client.today(for: target, units: units)
      }
      guard let response = response ?? nil else { return nil }
      let fresh = SavedToday(key: key, savedAt: now, response: response)
      Self.save(fresh, units: units, in: store)
      return fresh
    }
    // A second caller sharing the request gets the first's `savedAt`.
    if let fetched {
      return Answer(
        response: fetched.response, fetchedAt: fetched.savedAt, source: .fetched,
        placeName: placeName)
    }
    if let saved, WidgetSource.fallsBack(saved, key: key, units: units) {
      return Answer(
        response: saved.response, fetchedAt: saved.savedAt, source: .saved, placeName: placeName)
    }
    return Answer(response: nil, fetchedAt: now, source: .none, placeName: placeName)
  }

  /// From what is saved only: no request and no StoreKit (WidgetKit's snapshot while adding).
  /// Locked unless `unlock.v1` says unlocked, as `plan(at:)` would be with StoreKit holding
  /// nothing.
  public func saved(at now: Date) -> Plan {
    let flag = store.loadUnlock()
    guard flag?.unlocked == true else {
      return Self.locked(at: now, flag: flag, storeKit: .unasked)
    }
    return Self.planned(savedAnswer(at: now), at: now, unlock: .flag, storeKit: .unasked)
  }

  /// The gallery's and the placeholder's: `WidgetFace.sample`, dated `now`.
  public static func sample(at now: Date) -> Entry {
    Entry(date: now, face: .sample)
  }

  // MARK: - Private

  /// The saved answer when `WidgetSource.fallsBack` takes it for the place and units the App
  /// Group reads, else none; never a request.
  private func savedAnswer(at now: Date) -> Answer {
    let target = store.loadPlace()
    let saved = store.loadToday()
    guard let saved, WidgetSource.fallsBack(saved, key: target.key, units: store.loadUnits())
    else { return Answer(response: nil, fetchedAt: now, source: .none, placeName: target.ownName) }
    return Answer(
      response: saved.response, fetchedAt: saved.savedAt, source: .saved,
      placeName: target.ownName)
  }

  /// The guarded save, once per request: only while `place.v1` and `units.v1` still say what
  /// was asked for (the key byte for byte), and never over an answer for the place saved after
  /// this one was fetched. A failed save is ignored: the plan stands. (The app may write in the
  /// moment between the check and the write; both answers are fresh and the file is replaced
  /// whole, so either is right.)
  private static func save(_ fresh: SavedToday, units: Units?, in store: any WidgetStore) {
    guard store.loadPlace().key.utf8.elementsEqual(fresh.key.utf8), store.loadUnits() == units
    else { return }
    if let kept = store.loadToday(), kept.key.utf8.elementsEqual(fresh.key.utf8),
      kept.savedAt > fresh.savedAt
    {
      return
    }
    try? store.saveToday(fresh)
  }

  /// The locked plan: one locked entry, no request and no save; never reloaded but by the app
  /// when `flag` says locked, looked at again after the retry when there is none.
  private static func locked(at now: Date, flag: StoredUnlock?, storeKit: StoreKitAnswer) -> Plan {
    let plan = WidgetPlanner.entries(nil, fetchedAt: now, now: now, unlocked: false)
    let retry = Date(epochMs: now.epochMs + Constants.Widget.retryMinutes * 60 * 1000)
    return Plan(
      entries: faced(plan.entries, unit: .cm),
      reload: flag == nil ? .after(retry) : plan.reloadAt,
      source: .locked,
      unlock: .no,
      storeKit: storeKit
    )
  }

  /// The unlocked plan from `answer`: the planner's entries and reload, faced in the answer's
  /// unit.
  private static func planned(
    _ answer: Answer, at now: Date, unlock: Unlock, storeKit: StoreKitAnswer
  ) -> Plan {
    let plan = WidgetPlanner.entries(
      answer.response, fetchedAt: answer.fetchedAt, now: now, unlocked: true,
      placeName: answer.placeName)
    return Plan(
      entries: faced(plan.entries, unit: answer.response?.snow?.unit ?? .cm),
      reload: plan.reloadAt,
      source: answer.source,
      unlock: unlock,
      storeKit: storeKit
    )
  }

  private static func faced(_ entries: [WidgetEntry], unit: SnowUnit) -> [Entry] {
    entries.map { Entry(date: $0.date, face: WidgetFace($0, unit: unit)) }
  }

  /// StoreKit's answer for the log: nil, none in time, is late.
  private static func told(_ facts: [PurchaseFact]?) -> StoreKitAnswer {
    facts.map { .answered($0.count) } ?? .late
  }
}
