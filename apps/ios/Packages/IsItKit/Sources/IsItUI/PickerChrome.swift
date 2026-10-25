import IsItLogic
import IsItModel
import SwiftUI
import UIKit

/// The picker's title row, the website's `.sheet-head`: "Search for a place" as the sheet's
/// heading, leading and wrapping, and the website's "Close" pill trailing, its words on the title's
/// first baseline. Text, so both scale with Dynamic Type, which a toolbar's Close never did (PR
/// #33). Close is the sheet's secondary pill (`PillButton`: the wash with the `border` edge, at
/// least 44 by 44), its own element, its word in `label`, Regular, as the place's pill is.
struct SheetHeader: View {
  let title: String
  let close: String
  let action: () -> Void

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 12) {
      Text(verbatim: title)
        .brandFont(.sheetTitle)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)
      Spacer(minLength: 0)
      PillButton(.chip(minHeight: HitTarget.minimum), bordered: true, action: action) {
        // In `label`, the place pill's role, which the audit passes, rather than `button`'s
        // Medium: on every picker audit of PR #34's macOS runs Close, the only Medium text
        // audited, was "partially unsupported" for Dynamic Type though it grew. The first of
        // the changes to try, one a run (DECISIONS).
        Text(verbatim: close)
          .brandFont(.label)
      }
      .accessibilityIdentifier("picker-close")
    }
  }
}

/// The search box, the website's `.search-box`: a rounded rectangle (corners of 12) in the
/// `field` tint with a 1.5-point `fieldBorder` edge, holding the text field (`BoxTextField`) and,
/// while it holds text, the clear button: an ink xmark in a 44 by 44 frame ("Clear search"), which
/// empties the box and keeps the keyboard up. The field fills the box but for the clear button,
/// so a tap anywhere else on it focuses the field. Not the system's search (`.searchable`), whose
/// own clear button, about 20 points square, the audit failed as too small to tap on PR #33's
/// second macOS run, and which SwiftUI doesn't let the app resize or remove.
struct SearchBox: View {
  @Binding var text: String
  let prompt: String
  let clear: String
  let submit: () -> Void

  @SurfaceTokens private var tokens
  @Environment(\.legibilityWeight) private var legibilityWeight
  /// Counts the clear button's taps: each asks the field for the keyboard again.
  @State private var focusRequests = 0

  /// Spelt out, since the picker makes one from another file, and the private state could leave
  /// the memberwise initialiser private to this one.
  init(text: Binding<String>, prompt: String, clear: String, submit: @escaping () -> Void) {
    _text = text
    self.prompt = prompt
    self.clear = clear
    self.submit = submit
  }

  var body: some View {
    let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
    HStack(spacing: 0) {
      BoxTextField(
        text: $text,
        prompt: prompt,
        ink: tokens.ink,
        placeholder: tokens.soft,
        dark: tokens.theme.dark,
        bold: legibilityWeight == .bold,
        trailingInset: text.isEmpty ? BoxField.horizontalInset : 0,
        focusRequests: focusRequests,
        submit: submit
      )
      if !text.isEmpty {
        Button {
          text = ""
          focusRequests += 1
        } label: {
          Label {
            Text(verbatim: clear)
          } icon: {
            Image(systemName: "xmark")
          }
          .labelStyle(.iconOnly)
          .font(.body)
          .foregroundStyle(tokens.ink)
          .frame(minWidth: HitTarget.minimum, minHeight: HitTarget.minimum)
          .contentShape(Rectangle())
        }
        .buttonStyle(PressStyle())
        .accessibilityIdentifier("clear-search")
      }
    }
    .background(tokens.field, in: shape)
    .overlay {
      shape.strokeBorder(tokens.fieldBorder, lineWidth: 1.5)
    }
  }
}

/// The search box's text field: UIKit's `UITextField`, which SwiftUI can't draw as the website's
/// box. A plain SwiftUI field is only as tall as its line, about 22 points at Large, under the
/// shortest element the audit's hit-region check has passed (`HitTarget.shortestElement`), and the
/// rounded one is UIKit's white field. This one is the box's height (`sizeThatFits`: the scaled
/// line and 11.2 above and below, at least 44), so its own accessibility element is too; its text
/// is in the `field` role's face, scaled with `.body` (`UIFontMetrics`), a face up under Bold
/// Text; its placeholder is in `soft`, which XCUITest reads as its placeholder value; the caret is
/// ink; and the keyboard is dark on a dark band. The text reaches the model on each change, and
/// the model's text is written back only when it differs, so the caret never jumps.
struct BoxTextField: UIViewRepresentable {
  @Binding var text: String
  let prompt: String
  let ink: Color
  let placeholder: Color
  let dark: Bool
  let bold: Bool
  /// The space after the text: the box's own padding with nothing typed, none beside the clear
  /// button.
  let trailingInset: CGFloat
  /// A count that, when it changes, asks for the keyboard.
  let focusRequests: Int
  let submit: () -> Void

