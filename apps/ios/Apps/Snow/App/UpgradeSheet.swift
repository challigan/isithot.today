import IsItLogic
import IsItState
import IsItUI
import SwiftUI

/// The upgrade sheet the home row and `willitsnow://upgrade` open (iOS build spec, section
/// 10.5): IsItLogic's `UpgradePage` for the model's purchase, drawn by IsItUI's
/// `UpgradeSheetView`, with `PurchaseModel` behind its actions. Settings pushes the same page on
/// its own stack.
struct UpgradeSheet: View {
  let model: AppModel
  let purchases: PurchaseModel

  var body: some View {
    UpgradeSheetView(
      page: UpgradePage(unlocked: model.unlocked, purchase: purchases.state),
      actions: .live(purchases)
    )
  }
}

extension UpgradeActions {
  /// The actions on `purchases`: Buy and Restore purchase ask StoreKit; the page appearing asks
  /// for the product again if StoreKit hadn't answered; the page leaving takes a failure's line
  /// and the restore result with it.
  @MainActor
  static func live(_ purchases: PurchaseModel) -> UpgradeActions {
    UpgradeActions(
      buy: { Task { await purchases.buy() } },
      restore: { Task { await purchases.restore() } },
      appeared: { Task { await purchases.loadProduct() } },
      disappeared: { purchases.dismissResults() }
    )
  }
}
