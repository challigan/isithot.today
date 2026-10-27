import Foundation
import IsItLogic
import IsItModel
import Observation

/// Where an ad goes: the home banner, or a page's end.
public enum AdSlot: Hashable, Sendable {
  /// The anchored adaptive banner at the bottom of the home screen.
  case home
  /// The inline adaptive banner at the end of a forecast page, after the footer's links.
  case pageEnd(AppView)
}

/// What UMP says: whether ads may be requested, and whether its privacy options form is required.
public struct AdsConsent: Equatable, Sendable {
  public var canRequestAds: Bool
  public var privacyOptionsRequired: Bool

  public init(canRequestAds: Bool, privacyOptionsRequired: Bool) {
    self.canRequestAds = canRequestAds
    self.privacyOptionsRequired = privacyOptionsRequired
  }
}

/// A banner's news: an ad arrived, or the load failed.
public enum BannerEvent: Equatable, Sendable {
  case loaded
  case failed
}

/// The SDK side: IsItAds' `GoogleAds` in the app, a fake in the tests. Every call on the main
/// actor, as UMP and Mobile Ads ask.
@MainActor
public protocol AdsPlatform: AnyObject {
  /// requestConsentInfoUpdate. `requested` hears UMP's answer as soon as the update is asked
  /// for, which is what an earlier launch's consent allows (UMP says no ads may be requested
  /// until the update is asked for, UMPConsentInformation.h); the answer once the update finishes
  /// is returned (a failure keeps the earlier one).
  func updateConsent(requested: (AdsConsent) -> Void) async -> AdsConsent
  /// loadAndPresentIfRequired, over whatever is on top; the answer after it.
  func presentConsentFormIfRequired() async -> AdsConsent
  /// presentPrivacyOptionsForm, over whatever is on top; the answer after it.
  func presentPrivacyOptions() async -> AdsConsent
  /// Mobile Ads' start, with the maximum ad content rating G. Called once.
  func startAds() async
  /// The home banner's height at `width` (largePortraitAnchoredAdaptiveBanner), known before it
  /// loads, so its space is kept from the start.
  func homeBannerHeight(width: Double) -> Double
  /// Loads `slot`'s banner at `width`; what happens comes to `banners`.
  func loadBanner(_ slot: AdSlot, width: Double)
  /// Where banner news goes, set by the model.
  var banners: ((AdSlot, BannerEvent) -> Void)? { get set }
  /// Loads a full-screen ad; whether one loaded.
  func loadInterstitial() async -> Bool
  /// Shows the loaded full-screen ad over whatever is on top, and returns once it closes (true),
  /// or at once when it can't be shown (false).
  func presentInterstitial() async -> Bool
}

/// When the last full-screen ad showed (`Keys.App.lastInterstitial`, the app's own defaults):
/// `AdDefaults` (IsItServices) in the app. Kept between launches, so the gap between two
/// (`Constants.Ads.interstitialGapMinutes`) holds across a relaunch.
public protocol AdsStore: Sendable {
  /// When the last full-screen ad showed, or nil when none has.
  func loadLastInterstitial() -> Date?
  /// Keeps `date` as when the last one showed; nil forgets it.
  func saveLastInterstitial(_ date: Date?)
}

/// When the last full-screen ad showed, kept in memory only: the tests'.
public final class MemoryAdsStore: AdsStore, @unchecked Sendable {
  private let lock = NSLock()
  private var last: Date?

  public init(_ last: Date? = nil) {
    self.last = last
  }

  public func loadLastInterstitial() -> Date? { lock.withLock { last } }

  public func saveLastInterstitial(_ date: Date?) { lock.withLock { last = date } }
}

/// The free version's ads (phase 8.3; iOS build spec, sections 14.1 and 14.2): UMP's consent,
/// then Mobile Ads, then the home banner, a banner at the end of each page shown, and a
/// full-screen ad when the user chooses a place in the picker. Google's SDKs are behind `AdsPlatform`, so the
/// tests run it on Linux with a fake. The views read the phase and the home band's height, and
/// draw nothing while the purchase is owned; an unlocked session never starts it.
///
/// A slot's space doesn't depend on its banner's news: the home band and the page ends are there
/// whenever the ads are `on`, as Google asks for a fixed space, so that a banner that loads late
/// never lands where content was. A banner that fails is asked for again after
/// `AdRules.retryDelay(failures:)`, on the model's clock. One that fails after it showed an ad is
/// a failed refresh, which the SDK covers by keeping the last ad; asking again then is harmless.
@MainActor
@Observable
public final class AdsModel {
  public enum Phase: Equatable, Sendable {
    /// Not started: before launch step 5, in an unlocked session, under `-noads`.
    case idle
    /// Asking UMP; no ads yet.
    case asking
    /// UMP says no ads may be requested yet (no answer from a required form, or offline on the
    /// first launch): none this launch.
    case withheld
    /// Mobile Ads started: the slots show and the ads load.
    case on
  }