  func makeCoordinator() -> Coordinator {
    Coordinator(text: $text, submit: submit, focusRequests: focusRequests)
  }

  func makeUIView(context: Context) -> BoxField {
    let field = BoxField()
    field.delegate = context.coordinator
    field.addTarget(
      context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
    field.borderStyle = .none
    field.backgroundColor = .clear
    field.adjustsFontForContentSizeCategory = true
    field.returnKeyType = .search
    field.autocapitalizationType = .words
    field.autocorrectionType = .no
    field.spellCheckingType = .no
    field.clearButtonMode = .never
    field.accessibilityIdentifier = "place-search"
    field.accessibilityTraits.insert(.searchField)
    // The box sets the width: long text scrolls inside the field rather than widening it.
    field.setContentHuggingPriority(.defaultLow, for: .horizontal)
    field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    style(field)
    field.text = text
    return field
  }

  func updateUIView(_ field: BoxField, context: Context) {
    context.coordinator.text = $text
    context.coordinator.submit = submit
    style(field)
    // Not while a keyboard is composing (marked text), whose text the model hasn't had yet.
    if field.markedTextRange == nil, !(field.text ?? "").utf8.elementsEqual(text.utf8) {
      field.text = text
    }
    if focusRequests != context.coordinator.focusRequests {
      context.coordinator.focusRequests = focusRequests
      field.becomeFirstResponder()
    }
  }

  func sizeThatFits(_ proposal: ProposedViewSize, uiView field: BoxField, context: Context)
    -> CGSize?
  {
    let line = (field.font?.lineHeight ?? TextRole.field.size * 1.2).rounded(.up)
    // The width offered, or the field's own when none, or an unbounded one, is.
    let offered = proposal.width ?? field.intrinsicContentSize.width
    let width = offered.isFinite ? offered : field.intrinsicContentSize.width
    return CGSize(width: width, height: max(HitTarget.minimum, line + 2 * BoxField.verticalInset))
  }

  /// The field's face, colours and words, each set only when it changed.
  private func style(_ field: BoxField) {
    let face = bold ? TextRole.field.face.bolder : TextRole.field.face
    if field.face != face {
      field.face = face
      let base =
        UIFont(name: face.rawValue, size: TextRole.field.size)
        ?? .systemFont(ofSize: TextRole.field.size)
      field.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: base)
    }
    field.textColor = UIColor(ink)
    field.tintColor = UIColor(ink)
    field.keyboardAppearance = dark ? .dark : .light
    field.trailingInset = trailingInset
    if field.accessibilityLabel != prompt {
      field.accessibilityLabel = prompt
    }
    // The field's own font draws the placeholder: only its colour is given.
    field.attributedPlaceholder = NSAttributedString(
      string: prompt, attributes: [.foregroundColor: UIColor(placeholder)])
  }

  /// The field's delegate: each change of text to the model, and the Search key to `submit`.
  @MainActor
  final class Coordinator: NSObject, UITextFieldDelegate {
    var text: Binding<String>
    var submit: () -> Void
    var focusRequests: Int

    init(text: Binding<String>, submit: @escaping () -> Void, focusRequests: Int) {
      self.text = text
      self.submit = submit
      self.focusRequests = focusRequests
    }

    @objc func changed(_ field: UITextField) {
      text.wrappedValue = field.text ?? ""
    }

    func textFieldShouldReturn(_ field: UITextField) -> Bool {
      submit()
      return true
    }
  }
}

/// The search box's `UITextField`, filling the box: its text inset as the website pads the box,
/// 14.4 at the leading side and 14.4 at the trailing side with nothing typed, or none beside the
/// clear button, so the whole box but the clear button is the field to tap.
final class BoxField: UITextField {
  /// The website's padding inside the box, in points.
  static let horizontalInset: CGFloat = 14.4
  static let verticalInset: CGFloat = 11.2

  /// The face the font was made from, so it is made again only when Bold Text changes it.
  var face: BrandFont?
  var trailingInset: CGFloat = BoxField.horizontalInset {
    didSet {
      if trailingInset != oldValue { setNeedsLayout() }
    }
  }

  override func textRect(forBounds bounds: CGRect) -> CGRect { inset(bounds) }
  override func editingRect(forBounds bounds: CGRect) -> CGRect { inset(bounds) }
  override func placeholderRect(forBounds bounds: CGRect) -> CGRect { inset(bounds) }

  private func inset(_ bounds: CGRect) -> CGRect {
    let leading = Self.horizontalInset
    let rightToLeft = effectiveUserInterfaceLayoutDirection == .rightToLeft
    return bounds.inset(
      by: UIEdgeInsets(
        top: 0,
        left: rightToLeft ? trailingInset : leading,
        bottom: 0,
        right: rightToLeft ? leading : trailingInset
      ))
  }
}

