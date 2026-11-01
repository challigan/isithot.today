import IsItModel

extension BrandFont {
  /// The next face up, for Bold Text: Regular to Medium, Medium to SemiBold. SemiBold and the
  /// answer's face are as bold as the app's faces go. The app's text (IsItUI's `TextRole`) and the
  /// widget's step up by this one rule, as a custom font doesn't follow Bold Text on its own.
  public var bolder: BrandFont {
    switch self {
    case .textRegular: .textMedium
    case .textMedium: .textSemiBold
    case .textSemiBold, .answer: self
    }
  }
}
