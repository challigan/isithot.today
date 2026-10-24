import IsItLogic
import SwiftUI

/// The home screen's frame (iOS build spec, section 10.2): the background of the page on
/// screen, full bleed, cross-fading in 0.9 s when its band changes (at once with Reduce Motion),
/// with the top bar above the pages. The pages are `content`: the switcher (`ViewSwitcher`) over
/// the pager of Now, Today and This week (`HomePager`), with `theme` the page on screen's.
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
      TopBarView(topBar: topBar, actions: actions)
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
    .background {
      ZStack {
        PageBackground(theme: theme)
          .id(theme)
          .transition(.opacity)
      }
      .animation(reduceMotion ? nil : .easeInOut(duration: 0.9), value: theme)
    }
  }
}

/// The top bar: the place as a button that opens the picker ("Place: Leeds. Change place."),
/// wrapping to two lines at large text sizes; the gear for Settings; and on the approximate IP
/// place, the line beneath with "Use my location", which goes under the line's text when the two
/// don't fit side by side.
struct TopBarView: View {
  let topBar: HomeTopBar
  let actions: HomeActions

  @ScaledMetric(relativeTo: .title3) private var tapSize: CGFloat = 44

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(alignment: .center, spacing: 12) {
        Button {
          actions.openPlacePicker()
        } label: {
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(verbatim: topBar.place)
              .font(.title3.weight(.semibold))
              .lineLimit(2)
              .multilineTextAlignment(.leading)
            Image(systemName: "chevron.down")
              .font(.footnote.weight(.semibold))
              .accessibilityHidden(true)
          }
          .frame(minHeight: tapSize, alignment: .leading)
        }
        .accessibilityLabel(Text(verbatim: topBar.placeLabel))
        .accessibilityIdentifier("place")
        Spacer(minLength: 8)
        Button {
          actions.openSettings()
        } label: {
          Image(systemName: "gearshape")
            .font(.title3)
            .frame(minWidth: tapSize, minHeight: tapSize)
        }
        .accessibilityLabel(Text(verbatim: topBar.settings))
        .accessibilityIdentifier("settings")
      }
      if let approximate = topBar.approximate {
        // One text and one button, side by side while they fit and the button under the text
        // when they don't, the text wrapping as it must: the footer's way with its links, which
        // the audit passes. Not `ViewThatFits`, a choice between two copies of the same views:
        // inside it, the audit on PR #31's macOS run found both elements' Dynamic Type
        // "partially unsupported" on every page, and "Use my location" short of contrast on
        // the pale ones.
        FlowLayout(spacing: 6, lineSpacing: 0) {
          approximateLine(approximate)
        }
        .font(.footnote)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 4)
    .padding(.bottom, 4)
  }

  /// "Using approximate location." and its button, each centred in a line as tall as the
  /// button's hit region, so the two read as one line when they share it.
  @ViewBuilder private func approximateLine(_ text: String) -> some View {
    Text(verbatim: text)
      .fixedSize(horizontal: false, vertical: true)
      .frame(minHeight: HitTarget.minimum)
      .accessibilityIdentifier("approximate")
    if let useMyLocation = topBar.useMyLocation {
      Button {
        actions.useMyLocation()
      } label: {
        Text(verbatim: useMyLocation)
          .fontWeight(.semibold)
          .underline()
          .frame(minHeight: HitTarget.minimum)
          .contentShape(Rectangle())
      }
      .accessibilityIdentifier("use-my-location")
    }
  }
}
