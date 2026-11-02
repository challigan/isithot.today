import XCTest

/// The one UI test that meets the system's notification prompt (iOS build spec, section 12.4):
/// Leeds with `-notifications system`, the real notification centre, its token still the
/// stand-in's, which the devices stub knows, so no real token is made or sent (DebugHooks.swift).
/// The prompt is SpringBoard's alert, over the app, so the test finds it through SpringBoard and
/// waits for it: not through an interruption monitor, which handles only an alert that blocks an
/// element a test needs (Apple, "Handling UI interruptions"), and which SpringBoard's alerts have
/// not reached since iOS 17. The prompt is attached for the contact sheet and not audited, as it
/// is the system's. Allowed, the evening switch turns on and the phone registers. Notifications
/// stay allowed on the simulator, which the banner step after the UI plan needs (ci/push.sh);
/// every other UI test uses the stand-in, which never asks the real centre. With no prompt
/// because an earlier run on this simulator allowed them, the test skips, saying how to meet it
/// again; with none and the switch off, it fails with SpringBoard's tree and the app's.
final class NotificationPermissionTests: XCTestCase {
  override func setUpWithError() throws {
    continueAfterFailure = false
  }

  /// The prompt comes at the first switch turned on, and "Allow" turns it on and registers.
  @MainActor
  func testTheSystemPromptAllows() throws {
    let app = XCUIApplication()
    app.launchArguments = [
      "-uitest", "-noads", "1", "-clock", "fixed", "-resetStore", "-fixture", "leeds-dry",
      "-place", "place=leeds-gb", "-notifications", "system",
    ]
    app.launch()
    XCTAssertTrue(app.staticTexts["verdict"].waitForExistence(timeout: 15), "No answer on screen")
    // The gear as every UI test taps it: once more only when the system cancelled the touch
    // (`watchedTap`) and no Settings opened (SettingsTests' `openSettings`).
    let gear = app.buttons["settings"]
    watchedTap("the gear", in: app, until: { !app.sheetClosed }, { gear.tap() })
    XCTAssertTrue(
      app.buttons["close-settings"].waitForExistence(timeout: 5),
      "No Settings after tapping the gear; \(app.cancelsReport); \(app.homeGeometry)")
    let evening = app.find("notify-evening")
    try reveal(evening, in: app)
    XCTAssertEqual(isOn(evening), false, "The evening switch is on at a first launch")
    let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    let prompt = springboard.alerts.firstMatch
    // What the switch's tap brings: the system's prompt, or, where an earlier run allowed
    // notifications, the switch on. Allow, in SpringBoard's alert, can't be watched: the app's
    // count sees only its own touches.
    watchedTap(
      "notify-evening", in: app, until: { prompt.exists || isOn(evening) == true },
      { evening.tap() })
    if prompt.waitForExistence(timeout: 10) {
      attach(springboard, as: "system-notification-prompt")
      // As an English simulator words it ("Don’t Allow", beside it, has U+2019).
      let allow = prompt.buttons["Allow"]
      guard allow.exists else {
        attachText(springboard.debugDescription, as: "springboard-tree")
        XCTFail("The notification prompt has no Allow: \(prompt.label)")
        return
      }
      allow.tap()
    } else if isOn(evening) == true {
      throw XCTSkip(
        "No prompt, as an earlier run on this simulator allowed notifications: erase the "
          + "simulator, or delete the app from it, to meet the prompt again")
    } else {
      attachText(springboard.debugDescription, as: "springboard-tree")
      attachText(app.debugDescription, as: "app-tree")
      XCTFail(
        "No notification prompt 10 seconds after turning the evening notification on; "
          + app.cancelsReport)
      return
    }

    try expectOn(evening, in: app)
    let privacy = app.buttons["your-privacy"]
    try reveal(privacy, in: app)
    watchedTap(
      "your-privacy", in: app, until: { app.showsPage(titled: "Your privacy") }, { privacy.tap() })
    XCTAssertTrue(
      app.find("kept-line-0").waitForExistence(timeout: 10),
      "Your privacy keeps nothing; \(app.cancelsReport)")
  }

  // MARK: - Helpers

  /// Whether a switch is on, from its value: "1" on and "0" off, nil for anything else
  /// (NotificationsTests' `isOn`).
  @MainActor
  private func isOn(_ element: XCUIElement) -> Bool? {
    switch element.value as? String {
    case "1": true
    case "0": false
    default: nil
    }
  }

  /// Waits up to 10 seconds for the switch `element` to be on, read four times a second; throws,
  /// saying what it read and `app`'s `debug-cancels`, when it isn't.
  @MainActor
  private func expectOn(_ element: XCUIElement, in app: XCUIApplication) throws {
    let deadline = Date().addingTimeInterval(10)
    while isOn(element) != true {
      guard Date() < deadline else {
        let value = element.exists ? "\(element.value ?? "no value")" : "nothing, not being there"
        throw HomeScreenError(
          "\(element) never turned on once allowed; its value: \(value); \(app.cancelsReport)")
      }
      RunLoop.current.run(until: Date().addingTimeInterval(0.25))
    }
  }

  /// Swipes Settings until `element` lies whole on screen, below the navigation bar and within the
  /// window, at most six times, up while it is below the window's middle and down while above;
  /// throws, with where it was, when it never does.
  @MainActor
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) throws {
    guard element.waitForExistence(timeout: 10) else {
      throw HomeScreenError("No \(element) in Settings")
    }
    var swipes = 0
    while !whole(element, in: app) && swipes < 6 {
      if element.frame.midY < app.frame.midY { app.swipeDown() } else { app.swipeUp() }
      swipes += 1
    }
    guard whole(element, in: app) else {
      throw HomeScreenError(
        "\(element) at \(element.frame) never came whole on screen; \(app.cancelsReport)")
    }
  }

  /// Whether `element` is hittable, has stopped moving, and lies whole between the navigation
  /// bar's foot and the window's.
  @MainActor
  private func whole(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.exists, element.isHittable else { return false }
    let frame = settledFrame(of: element)
    let bar = app.navigationBars.firstMatch
    let top = bar.exists ? bar.frame.maxY : app.frame.minY
    return frame.minY >= top - 0.5 && frame.maxY <= app.frame.maxY + 0.5
  }
}
