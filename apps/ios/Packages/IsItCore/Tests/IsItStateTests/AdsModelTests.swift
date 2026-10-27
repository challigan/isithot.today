import Foundation
import IsItLogic
import IsItModel
import IsItState
import Testing

/// Launch step 5 (iOS build spec, section 14.2): UMP's consent, then Mobile Ads, with a fake SDK.
/// The start returns at once, so the launch's later steps never wait on the consent form.
@MainActor
@Suite("The ads' start")
struct AdsStartTests {
  @Test("returns at once, and the ads come on once UMP has answered")
  func returnsAtOnce() async {
    let ads = AdsHarness(consent: .unknown, holding: [.update])
    ads.platform.afterUpdate = .outside
    ads.model.start(firstRun: true)
    #expect(ads.model.phase == .asking)
    #expect(await yieldUntil { ads.platform.calls == ["updateConsent"] })
    await settle()
    #expect(ads.model.phase == .asking)
    #expect(ads.platform.calls == ["updateConsent"])
    ads.platform.release(.update)
    #expect(await yieldUntil { ads.model.phase == .on })
    #expect(ads.platform.calls == ["updateConsent", "presentConsentForm", "startAds"])
  }

  @Test("no consent kept: the update, the consent form, then Mobile Ads")
  func order() async {
    let ads = AdsHarness(consent: .unknown)
    ads.platform.afterUpdate = .required
    ads.platform.afterForm = .consented
    ads.model.start(firstRun: true)
    #expect(await yieldUntil { ads.model.phase == .on })
    #expect(ads.platform.calls == ["updateConsent", "presentConsentForm", "startAds"])
    #expect(ads.model.privacyChoices)
  }

  @Test("consent kept from an earlier launch: Mobile Ads starts alongside the update, once")
  func keptConsent() async {
    let ads = AdsHarness(consent: .consented, holding: [.update])
    ads.model.start(firstRun: true)
    #expect(await yieldUntil { ads.model.phase == .on })
    #expect(ads.platform.calls == ["updateConsent", "startAds"])
    // Privacy choices waits for this launch's answer.
    #expect(!ads.model.privacyChoices)
    ads.platform.release(.update)
    #expect(await yieldUntil { ads.model.privacyChoices })
    await settle()
    #expect(ads.platform.calls == ["updateConsent", "startAds", "presentConsentForm"])
    #expect(ads.model.phase == .on)
  }

  @Test("UMP says no: no Mobile Ads, no banners, no full-screen ad and no Privacy choices")
  func withheld() async {
    let ads = AdsHarness(consent: .unknown)
    ads.model.homeWidth(390)
    ads.model.shown(.today)
    ads.model.pageEndWidth(.today, 358)
    ads.model.start(firstRun: false)
    #expect(await yieldUntil { ads.model.phase == .withheld })
    ads.model.homeWidth(430)
    ads.model.shown(.week)
    ads.model.pageEndWidth(.week, 358)
    let done = ads.choose()
    await settle()
    #expect(done.read { $0 } == 1)
    #expect(ads.platform.calls == ["updateConsent", "presentConsentForm"])
    #expect(!ads.model.privacyChoices)
    #expect(ads.model.homeBannerHeight == nil)
    #expect(ads.model.phase == .withheld)
  }

  @Test("Privacy choices follows UMP's answer, and its form can turn the ads on")
  func privacyChoices() async {
    let ads = AdsHarness(consent: .unknown)
    ads.platform.afterUpdate = .required
    ads.model.homeWidth(390)
    ads.model.start(firstRun: true)
    #expect(await yieldUntil { ads.model.phase == .withheld })
    #expect(ads.model.privacyChoices)
    // The user consents in the privacy options form.
    ads.platform.afterPrivacyOptions = .consented
    await ads.model.openPrivacyChoices()
    #expect(ads.model.phase == .on)
    #expect(ads.model.privacyChoices)
    #expect(ads.model.homeBannerHeight == 61)
    // The form no longer required: the row goes, and Mobile Ads isn't started again.
    ads.platform.afterPrivacyOptions = .outside
    await ads.model.openPrivacyChoices()
    #expect(!ads.model.privacyChoices)
    #expect(ads.model.phase == .on)
    #expect(
      ads.platform.calls == [
        "updateConsent", "presentConsentForm", "presentPrivacyOptions", "startAds",
        "bannerHeight 390", "banner home 390", "presentPrivacyOptions",
      ])
  }

  @Test("Privacy choices does nothing while Settings doesn't show it, as before the ads start")
  func privacyChoicesHidden() async {
    let idle = AdsHarness(consent: .consented)
    await idle.model.openPrivacyChoices()
    #expect(idle.platform.calls.isEmpty)
    #expect(idle.model.phase == .idle)

    let outside = AdsHarness()
    #expect(await outside.on(firstRun: true))
    #expect(!outside.model.privacyChoices)
    await outside.model.openPrivacyChoices()
    #expect(!outside.platform.calls.contains("presentPrivacyOptions"))
  }

  @Test("a second start does nothing, its first run and all")
  func startOnce() async {
    let ads = AdsHarness()
    ads.model.start(firstRun: true)
    ads.model.start(firstRun: false)
    #expect(await yieldUntil { ads.model.phase == .on })
    ads.model.start(firstRun: false)
    await settle()
    #expect(ads.platform.calls.filter { $0 == "updateConsent" }.count == 1)
    #expect(ads.platform.calls.filter { $0 == "startAds" }.count == 1)
    #expect(ads.platform.interstitialCalls.isEmpty)
  }
}

