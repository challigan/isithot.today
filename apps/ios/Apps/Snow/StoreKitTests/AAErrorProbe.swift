import Foundation
import StoreKit
import StoreKitTest
import XCTest

// PROBE ONLY, never merged. Each test buys the app's product with plain `purchase()` after
// touching SKTestSession's simulated errors one way, and notes what the session says the
// purchase API's simulated error is and what the purchase came to ("PROBE E: ..."), never
// failing. Run first, on a fresh simulator, in this order (XCTest runs a class's tests by name).

@MainActor
final class AAErrorProbe: XCTestCase {
  private let id = "today.willitsnow.app.unlock"

  /// No simulated error touched: a session, its transactions cleared, its dialogs off.
  func testA_untouched() async throws {
    let session = try fresh()
    await buy("A untouched", session)
  }

  /// `resetToDefaultState()` only, then the dialogs off again.
  func testB_resetOnly() async throws {
    let session = try fresh()
    session.resetToDefaultState()
    session.disableDialogs = true
    await buy("B reset", session)
  }

  /// `setSimulatedError(nil, forAPI: .verification)` and `.appStoreSync`, not `.purchase`.
  func testC_nilOtherAPIs() async throws {
    let session = try fresh()
    try await session.setSimulatedError(nil, forAPI: .verification)
    try await session.setSimulatedError(nil, forAPI: .appStoreSync)
    await buy("C nil verification and sync", session)
  }

  /// `setSimulatedError(nil, forAPI: .purchase)`.
  func testD_nilPurchase() async throws {
    let session = try fresh()
    try await session.setSimulatedError(nil, forAPI: .purchase)
    await buy("D nil purchase", session)
  }

  /// D's state, then `resetToDefaultState()`.
  func testE_nilThenReset() async throws {
    let session = try fresh()
    try await session.setSimulatedError(nil, forAPI: .purchase)
    session.resetToDefaultState()
    session.disableDialogs = true
    await buy("E nil then reset", session)
  }

  /// Nothing touched again, after D and E: whether a nil error outlives its session.
  func testF_untouchedAgain() async throws {
    let session = try fresh()
    await buy("F untouched again", session)
  }

  /// A real error, then nil.
  func testG_errorThenNil() async throws {
    let session = try fresh()
    try await session.setSimulatedError(.purchase(.productUnavailable), forAPI: .purchase)
    try await session.setSimulatedError(nil, forAPI: .purchase)
    await buy("G error then nil", session)
  }

  /// A real error, then `resetToDefaultState()`.
  func testH_errorThenReset() async throws {
    let session = try fresh()
    try await session.setSimulatedError(.purchase(.productUnavailable), forAPI: .purchase)
    session.resetToDefaultState()
    session.disableDialogs = true
    await buy("H error then reset", session)
  }

  /// Nothing touched, last.
  func testI_untouchedLast() async throws {
    let session = try fresh()
    await buy("I untouched last", session)
  }

  // MARK: - Helpers

  private func fresh() throws -> SKTestSession {
    let session = try SKTestSession(contentsOf: snowStoreKitURL())
    session.clearTransactions()
    session.disableDialogs = true
    session.askToBuyEnabled = false
    return session
  }

  private func buy(_ variant: String, _ session: SKTestSession) async {
    do {
      let error = try await session.simulatedError(forAPI: .purchase)
      note(variant, "simulated purchase error \(error.map { String(reflecting: $0) } ?? "none")")
    } catch {
      note(variant, "simulatedError threw \(String(reflecting: error))")
    }
    do {
      guard let product = try await Product.products(for: [id]).first else {
        return note(variant, "no product")
      }
      let result = try await product.purchase()
      switch result {
      case .success(.verified(let transaction)):
        note(variant, "success, verified id \(transaction.id)")
        await transaction.finish()
      case .success(.unverified(let transaction, let error)):
        note(variant, "success, unverified id \(transaction.id): \(error)")
      case .pending:
        note(variant, "pending")
      case .userCancelled:
        note(variant, "userCancelled")
      @unknown default:
        note(variant, "unknown result")
      }
    } catch {
      note(variant, "threw \(String(reflecting: error))")
    }
    note(variant, "transactions \(session.allTransactions().count)")
    session.clearTransactions()
  }

  private func note(_ variant: String, _ line: String) {
    let text = "PROBE \(variant): \(line)"
    print(text)
    NSLog("%@", text)
    XCTContext.runActivity(named: text) { _ in }
  }
}
