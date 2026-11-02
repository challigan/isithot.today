import XCTest

/// The links a widget opens (iOS build spec, section 11.1): `willitsnow://view/week`, the
/// medium's right half, `view/today`, every family's tap with an answer, and `view/now`, the third
/// view a link can name, each opened in the app as a tap on a widget opens it
/// (`XCUIApplication.open(_:)` reaching `.onOpenURL`, as UpgradeTests' `willitsnow://upgrade`
/// does). XCUITest has no way to add a widget to the Home Screen, so this checks the app's side
/// only: the page each link lands on, as `tap(_:in:)` checks a tab's. It launches on
/// durham-tomorrow at 6:05pm, a city, so nothing asks for the location, and the app opens on Now.
/// It audits and attaches nothing: every page it reaches is one HomeAuditTests audits.
final class WidgetLinkTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// This week, then the middle view (Tomorrow, from 6pm), then Now: each link's heading, its
  /// tab selected, and its page the one on screen.
  @MainActor
  func testTheWidgetsLinksOpenTheirViews() throws {
    let screen = try HomeScreen.named("durham-tomorrow")
    let app = try launch(screen)
    for view in ["week", "today", "now"] {
      try open(view, of: screen, in: app)
    }
  }

  /// Opens `willitsnow://view/<view>` in `app`, and waits for `screen`'s page for it: its heading
  /// (`awaitHeading`), then its tab selected and reading the page's label (the one button
  /// `view-<view>`, IsItUI's `ViewSwitcher.identifier`, read from snapshots by `readElement`, the
  /// failure the last read's: the words too, as the query by them, `app.buttons[label]`, needed
  /// before, so Tomorrow's tab after 6pm is still told from Today's), for 10 seconds each, and
  /// only once both have come reads where the page is (`pageOffScreen`), as the tree lags the
  /// screen. The tree holds the chosen view's page wherever the pages are, so only its frame
  /// shows the link moved them.
  @MainActor
  private func open(_ view: String, of screen: HomeScreen, in app: XCUIApplication) throws {
    let page = try screen.page(view)
    let link = "willitsnow://view/\(view)"
    app.open(try XCTUnwrap(URL(string: link)))
    do {
      try awaitHeading(page.heading, in: app, timeout: 10)
    } catch {
      throw HomeScreenError("\(error) after \(link); \(app.homeGeometry)")
    }
    let tab = "view-\(view)"
    let selected = readElement(
      tab, .button, in: app, within: 10, "to be selected, reading \"\(page.label)\""
    ) {
      $0.one && $0.selected && $0.label == page.label
    }
    if let failure = selected {
      throw HomeScreenError(
        "After \(link), the tab \(tab) isn't selected, reading \"\(page.label)\": \(failure)")
    }
    if let off = app.pageOffScreen(view) {
      throw HomeScreenError("After \(link), \(off)")
    }
  }
}