/// The banners (spec 14.1, as phase 8.3 widened it): the home band, its space kept from the
/// moment the ads come on, and a banner at the end of each page shown; each asked for once a
/// width, and asked for again after a failure.
@MainActor
@Suite("The ads' banners")
struct AdsBannerTests {
  @Test("the home band: its height and its banner once the ads are on and its width known")
  func home() async {
    let early = AdsHarness(consent: .unknown, holding: [.update])
    early.platform.afterUpdate = .outside
    early.model.homeWidth(390)
    early.model.start(firstRun: true)
    #expect(await yieldUntil { early.platform.calls.contains("updateConsent") })
    #expect(early.model.homeBannerHeight == nil)
    early.platform.release(.update)
    #expect(await yieldUntil { early.model.phase == .on })
    #expect(early.model.homeBannerHeight == 61)
    #expect(early.platform.bannerCalls == ["bannerHeight 390", "banner home 390"])

    let late = AdsHarness()
    #expect(await late.on(firstRun: true))
    #expect(late.model.homeBannerHeight == nil)
    #expect(late.platform.bannerCalls.isEmpty)
    late.model.homeWidth(390)
    #expect(late.model.homeBannerHeight == 61)
    #expect(late.platform.bannerCalls == ["bannerHeight 390", "banner home 390"])
  }

