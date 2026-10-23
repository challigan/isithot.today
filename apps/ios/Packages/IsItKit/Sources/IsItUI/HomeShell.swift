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
      content
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
    .foregroundStyle(theme.ink)
    .tint(theme.ink)
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
/// place, the line beneath with "Use my location".
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
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .firstTextBaseline, spacing: 6) {
            approximateLine(approximate)
          }
          VStack(alignment: .leading, spacing: 2) {
            approximateLine(approximate)
          }
        }
        .font(.footnote)
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 4)
    .padding(.bottom, 4)
  }

  /// "Using approximate location." and its button.
  @ViewBuilder private func approximateLine(_ text: String) -> some View {
    Text(verbatim: text)
      .fixedSize(horizontal: false, vertical: true)
    if let useMyLocation = topBar.useMyLocation {
      Button {
        actions.useMyLocation()
      } label: {
        Text(verbatim: useMyLocation)
          .fontWeight(.semibold)
          .underline()
      }
      .accessibilityIdentifier("use-my-location")
    }
  }
}
