import Foundation
import IsItLogic
import IsItModel
import IsItState

/// The App Group as the widget's store (spec 9.6): the same defaults and file the app writes.
extension SharedStore: WidgetStore {}

/// StoreKit's entitlements for the widget (spec 11.2 step 1, V3): read whole, as the app reads
/// them (`StoreKitFacts.entitlements()`); `WidgetTimeline` waits for them at most 2 s. Reading
/// only: a widget never buys, restores or calls `AppStore.sync()` (App Review 4.4).
public struct StoreKitEntitlements: EntitlementReader {
  public init() {}

  public func entitlements() async -> [PurchaseFact] {
    await StoreKitFacts.entitlements()
  }
}

extension URLSessionTransport {
  /// The widget's session: section 4's settings, and a limit on the whole request
  /// (`timeoutIntervalForResource`, `Constants.Client.requestTimeoutMs`), as the app's 12 s are
  /// idle timers and the system may stop an extension mid-request (spec 11.2 step 4).
  public static func widgetSession() -> URLSession {
    let configuration = configuration()
    configuration.timeoutIntervalForResource =
      TimeInterval(Constants.Client.requestTimeoutMs) / 1000
    return URLSession(configuration: configuration)
  }
}

extension WidgetTimeline {
  /// The extension's one session, made once a process: a session never invalidated is kept
  /// until the process ends (Apple, `URLSession`), so one is made per process, not per timeline.
  private static let session = URLSessionTransport.widgetSession()

  /// The widget's timeline from `bundle`'s Info.plist (the extension passes `.main`): its App
  /// Group with no fallback (a container of the widget's own would hold no answer and no
  /// purchase), the API it names (`IsItAPIOrigin`), StoreKit's entitlements and the process's
  /// one gate; nil without the group. WidgetBundleTests calls it with the embedded appex's
  /// bundle, so the extension's own factory is tested against the extension's own plist.
  public static func live(in bundle: Bundle) -> WidgetTimeline? {
    guard let id = SharedStore.appGroupID(in: bundle),
      let store = SharedStore.open(appGroup: id, fallback: false)
    else { return nil }
    let client = APIClient(
      origin: APIClient.origin(in: bundle) ?? APIClient.defaultOrigin,
      transport: URLSessionTransport(session: session))
    return WidgetTimeline(
      store: store, client: client, entitlements: StoreKitEntitlements(), gate: .shared)
  }
}