  @Test("the home banner is asked for once a width: again only when the width changes")
  func homeWidths() async {
    let ads = AdsHarness()
    #expect(await ads.on(firstRun: true))
    ads.model.homeWidth(390)
    ads.model.homeWidth(390)
    ads.platform.bannerHeight = 66
    ads.model.homeWidth(430)
    // No width yet, as before the layout: nothing asked for, and the band stays.
    for nothing in [0, -1, Double.nan, .infinity] { ads.model.homeWidth(nothing) }
    ads.model.homeWidth(430)
    #expect(ads.model.homeBannerHeight == 66)
    #expect(
      ads.platform.bannerCalls == [
        "bannerHeight 390", "banner home 390", "bannerHeight 430", "banner home 430",
      ])
  }

  @Test("a page's end: once the page is shown, its width known and the ads on, in any order")
  func pageEnd() async {
    let ads = AdsHarness()
    ads.model.shown(.today)
    ads.model.pageEndWidth(.today, 358)
    ads.model.shown(.now)
    #expect(await ads.on(firstRun: true))
    #expect(ads.platform.bannerCalls == ["banner today 358"])
    ads.model.pageEndWidth(.now, 358)
    #expect(ads.platform.bannerCalls == ["banner today 358", "banner now 358"])
    ads.model.pageEndWidth(.week, 358)
    #expect(ads.platform.bannerCalls == ["banner today 358", "banner now 358"])
    ads.model.shown(.week)
    #expect(ads.platform.bannerCalls == ["banner today 358", "banner now 358", "banner week 358"])
  }

  @Test("each page's end asked for once: shown again and laid out again, nothing more")
  func pageEndOnce() async {
    let ads = AdsHarness()
    #expect(await ads.on(firstRun: true))
    ads.model.shown(.now)
    ads.model.pageEndWidth(.now, 358)
    for view in [AppView.today, .now, .today, .now] { ads.model.shown(view) }
    ads.model.pageEndWidth(.now, 358)
    ads.model.pageEndWidth(.now, 0)
    #expect(ads.platform.bannerCalls == ["banner now 358"])
  }

  @Test("never for a page never shown")
  func neverShown() async {
    let ads = AdsHarness()
    for view in AppView.allCases { ads.model.pageEndWidth(view, 358) }
    #expect(await ads.on(firstRun: true))
    for view in AppView.allCases { ads.model.pageEndWidth(view, 358) }
    ads.model.homeWidth(390)
    await settle()
    #expect(ads.platform.bannerCalls == ["bannerHeight 390", "banner home 390"])
  }

  @Test("a failed banner is asked for again after 60, 120, 240, 480, 600 and 600 seconds")
  func retries() async {
    let ads = AdsHarness()
    #expect(await ads.on(firstRun: true))
    ads.model.homeWidth(390)
    var at = AdsHarness.moment
    for wait in [60.0, 120, 240, 480, 600, 600] {
      ads.platform.tell(.home, .failed)
      at = later(at, seconds: wait)
      #expect(ads.clock.pending == [at], "\(wait) seconds")
      #expect(await ads.clock.runNext())
      #expect(ads.platform.calls.last == "banner home 390", "\(wait) seconds")
    }
    #expect(ads.platform.bannerCalls.filter { $0 == "banner home 390" }.count == 7)
    // An ad arrives; a failure after it, a failed refresh, waits 60 seconds again.
    ads.platform.tell(.home, .loaded)
    ads.platform.tell(.home, .failed)
    #expect(ads.clock.pending == [later(at, seconds: 60)])
  }

  @Test("one load again at a time for a slot, each slot counting its own failures")
  func retryEachSlot() async {
    let ads = AdsHarness()
    #expect(await ads.on(firstRun: true))
    ads.model.homeWidth(390)
    ads.model.shown(.now)
    ads.model.pageEndWidth(.now, 358)
    ads.platform.tell(.home, .failed)
    ads.platform.tell(.home, .failed)
    ads.platform.tell(.pageEnd(.now), .failed)
    let minute = later(AdsHarness.moment, seconds: 60)
    #expect(ads.clock.pending == [minute, minute])
    #expect(await ads.clock.runNext())
    #expect(await ads.clock.runNext())
    #expect(await ads.clock.runNext() == false)
    #expect(
      ads.platform.bannerCalls == [
        "bannerHeight 390", "banner home 390", "banner now 358", "banner home 390",
        "banner now 358",
      ])
    ads.platform.tell(.pageEnd(.now), .failed)
    #expect(ads.clock.pending == [later(minute, seconds: 120)])
  }
}

/// The full-screen ad (phase 8.3): only as the user chooses a place, at most once every 5
/// minutes, never in the app's first run, and only one already loaded and fresh, so a choice
/// never waits for an ad to load.
@MainActor
@Suite("The full-screen ad")
struct AdsInterstitialTests {
  @Test("none in the app's first run: none loaded, none shown")
  func firstRun() async {
    let ads = AdsHarness()
    #expect(await ads.on(firstRun: true))
    #expect(ads.choose().read { $0 } == 1)
    await settle()
    #expect(ads.platform.interstitialCalls.isEmpty)
    #expect(!ads.model.interstitialReady)
  }

  @Test("before the ads are on, or with them withheld: done at once, and nothing shown")
  func notOn() async {
    let idle = AdsHarness()
    #expect(idle.choose().read { $0 } == 1)

    let asking = AdsHarness(consent: .unknown, holding: [.update])
    asking.model.start(firstRun: false)
    #expect(await yieldUntil { asking.platform.calls.contains("updateConsent") })
    #expect(asking.choose().read { $0 } == 1)

    let withheld = AdsHarness(consent: .unknown)
    withheld.model.start(firstRun: false)
    #expect(await yieldUntil { withheld.model.phase == .withheld })
    #expect(withheld.choose().read { $0 } == 1)

    await settle()
    for ads in [idle, asking, withheld] {
      #expect(ads.platform.interstitialCalls.isEmpty)
      #expect(ads.store.loadLastInterstitial() == nil)
    }
    asking.platform.release(.update)
  }

