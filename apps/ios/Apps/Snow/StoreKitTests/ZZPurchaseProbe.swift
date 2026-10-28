import Foundation
import StoreKit
import StoreKitTest
import UIKit
import XCTest

// PROBE ONLY, never merged: each test buys the app's product one way, from a cleared test
// environment, and notes what StoreKit answered ("PROBE B: threw ..."), never failing. Named to
// run after PurchaseServiceTests, so a purchase left waiting here can't reach those tests.

@MainActor
private final class Box {
  var answer: String?
}

private enum ProbeStop: Error {
  case noProduct
  case noScene
  case noFile
}

@MainActor
final class ZZPurchaseProbe: XCTestCase {
  private let id = "today.willitsnow.app.unlock"
  private var session: SKTestSession?

  override func setUp() async throws {
    try await super.setUp()
    let session = try SKTestSession(contentsOf: snowStoreKitURL())
    try await Self.clear(session)
    self.session = session
  }

  override func tearDown() async throws {
    if let session {
      session.clearTransactions()
      session.resetToDefaultState()
    }
    session = nil
    try await super.tearDown()
  }

  private static func clear(_ session: SKTestSession) async throws {
    session.resetToDefaultState()
    session.clearTransactions()
    session.disableDialogs = true
    session.askToBuyEnabled = false
    try await session.setSimulatedError(nil, forAPI: .purchase)
    try await session.setSimulatedError(nil, forAPI: .verification)
    try await session.setSimulatedError(nil, forAPI: .appStoreSync)
  }

  // MARK: - The variants

  /// `purchase()` with no scene.
  func testA_plain() async throws {
    let product = try await load("A")
    await attempt("A") { try await product.purchase() }
  }

  /// `purchase(confirmIn:)` over the app's scene, as StoreKitPurchases buys.
  func testB_scene() async throws {
    let product = try await load("B")
    let scene = try appScene("B")
    await attempt("B") { try await product.purchase(confirmIn: scene) }
  }

  /// B with `Transaction.updates` listened to for a second first.
  func testC_listenerFirst() async throws {
    let product = try await load("C")
    let scene = try appScene("C")
    let listener = Task { @MainActor [weak self] in
      for await result in Transaction.updates {
        self?.note("C", "update \(Self.describe(result))")
      }
    }
    try await Task.sleep(for: .seconds(1))
    await attempt("C") { try await product.purchase(confirmIn: scene) }
    try await Task.sleep(for: .seconds(1))
    listener.cancel()
  }

  /// B three seconds after the session's settings, in case they reach storekitd late.
  func testD_waitFirst() async throws {
    let product = try await load("D")
    let scene = try appScene("D")
    try await Task.sleep(for: .seconds(3))
    await attempt("D") { try await product.purchase(confirmIn: scene) }
  }

  /// B from a copy of Snow.storekit whose own settings disable the dialogs.
  func testE_fileDisablesDialogs() async throws {
    session?.clearTransactions()
    session = nil
    let url = try dialogsOffCopy()
    let session = try SKTestSession(contentsOf: url)
    try await Self.clear(session)
    self.session = session
    note("E", "session from \(url.lastPathComponent)")
    let product = try await load("E")
    let scene = try appScene("E")
    await attempt("E") { try await product.purchase(confirmIn: scene) }
  }

  /// SKTestSession's own purchase, which isn't the app's.
  func testF_sessionBuys() async throws {
    let session = try XCTUnwrap(session)
    let started = Date()
    do {
      let transaction = try await session.buyProduct(identifier: id)
      note("F", "buyProduct → id \(transaction.id) after \(Self.since(started))")
    } catch {
      note("F", "buyProduct threw \(String(reflecting: error)) after \(Self.since(started))")
    }
    note("F", "transactions \(session.allTransactions().count)")
  }