  /// How far the ads have come this launch.
  public private(set) var phase = Phase.idle
  /// Whether Settings shows "Privacy choices": UMP's privacy options form is required, as its
  /// last answer said, once the ads were started.
  public private(set) var privacyChoices = false
  /// The home banner's height, once the ads are on and the home screen's width is known; nil,
  /// no band.
  public private(set) var homeBannerHeight: Double?

  @ObservationIgnored private let platform: any AdsPlatform
  @ObservationIgnored private let store: any AdsStore
  @ObservationIgnored private let clock: any AppClock
  /// The start flow, once `start(firstRun:)` began it.
  @ObservationIgnored private var asking: Task<Void, Never>?
  /// Whether this is the app's first run, which shows no full-screen ad.
  @ObservationIgnored private var firstRun = false
  /// Whether Mobile Ads was asked to start: once only.
  @ObservationIgnored private var started = false
  /// Each slot's width as laid out: the home screen's, and each page end's.
  @ObservationIgnored private var widths: [AdSlot: Double] = [:]
  /// The pages the pager has shown.
  @ObservationIgnored private var shownViews: Set<AppView> = []
  /// The width each slot's banner was last loaded at.
  @ObservationIgnored private var loadedWidths: [AdSlot: Double] = [:]
  /// Each slot's failed loads in a row.
  @ObservationIgnored private var failures: [AdSlot: Int] = [:]
  /// Each slot's load again after a failure, while it waits.
  @ObservationIgnored private var retries: [AdSlot: ScheduledWork] = [:]
  /// When the full-screen ad on hand loaded; nil, none on hand.
  @ObservationIgnored private var interstitialLoadedAt: Date?
  /// Whether a full-screen ad is loading.
  @ObservationIgnored private var loadingInterstitial = false

  public init(platform: any AdsPlatform, store: any AdsStore, clock: any AppClock) {
    self.platform = platform
    self.store = store
    self.clock = clock
    platform.banners = { [weak self] slot, event in self?.heard(event, from: slot) }
  }

  // MARK: - Consent and the start

  /// Launch step 5's work (spec 14.2), started and left running: returns at once, so alert sync
  /// and a pending route never wait on the consent form. Only the first call does anything.
  ///  1. If UMP's kept answer already lets ads be requested, Mobile Ads starts now, alongside the
  ///     update (Google's own order).
  ///  2. updateConsent, then presentConsentFormIfRequired.
  ///  3. privacyChoices from the answer; if ads may be requested and Mobile Ads hasn't started,
  ///     it starts; if not, `withheld`.
  /// Starting Mobile Ads sets `on`, reserves and loads the home banner if the width is known,
  /// loads the page-end banner of every page already shown whose width is known, and, unless
  /// `firstRun`, loads a full-screen ad.
  public func start(firstRun: Bool) {
    guard asking == nil else { return }
    self.firstRun = firstRun
    phase = .asking
    asking = Task { await ask() }
  }

  /// Settings' "Privacy choices": UMP's privacy options form, then its answer; if ads may now be
  /// requested and Mobile Ads hasn't started, it starts. Nothing while Settings doesn't show the
  /// row (`privacyChoices`), as in a session whose ads never started.
  public func openPrivacyChoices() async {
    guard privacyChoices else { return }
    let answer = await platform.presentPrivacyOptions()
    privacyChoices = answer.privacyOptionsRequired
    if answer.canRequestAds { await startMobileAds() }
  }

  /// The start flow (`start(firstRun:)`).
  private func ask() async {
    _ = await platform.updateConsent { kept in
      // Consent kept from an earlier launch: Mobile Ads starts while the update is out.
      if kept.canRequestAds { Task { await self.startMobileAds() } }
    }
    let answer = await platform.presentConsentFormIfRequired()
    privacyChoices = answer.privacyOptionsRequired
    if answer.canRequestAds {
      await startMobileAds()
    } else if !started {
      phase = .withheld
    }
  }