  @Test("due and loaded: shown, kept as it shows, done once it closes, then the next loaded")
  func shown() async {
    let ads = AdsHarness(holding: [.presentInterstitial])
    #expect(await ads.on())
    #expect(ads.platform.interstitialCalls == ["loadInterstitial"])
    #expect(ads.model.interstitialReady)
    ads.clock.now = later(AdsHarness.moment, minutes: 2)
    let done = ads.choose()
    #expect(!ads.model.interstitialReady)
    #expect(ads.store.loadLastInterstitial() == ads.clock.now)
    #expect(await yieldUntil { ads.platform.calls.last == "presentInterstitial" })
    await settle()
    #expect(done.read { $0 } == 0)
    ads.platform.release(.presentInterstitial)
    #expect(await yieldUntil { done.read { $0 } == 1 })
    await settle()
    #expect(done.read { $0 } == 1)
    #expect(
      ads.platform.interstitialCalls == [
        "loadInterstitial", "presentInterstitial", "loadInterstitial",
      ])
    #expect(ads.store.loadLastInterstitial() == later(AdsHarness.moment, minutes: 2))
    #expect(ads.model.interstitialReady)
  }

  @Test("within 5 minutes of the last, kept from an earlier launch: done at once")
  func fiveMinutes() async {
    let ads = AdsHarness(lastShown: later(AdsHarness.moment, seconds: -299))
    #expect(await ads.on())
    #expect(ads.choose().read { $0 } == 1)
    await settle()
    #expect(ads.platform.interstitialCalls == ["loadInterstitial"])
    // 5 minutes after the last, it shows.
    ads.clock.now = later(AdsHarness.moment, seconds: 1)
    let done = ads.choose()
    #expect(await yieldUntil { done.read { $0 } == 1 })
    #expect(ads.platform.interstitialCalls.contains("presentInterstitial"))
    #expect(ads.store.loadLastInterstitial() == later(AdsHarness.moment, seconds: 1))
  }

  @Test("loaded 55 minutes ago: dropped, not shown, and another loaded, which shows")
  func stale() async {
    let ads = AdsHarness()
    #expect(await ads.on())
    ads.clock.now = later(AdsHarness.moment, minutes: 55)
    #expect(ads.choose().read { $0 } == 1)
    await settle()
    #expect(ads.platform.interstitialCalls == ["loadInterstitial", "loadInterstitial"])
    #expect(ads.store.loadLastInterstitial() == nil)
    // The new one, 54:59 after it loaded.
    ads.clock.now = later(later(AdsHarness.moment, minutes: 109), seconds: 59)
    let done = ads.choose()
    #expect(await yieldUntil { done.read { $0 } == 1 })
    await settle()
    #expect(
      ads.platform.interstitialCalls == [
        "loadInterstitial", "loadInterstitial", "presentInterstitial", "loadInterstitial",
      ])
  }

  @Test("none loaded, or one still loading: done at once, and one asked for")
  func notLoaded() async {
    let failed = AdsHarness()
    failed.platform.interstitialLoads = false
    #expect(await failed.on())
    #expect(failed.choose().read { $0 } == 1)
    await settle()
    #expect(failed.platform.interstitialCalls == ["loadInterstitial", "loadInterstitial"])

    let loading = AdsHarness(holding: [.loadInterstitial])
    #expect(await loading.on())
    #expect(loading.choose().read { $0 } == 1)
    await settle()
    #expect(loading.platform.interstitialCalls == ["loadInterstitial"])
    #expect(loading.store.loadLastInterstitial() == nil)
    loading.platform.release(.loadInterstitial)
  }

  @Test("one that can't be shown: the last one shown put back, done, and another loaded")
  func presentationFails() async {
    let before = later(AdsHarness.moment, minutes: -6)
    for last in [before, nil] {
      let ads = AdsHarness(lastShown: last)
      ads.platform.interstitialPresents = false
      #expect(await ads.on())
      let done = ads.choose()
      #expect(await yieldUntil { done.read { $0 } == 1 })
      await settle()
      #expect(ads.store.loadLastInterstitial() == last)
      #expect(
        ads.platform.interstitialCalls == [
          "loadInterstitial", "presentInterstitial", "loadInterstitial",
        ])
    }
  }

  @Test("two choices in a row, while the ad shows or once it closed: one ad")
  func twoChoices() async {
    let ads = AdsHarness(holding: [.presentInterstitial])
    #expect(await ads.on())
    let first = ads.choose()
    #expect(await yieldUntil { ads.platform.calls.last == "presentInterstitial" })
    #expect(ads.choose().read { $0 } == 1)
    ads.platform.release(.presentInterstitial)
    #expect(await yieldUntil { first.read { $0 } == 1 })
    await settle()
    ads.clock.now = later(AdsHarness.moment, seconds: 10)
    #expect(ads.choose().read { $0 } == 1)
    await settle()
    #expect(ads.platform.interstitialCalls.filter { $0 == "presentInterstitial" }.count == 1)
    #expect(ads.store.loadLastInterstitial() == AdsHarness.moment)
  }
}
