import IsItLogic
import IsItModel
import SwiftUI

/// The home screen's frame (iOS build spec, section 10.2): the background of the page on
/// screen, full bleed, cross-fading in 0.9 s when its band changes (at once with Reduce Motion),
/// with the top bar above the pages. The pages are `content`: the switcher (`ViewSwitcher`) over
/// the pager of Now, Today and This week (`HomePager`), with `theme` the page on screen's. The
/// top bar's chips take their fills from it, on the page surface (DECISIONS, "The iPhone app in
/// the website's look").
public struct HomeShell<Content: View>: View {
  let topBar: HomeTopBar
  let theme: PageTheme
  let actions: HomeActions
  let content: Content

  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init(
    topBar: HomeTopBar,
    theme: PageTheme,
    actions: HomeActions,
    @ViewBuilder content: () -> Content
  ) {
    self.topBar = topBar
    self.theme = theme
    self.actions = actions
    self.content = content()
  }

  public var body: some View {
    VStack(spacing: 0) {
      TopBarView(topBar: topBar, theme: theme, actions: actions)
      // The content must take the height it is offered, no more: this frame doesn't clamp a view
      // taller than its offer, and a home screen taller than the screen is centred in it, the
      // top bar pushed under the status bar (as the pager's pages did until main's first macOS
      // run, HomePager.swift).
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .foregroundStyle(theme.ink)
    .tint(theme.ink)
    .environment(\.colorScheme, theme.controls)
    .environment(\.pageTheme, theme)
    .environment(\.surface, .page)
    .background {
      ZStack {
        PageBackground(theme: theme)
          .id(theme)
          .transition(.opacity)
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.9), value: theme)
      // Decoration with no accessibility element, and no accessibility modifier here or in
      // `PageBackground`: one on views without an element makes one, the window's size here
      // (PR #33's second macOS run, Backgrounds.swift).
    }
  }
}

/// The top bar, in the website's arrangement (Header.astro; DECISIONS, "The iPhone app in the
/// website's look"): a 44-point line holding the place as a pill with the website's pin, which
/// opens the picker ("Place: Leeds. Change place."), and beside it the gear for Settings in a
/// round chip; beneath them, a notice about the place while there is one, and on the approximate
/// IP place the website's "Use my exact location" chip, whose VoiceOver hint says the place is
/// approximate. Trailing, where the website puts its pills; at accessibility text sizes leading,
/// with the gear trailing, so wrapped words read from the left. A long place name wraps in its
/// pill, never cut short. Every word sits on a chip's flat fill, never on the page's gradient,
/// and each pill is its own accessibility element (`PillButton`). Its colours follow the page on
/// screen's, fading as the background does.
struct TopBarView: View {
  let topBar: HomeTopBar
  let theme: PageTheme
  let actions: HomeActions

  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @SurfaceTokens private var tokens
  /// The pin, the website's 16 points beside the place's words, growing with them.
  @ScaledMetric(relativeTo: .callout) private var pin: CGFloat = 16

  var body: some View {
    let accessibilitySize = typeSize.isAccessibilitySize
    VStack(alignment: accessibilitySize ? .leading : .trailing, spacing: 0) {
      HStack(alignment: .center, spacing: 8) {
        if !accessibilitySize {
          Spacer(minLength: 0)
        }
        PillButton(.chip(minHeight: 36), action: actions.openPlacePicker) {
          HStack(spacing: 6.4) {
            // Stroked 2 units in 24, with round caps and joins, as the website strokes it.
            PinShape()
              .stroke(style: StrokeStyle(lineWidth: pin / 12, lineCap: .round, lineJoin: .round))
              .frame(width: pin, height: pin)
            // On one line whenever it fits: given a fraction of a point less than its words,
            // "Aberdeen" broke inside the word, "Aberdee" over "n" (`OneLineWhenItFits`).
            OneLineWhenItFits {
              Text(verbatim: topBar.place)
                .brandFont(.label)
            }
          }
        }
        .accessibilityLabel(Text(verbatim: topBar.placeLabel))
        .accessibilityIdentifier("place")
        // Offered its width before the spacer beside it, which at the same priority would take
        // half of what the gear leaves, so a name wider than that half would wrap beside it.
        .layoutPriority(1)
        if accessibilitySize {
          Spacer(minLength: 8)
        }
        IconPillButton(
          systemName: "gearshape", label: topBar.settings, action: actions.openSettings
        )
        .accessibilityIdentifier("settings")
      }
      if let notice = topBar.approximate {
        // Words, not a control: the chip is their flat fill, and the text alone their element.
        Text(verbatim: notice)
          .brandFont(.note)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("approximate")
          .padding(.vertical, 6)
          .padding(.horizontal, 12)
          .background(tokens.chip, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
          .padding(.top, 4)
      }
      if let exact = topBar.useMyLocation {
        // The website's `.place-note`, drawn 34 tall, the shortest element the audit's
        // hit-region check has passed (`HitTarget.shortestElement`), and tapped on its 44-point
        // line.
        PillButton(.chip(minHeight: HitTarget.shortestElement), action: actions.useMyLocation) {
          Text(verbatim: exact)
            .underline()
            .brandFont(.caption)
        }
        .accessibilityHint(Text(verbatim: CoreCopy.approximate))
        .accessibilityIdentifier("use-my-location")
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 6)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.9), value: theme)
  }
}
