import Foundation
import IsItLogic
import IsItModel
import Testing

/// For sale at £1.99, with Family Sharing on unless said.
private func ready(shared: Bool = true) -> PurchaseState.Product {
  .ready(price: "£1.99", familyShareable: shared)
}

/// Every string the page shows, and the home row's.
private func allWords(_ page: UpgradePage, homeRow: String?) -> [String] {
  var all = [page.title, page.body, page.restore.title, page.close]
  all += [page.familySharing, page.outcome, page.restore.detail, homeRow].compactMap { $0 }
  switch page.buying {
  case .button(let title, _), .line(let title): all.append(title)
  case .loading, .none: break
  }
  return all
}

/// The upgrade page and the home row (spec 10.5 and 10.2), as plain values: the price only as
/// StoreKit gives it, and a line saying why when it can't sell.
@Suite("The upgrade page, as plain values")
struct UpgradePageTests {
  @Test("free, with a price: what it is, Family Sharing, Buy with the price, Restore purchase")
  func freeWithAPrice() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: ready()))
    #expect(page.title == AppCopy.upgradeTitle)
    #expect(page.title == "Remove ads and add widgets")
    #expect(page.body == AppCopy.upgradeBody)
    #expect(page.familySharing == AppCopy.familySharing)
    #expect(page.buying == .button("Buy for £1.99", busy: false))
    #expect(page.outcome == nil)
    #expect(page.restore.id == "sheet-restore")
    #expect(page.restore.title == AppCopy.restore)
    #expect(page.restore.action == .restore)
    #expect(page.restore.icon == .restore)
    #expect(page.restore.detail == nil)
    #expect(!page.restore.busy)
    #expect(page.close == CoreCopy.close)
  }

  @Test("a product not shared says nothing of Family Sharing")
  func notSharedSaysNothingOfFamilySharing() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: ready(shared: false)))
    #expect(page.familySharing == nil)
    #expect(page.buying == .button("Buy for £1.99", busy: false))
  }

  @Test("before StoreKit answers: a spinner, and nothing said of Family Sharing")
  func whileLoading() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: .loading))
    #expect(page.buying == .loading)
    #expect(page.familySharing == nil)
  }

  @Test("nothing for sale: a line saying so, to try again later")
  func unavailable() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: .unavailable))
    #expect(page.buying == .line("The purchase isn't available right now. Try again later."))
    #expect(page.familySharing == nil)
  }

  @Test("payments turned off on the phone: a line saying so")
  func blocked() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: .blocked))
    #expect(page.buying == .line(AppCopy.purchasesOff))
  }

  @Test("while StoreKit buys, the button is busy")
  func whileBuying() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: ready(), attempt: .buying))
    #expect(page.buying == .button("Buy for £1.99", busy: true))
    #expect(page.outcome == nil)
  }

  @Test("Ask to Buy: waiting for approval, with the button still there to ask again")
  func pending() {
    let page = UpgradePage(unlocked: false, purchase: .init(product: ready(), attempt: .pending))
    #expect(page.outcome == AppCopy.pending)
    #expect(page.buying == .button("Buy for £1.99", busy: false))
  }

  @Test("a failure says StoreKit's own words; none when it gave none")
  func failed() {
    let failed = UpgradePage(
      unlocked: false,
      purchase: .init(product: ready(), attempt: .failed("Cannot connect to the App Store.")))
    #expect(failed.outcome == "Cannot connect to the App Store.")
    #expect(failed.buying == .button("Buy for £1.99", busy: false))
    let empty = UpgradePage(
      unlocked: false, purchase: .init(product: ready(), attempt: .failed("")))
    #expect(empty.outcome == nil)
  }

  @Test("owned: nothing to buy, and the thanks, whatever the product and the last tap")
  func owned() {
    let products: [PurchaseState.Product] = [.loading, .unavailable, .blocked, ready()]
    let attempts: [PurchaseState.Attempt] = [.idle, .buying, .pending, .failed("x")]
    for product in products {
      for attempt in attempts {
        let page = UpgradePage(unlocked: true, purchase: .init(product: product, attempt: attempt))
        #expect(page.buying == .none, "\(product) \(attempt)")
        #expect(page.outcome == AppCopy.thanks, "\(product) \(attempt)")
        #expect(page.restore.id == "sheet-restore")
      }
    }
  }

  @Test("Restore purchase: busy while restoring, then its result beneath it")
  func restoreResults() {
    func row(_ restore: PurchaseState.Restore) -> SettingsScreen.Row {
      UpgradePage(unlocked: false, purchase: .init(product: ready(), restore: restore)).restore
    }
    #expect(row(.restoring).busy)
    #expect(row(.restoring).detail == nil)
    #expect(row(.restored).detail == AppCopy.restored)
    #expect(!row(.restored).busy)
    #expect(row(.nothingFound).detail == AppCopy.nothingToRestore)
    #expect(row(.failed("x")).detail == "x")
    #expect(row(.failed("")).detail == nil)
    #expect(row(.idle).detail == nil)
  }

  @Test("the home row: in the free version once StoreKit has a price, and never otherwise")
  func homeRowOnlyFreeWithAPrice() {
    #expect(
      UpgradePage.homeRow(unlocked: false, purchase: .init(product: ready()))
        == AppCopy.upgradeRow(price: "£1.99"))
    #expect(UpgradePage.homeRow(unlocked: true, purchase: .init(product: ready())) == nil)
    for product in [PurchaseState.Product.loading, .unavailable, .blocked] {
      #expect(UpgradePage.homeRow(unlocked: false, purchase: .init(product: product)) == nil)
    }
  }

  @Test("no word names another app, site or weather, in any state")
  func snowOnly() {
    let products: [PurchaseState.Product] = [
      .loading, .unavailable, .blocked, ready(), ready(shared: false),
    ]
    let attempts: [PurchaseState.Attempt] = [
      .idle, .buying, .pending, .failed("Cannot connect to the App Store."),
    ]
    let restores: [PurchaseState.Restore] = [
      .idle, .restoring, .restored, .nothingFound, .failed("x"),
    ]
    for unlocked in [false, true] {
      for product in products {
        for attempt in attempts {
          for restore in restores {
            let purchase = PurchaseState(product: product, attempt: attempt, restore: restore)
            let page = UpgradePage(unlocked: unlocked, purchase: purchase)
            let row = UpgradePage.homeRow(unlocked: unlocked, purchase: purchase)
            for word in allWords(page, homeRow: row) {
              #expect(otherTopic(in: word) == nil, "\(word)")
              #expect(!word.isEmpty)
            }
          }
        }
      }
    }
  }
}
