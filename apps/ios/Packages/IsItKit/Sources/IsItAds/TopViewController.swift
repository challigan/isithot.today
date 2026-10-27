import UIKit

/// The view controller on top of the app, which Google's forms and full-screen ad are shown
/// from: the root of the foreground scene's key window, then down what each presents, past one
/// on its way out. Over Settings, a SwiftUI sheet, the root is already presenting, so a form shown
/// from it would fail; from the sheet's own controller it shows over Settings.
@MainActor
enum TopViewController {
  /// The controller on top, or nil before the app has a window.
  static func find() -> UIViewController? {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
    var top = scene?.keyWindow?.rootViewController
    while let presented = top?.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }
}