  /// Starts Mobile Ads, once; then the ads are on, and what may load now loads.
  private func startMobileAds() async {
    guard !started else { return }
    started = true
    await platform.startAds()
    phase = .on
    show(.home)
    for view in AppView.allCases where shownViews.contains(view) { show(.pageEnd(view)) }
    loadInterstitial()
  }

  // MARK: - The banners

  /// The home screen's width as laid out: sets `homeBannerHeight` and loads the home banner at
  /// that width, once on (again only if the width changes). No width (zero, as before the
  /// layout) asks for nothing.
  public func homeWidth(_ width: Double) {
    guard width > 0, width.isFinite else { return }
    widths[.home] = width
    show(.home)
  }

  /// A page's end box width as laid out; no width asks for nothing.
  public func pageEndWidth(_ view: AppView, _ width: Double) {
    guard width > 0, width.isFinite else { return }
    widths[.pageEnd(view)] = width
    show(.pageEnd(view))
  }

  /// A page is on screen (the view the pager shows). Its page-end banner loads the first time,
  /// once on and once its width is known: a page never shown asks for no ad.
  public func shown(_ view: AppView) {
    shownViews.insert(view)
    show(.pageEnd(view))
  }

  /// Loads `slot`'s banner once the ads are on, its width is known and, for a page's end, the
  /// page was shown; again only at another width. The home band's height comes with it.
  private func show(_ slot: AdSlot) {
    guard phase == .on, let width = widths[slot], loadedWidths[slot] != width else { return }
    if case .pageEnd(let view) = slot, !shownViews.contains(view) { return }
    if slot == .home { homeBannerHeight = platform.homeBannerHeight(width: width) }
    loadedWidths[slot] = width
    platform.loadBanner(slot, width: width)
  }

  /// A banner's news: an ad resets its failures, and a load again still waiting is called off; a
  /// failure asks again, at the same width, after the wait for that many in a row, unless a load
  /// again is waiting already.
  private func heard(_ event: BannerEvent, from slot: AdSlot) {
    switch event {
    case .loaded:
      failures[slot] = nil
      retries[slot]?.cancel()
      retries[slot] = nil
    case .failed:
      let count = (failures[slot] ?? 0) + 1
      failures[slot] = count
      guard retries[slot] == nil else { return }
      let at = clock.now.addingTimeInterval(AdRules.retryDelay(failures: count))
      retries[slot] = clock.schedule(at: at) { [weak self] in self?.loadAgain(slot) }
    }
  }

  private func loadAgain(_ slot: AdSlot) {
    retries[slot] = nil
    guard let width = loadedWidths[slot] else { return }
    platform.loadBanner(slot, width: width)
  }

  // MARK: - The full-screen ad

  /// The user chose a place in the picker the place pill opened: shows the full-screen ad if one is due
  /// (`AdRules.interstitialDue`), loaded and fresh, then calls `done` once it closes; otherwise
  /// calls `done` at once. Keeps when it showed (saved as it is asked to show, put back if it
  /// couldn't), then loads the next. A stale one is dropped and another loaded, and nothing shows;
  /// so is one that failed to load, for a later choice. A choice never waits for an ad to load.
  public func placeChosen(then done: @escaping @MainActor () -> Void) {
    let now = clock.now
    if let loadedAt = interstitialLoadedAt,
      !AdRules.interstitialFresh(loadedAt: loadedAt, now: now)
    {
      interstitialLoadedAt = nil
    }
    let last = store.loadLastInterstitial()
    guard interstitialLoadedAt != nil,
      AdRules.interstitialDue(lastShown: last, now: now, firstRun: firstRun)
    else {
      loadInterstitial()
      done()
      return
    }
    // An ad shows once: the next is loaded once this one closes.
    interstitialLoadedAt = nil
    store.saveLastInterstitial(now)
    Task {
      let shown = await platform.presentInterstitial()
      if !shown { store.saveLastInterstitial(last) }
      done()
      loadInterstitial()
    }
  }

  /// Loads a full-screen ad, unless one is on hand or loading: only once the ads are on, and
  /// never in the app's first run.
  private func loadInterstitial() {
    guard phase == .on, !firstRun, interstitialLoadedAt == nil, !loadingInterstitial else {
      return
    }
    loadingInterstitial = true
    Task {
      let loaded = await platform.loadInterstitial()
      loadingInterstitial = false
      if loaded { interstitialLoadedAt = clock.now }
    }
  }
}
