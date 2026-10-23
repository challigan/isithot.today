import IsItLogic
import IsItModel
import SwiftUI

/// One page as the pager draws it: the presenter's page (`HomePage`), its colours and its glyph,
/// which the app gives, so IsItUI names no topic.
public struct PageContent {
  public let page: HomePage
  public let theme: PageTheme
  public let glyph: PageGlyph?

  public init(page: HomePage, theme: PageTheme, glyph: PageGlyph?) {
    self.page = page
    self.theme = theme
    self.glyph = glyph
  }
}

/// The view switcher (iOS build spec, section 10.2): Now | Today | This week, the middle one
/// "Tomorrow" from 6pm, as the pages label themselves (`HomePage.label`). A segmented picker; at
/// accessibility text sizes, where a segment would cut its label short, a row of buttons that
/// wraps, so every label stays whole (section 16). Either way `selection` is the view on screen.
public struct ViewSwitcher: View {
  let pages: [HomePage]
  @Binding var selection: AppView

  @Environment(\.dynamicTypeSize) private var typeSize

  public init(pages: [HomePage], selection: Binding<AppView>) {
    self.pages = pages
    _selection = selection
  }

  public var body: some View {
    Group {
      if typeSize.isAccessibilitySize {
        ViewThatFits(in: .horizontal) {
          HStack(alignment: .firstTextBaseline, spacing: 16) {
            buttons
          }
          VStack(alignment: .leading, spacing: 8) {
            buttons
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text(verbatim: CoreCopy.viewsLabel))
      } else {
        Picker(selection: $selection) {
          ForEach(pages, id: \.view) { page in
            Text(verbatim: page.label)
              .tag(page.view)
          }
        } label: {
          Text(verbatim: CoreCopy.viewsLabel)
        }
        .pickerStyle(.segmented)
      }
    }
    .accessibilityIdentifier("views")
    .padding(.horizontal, 20)
    .padding(.top, 4)
    .padding(.bottom, 8)
  }

  /// A button for each view, the one on screen underlined and marked selected.
  private var buttons: some View {
    ForEach(pages, id: \.view) { page in
      let selected = page.view == selection
      Button {
        selection = page.view
      } label: {
        Text(verbatim: page.label)
          .font(.headline)
          .underline(selected)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.vertical, 6)
          .frame(minHeight: HitTarget.minimum)
          .contentShape(Rectangle())
      }
      .accessibilityAddTraits(selected ? .isSelected : [])
      .accessibilityIdentifier("view-\(page.view.rawValue)")
    }
  }
}

/// Now, Today (Tomorrow from 6pm) and This week side by side, a page each, paged horizontally
/// (iOS build spec, section 10.2): swiping sets `selection`, and setting it (the switcher, a
/// route, the return after a long time away) moves the pages, so the two always agree. Each page
/// scrolls vertically and pulls to refresh (`refresh`). Only the page on screen is in the
/// accessibility tree, so VoiceOver and the UI tests read that one; VoiceOver moves between pages
/// with the switcher.
public struct HomePager: View {
  let pages: [PageContent]
  @Binding var selection: AppView
  /// Never drift the glyphs: a test's still screens.
  let still: Bool
  let actions: HomeActions
  let refresh: @Sendable () async -> Void

  public init(
    pages: [PageContent],
    selection: Binding<AppView>,
    still: Bool,
    actions: HomeActions,
    refresh: @escaping @Sendable () async -> Void
  ) {
    self.pages = pages
    _selection = selection
    self.still = still
    self.actions = actions
    self.refresh = refresh
  }

  public var body: some View {
    ScrollViewReader { proxy in
      ScrollView(.horizontal) {
        HStack(spacing: 0) {
          ForEach(pages, id: \.page.view) { content in
            ForecastPageView(
              page: content.page,
              theme: content.theme,
              glyph: content.glyph,
              still: still,
              actions: actions
            )
            .refreshable { [refresh] in await refresh() }
            .containerRelativeFrame([.horizontal, .vertical])
            .id(content.page.view)
            .accessibilityHidden(content.page.view != selection)
          }
        }
        .scrollTargetLayout()
      }
      .scrollTargetBehavior(.paging)
      .scrollPosition(id: position)
      .scrollIndicators(.hidden)
      .onAppear { proxy.scrollTo(selection, anchor: .leading) }
    }
  }

  /// The page scrolled to, as the scroll view reads and sets it: the selection.
  private var position: Binding<AppView?> {
    Binding(
      get: { selection },
      set: { shown in
        if let shown { selection = shown }
      }
    )
  }
}