  /// What the app, its scenes and StoreKit look like while the tests run.
  func testG_environment() async throws {
    let app = UIApplication.shared
    note("G", "iOS \(UIDevice.current.systemVersion), app state \(app.applicationState.rawValue)")
    for scene in app.connectedScenes {
      let windows = (scene as? UIWindowScene)?.windows ?? []
      let keys = windows.filter(\.isKeyWindow).count
      note(
        "G",
        "scene \(type(of: scene)) state \(scene.activationState.rawValue) windows \(windows.count) "
          + "key \(keys)")
    }
    note("G", "canMakePayments \(AppStore.canMakePayments)")
    let storefront = await Storefront.current
    note("G", "storefront \(storefront?.countryCode ?? "none")")
    if let session {
      note(
        "G",
        "session storefront \(session.storefront) locale \(session.locale.identifier) "
          + "dialogs off \(session.disableDialogs) ask to buy \(session.askToBuyEnabled)")
    }
  }

  /// B with the dialogs left on, given 15 seconds: a sheet StoreKit shows waits for a tap no
  /// test makes. Last, so a purchase left waiting runs into no other test.
  func testZ_dialogsOn() async throws {
    let session = try XCTUnwrap(session)
    session.disableDialogs = false
    let product = try await load("Z")
    let scene = try appScene("Z")
    let box = Box()
    let started = Date()
    Task { @MainActor in
      do {
        let result = try await product.purchase(confirmIn: scene)
        box.answer = Self.describe(result)
      } catch {
        box.answer = "threw \(String(reflecting: error))"
      }
    }
    for _ in 0..<30 where box.answer == nil {
      try await Task.sleep(for: .milliseconds(500))
    }
    note("Z", "\(box.answer ?? "no answer (a sheet?)") after \(Self.since(started))")
    let windows = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
    note("Z", "windows now \(windows.map { String(describing: type(of: $0)) })")
  }

  // MARK: - Helpers

  private func load(_ variant: String) async throws -> Product {
    let products = try await Product.products(for: [id])
    guard let product = products.first else {
      note(variant, "no product")
      throw ProbeStop.noProduct
    }
    note(variant, "product \(product.displayPrice)")
    return product
  }

  private func appScene(_ variant: String) throws -> UIWindowScene {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
    else {
      note(variant, "no scene")
      throw ProbeStop.noScene
    }
    note(variant, "scene state \(scene.activationState.rawValue)")
    return scene
  }

  private func attempt(_ variant: String, _ buy: () async throws -> Product.PurchaseResult) async {
    let started = Date()
    do {
      let result = try await buy()
      note(variant, "\(Self.describe(result)) after \(Self.since(started))")
      if case .success(.verified(let transaction)) = result { await transaction.finish() }
    } catch {
      note(variant, "threw \(String(reflecting: error)) after \(Self.since(started))")
    }
    note(variant, "transactions \(session?.allTransactions().count ?? -1)")
  }

  private func dialogsOffCopy() throws -> URL {
    let data = try Data(contentsOf: snowStoreKitURL())
    guard var json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      var settings = json["settings"] as? [String: Any]
    else { throw ProbeStop.noFile }
    settings["_disableDialogs"] = true
    json["settings"] = settings
    let copy = FileManager.default.temporaryDirectory
      .appendingPathComponent("ProbeDialogsOff.storekit")
    try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted, .sortedKeys])
      .write(to: copy, options: .atomic)
    return copy
  }

  private func note(_ variant: String, _ line: String) {
    let text = "PROBE \(variant): \(line)"
    print(text)
    NSLog("%@", text)
    XCTContext.runActivity(named: text) { _ in }
  }

  private static func since(_ started: Date) -> String {
    String(format: "%.2fs", Date().timeIntervalSince(started))
  }

  private static func describe(_ result: Product.PurchaseResult) -> String {
    switch result {
    case .success(let verification): "success, \(describe(verification))"
    case .pending: "pending"
    case .userCancelled: "userCancelled"
    @unknown default: "unknown"
    }
  }

  private static func describe(_ result: VerificationResult<Transaction>) -> String {
    switch result {
    case .verified(let transaction): "verified id \(transaction.id)"
    case .unverified(let transaction, let error): "unverified id \(transaction.id): \(error)"
    }
  }
}