/// An item of a row's press-and-hold menu, which is also one of its VoiceOver actions: "Save
/// Leeds", "Remove Leeds from saved places" or "Delete".
struct RowAction: Identifiable {
  let label: String
  /// Whether it forgets the place: drawn as the system draws a destructive item.
  var destructive = false
  let run: () -> Void

  var id: String { label }
}

/// A place in the picker, the website's flat row: the place as a button (its name in `label`, the
/// line beneath in `note` and `soft`, read as one element, "Leeds, England, United Kingdom", with
/// `value` after it), at least 44 tall, washed while pressed (`RowPressStyle`, corners of 9.6);
/// and beside it, when the place has one, its star (`StarButton`). Each button has its own style,
/// so a tap on the star never chooses the place. Press and hold the row for `menu`, whose items
/// are its VoiceOver actions too: the picker is a page of rows made at once, not a `List`, so it
/// has no swipes (DECISIONS, "The iPhone app in the website's look", step 5).
struct PlaceRow: View {
  let name: String
  let detail: String?
  let value: String?
  /// The row's identifier: `result-<i>`, `saved-<key>` or `recent-<key>`. Its star's is
  /// `star-<identifier>`.
  let identifier: String
  let star: PlacePicker.Star?
  let menu: [RowAction]
  let choose: () -> Void
  let toggleStar: () -> Void

  @SurfaceTokens private var tokens

  /// Spelt out, as `SearchBox`'s is.
  init(
    name: String,
    detail: String?,
    value: String?,
    identifier: String,
    star: PlacePicker.Star?,
    menu: [RowAction],
    choose: @escaping () -> Void,
    toggleStar: @escaping () -> Void
  ) {
    self.name = name
    self.detail = detail
    self.value = value
    self.identifier = identifier
    self.star = star
    self.menu = menu
    self.choose = choose
    self.toggleStar = toggleStar
  }

  var body: some View {
    HStack(alignment: .center, spacing: 0) {
      Button(action: choose) {
        VStack(alignment: .leading, spacing: 2) {
          Text(verbatim: name)
            .brandFont(.label)
          if let detail {
            Text(verbatim: detail)
              .brandFont(.note)
              .foregroundStyle(tokens.soft)
          }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.horizontal, 8)
        .padding(.vertical, 10.4)
        .frame(maxWidth: .infinity, minHeight: HitTarget.minimum, alignment: .leading)
        .contentShape(Rectangle())
      }
      .buttonStyle(RowPressStyle(cornerRadius: 9.6))
      .accessibilityValue(ifAny: value)
      .accessibilityIdentifier(identifier)
      .modifier(RowMenu(items: menu))
      if let star {
        StarButton(star: star, identifier: "star-" + identifier, action: toggleStar)
      }
    }
  }
}

/// A row's press-and-hold menu and the same items as VoiceOver actions (`accessibilityAction(
/// named:)`), for the one or two a row has; a row with none has neither.
private struct RowMenu: ViewModifier {
  let items: [RowAction]

  @ViewBuilder func body(content: Content) -> some View {
    switch items.count {
    case 0:
      content
    case 1:
      content
        .contextMenu { menu }
        .accessibilityAction(named: Text(verbatim: items[0].label), items[0].run)
    default:
      content
        .contextMenu { menu }
        .accessibilityAction(named: Text(verbatim: items[0].label), items[0].run)
        .accessibilityAction(named: Text(verbatim: items[1].label), items[1].run)
    }
  }

  private var menu: some View {
    ForEach(items) { item in
      Button(role: item.destructive ? ButtonRole.destructive : nil, action: item.run) {
        Text(verbatim: item.label)
      }
    }
  }
}

/// A place's star: `star.fill` for a saved place, which a tap removes, or `star` for one a tap
/// saves, in ink, sized by `.body` in a frame of at least 44 by 44 that grows with the text,
/// washed while pressed. VoiceOver reads what a tap does ("Save Leeds", "Remove Leeds from saved
/// places") and is told once it is done ("Leeds saved."): the row may move between Saved and
/// Recent, and focus isn't moved after it (the Later list).
struct StarButton: View {
  let star: PlacePicker.Star
  let identifier: String
  let action: () -> Void

  @SurfaceTokens private var tokens
  @ScaledMetric(relativeTo: .body) private var side: CGFloat = HitTarget.minimum

  init(star: PlacePicker.Star, identifier: String, action: @escaping () -> Void) {
    self.star = star
    self.identifier = identifier
    self.action = action
  }

  var body: some View {
    let announcement = star.announcement
    Button {
      action()
      UIAccessibility.post(notification: .announcement, argument: announcement)
    } label: {
      Image(systemName: star.saved ? "star.fill" : "star")
        .font(.body)
        .foregroundStyle(tokens.ink)
        .frame(width: max(side, HitTarget.minimum), height: max(side, HitTarget.minimum))
        .contentShape(Rectangle())
    }
    .buttonStyle(RowPressStyle(cornerRadius: 9.6))
    .accessibilityLabel(Text(verbatim: star.label))
    .accessibilityIdentifier(identifier)
  }
}
