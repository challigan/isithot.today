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

/// The view switcher (iOS build spec, section 10.2), the website's tabs (`.tabs`, ViewTabs.astro;
/// DECISIONS, "The iPhone app in the website's look"): Now | Today | This week, the middle one
/// "Tomorrow" from 6pm, as the pages label themselves (`HomePage.label`). At standard text sizes
/// the website's track, a chip 352 points wide at most and centred, in equal thirds, the view on
/// screen on an ink thumb that slides to the next (`PillSegments`). At accessibility sizes, where
/// a third would cut a label short, the tabs as separate chips that wrap, the one on screen ink,
/// so every label stays whole (section 16). Either way one container, the tab bar, labelled
/// "Forecast period", holding a button for each tab, `view-now`, `view-today` and `view-week`,
/// marked selected for the view on screen, which `selection` is. Not the segmented `Picker`: its
/// words kept their size as the text grew, the one exception the home audit allowed for Dynamic
/// Type. Its colours are the page on screen's (`theme`), fading as the background does.
public struct ViewSwitcher: View {
  let pages: [HomePage]
  @Binding var selection: AppView
  let theme: PageTheme

  @Environment(\.dynamicTypeSize) private var typeSize
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  public init(pages: [HomePage], selection: Binding<AppView>, theme: PageTheme) {
    self.pages = pages
    _selection = selection
    self.theme = theme
  }

  public var body: some View {
    Group {
      if typeSize.isAccessibilitySize {
        // Chips that wrap, as the footer's links do, rather than `ViewThatFits` between a row
        // and a column of the same buttons: the audit found the top bar's texts inside one
        // "partially unsupported" for Dynamic Type.
        FlowLayout(spacing: 8, lineSpacing: 8) {
          ForEach(pages, id: \.view) { page in
            TabChip(page: page, selected: page.view == selection) {
              selection = page.view
            }
          }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
      } else {
        PillSegments(
          pages.map { page in
            PillSegment(id: page.view, title: page.label, identifier: Self.identifier(page.view))
          },
          selected: selection,
          widths: .equal,
          role: .tab
        ) { view in
          selection = view
        }
        .frame(maxWidth: 352)
      }
    }
    .accessibilityElement(children: .contain)
    .accessibilityAddTraits(.isTabBar)
    .accessibilityLabel(Text(verbatim: CoreCopy.viewsLabel))
    .accessibilityIdentifier("views")
    .frame(maxWidth: .infinity)
    .padding(.horizontal, 20)
    .padding(.top, 28)
    .foregroundStyle(theme.ink)
    .environment(\.pageTheme, theme)
    .environment(\.surface, .page)
    .animation(reduceMotion ? nil : .easeInOut(duration: 0.9), value: theme)
  }

  /// A tab's identifier, the same at every text size.
  static func identifier(_ view: AppView) -> String {
    "view-\(view.rawValue)"
  }
}

/// A tab at accessibility text sizes: its label on a chip at least 44 points tall, or for the
/// view on screen on ink, its words in `pill` (the website's selected tab), marked selected.
/// The chip is the button's element, so it is fill and words, never the page's gradient.
private struct TabChip: View {
  let page: HomePage
  let selected: Bool
  let action: () -> Void

  @SurfaceTokens private var tokens

  var body: some View {
    Button(action: action) {
      Text(verbatim: page.label)
        .brandFont(.tab)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .foregroundStyle(selected ? tokens.selectedWords : tokens.ink)
        .padding(.horizontal, 16)
        .padding(.vertical, 4.8)
        .frame(minHeight: HitTarget.minimum)
        .background(selected ? tokens.selected : tokens.chip, in: Capsule())
        .contentShape(Capsule())
    }
    .buttonStyle(PressStyle())
    .accessibilityAddTraits(selected ? .isSelected : [])
    .accessibilityIdentifier(ViewSwitcher.identifier(page.view))
  }
}

/// Now, Today (Tomorrow from 6pm) and This week side by side, a page each, paged horizontally
/// (iOS build spec, section 10.2): a swipe sets `selection` as the pages come to rest, to the
/// page they rest on, and setting it (the switcher, a route, the return after a long time away)
/// moves the pages to it at once, so the two always agree (`PagerSync`). Each page scrolls
/// vertically and pulls to refresh (`refresh`). Only the chosen view's page is in the
/// accessibility tree, so VoiceOver and the UI tests read that one: the page on screen, except
/// while a swipe is still moving, as `selection` follows a swipe only when the pages settle (on
/// iOS 17, when the scroll view reports the next page). VoiceOver moves between pages with the
/// switcher. Each page ends with what `pageEnd` gives for its view, after its footer: in the free
/// version, the ad box.
///
/// Each page is exactly the pager's size: the space the home screen leaves it under the top bar
/// and the switcher, read as the pager is laid out. Not
/// `.containerRelativeFrame([.horizontal, .vertical])`: a horizontal scroll view is a page's
/// container only along the axis it scrolls, so each page took the height of the screen's safe
/// area, the horizontal scroll view took the page's, and the home screen was taller than the
/// screen by the top bar and the switcher. The window centred it, which put the top bar's place
/// button and gear under the status bar, where a tap never reaches the app, and every page's end
/// below the screen (DECISIONS, "The iPhone app's UI tests, after main's first macOS run").
///
/// The horizontal scroll view is `pager` to the UI tests: `expectFits` reads its top and bottom
/// edges, and an issue the audit finds on it names it. On main's first macOS run an element with
/// neither an identifier nor a label failed `sufficientElementDescription` once on every
/// screenful, never whole on screen, as this scroll view, then taller than the screen, was; with
/// the identifier, the next run's log says whether it is (DECISIONS, "The iPhone app's UI tests,
/// reviewed").
public struct HomePager<PageEnd: View>: View {
  let pages: [PageContent]
  @Binding var selection: AppView
  /// Never drift the glyphs: a test's still screens.
  let still: Bool
  let actions: HomeActions
  let refresh: @Sendable () async -> Void
  /// What each view's page ends with (`ForecastPageView`'s `end`).
  let pageEnd: (AppView) -> PageEnd

  public init(
    pages: [PageContent],
    selection: Binding<AppView>,
    still: Bool,
    actions: HomeActions,
    refresh: @escaping @Sendable () async -> Void,
    @ViewBuilder pageEnd: @escaping (AppView) -> PageEnd
  ) {
    self.pages = pages
    _selection = selection
    self.still = still
    self.actions = actions
    self.refresh = refresh
    self.pageEnd = pageEnd
  }

  public var body: some View {
    // The reader takes all the space it is offered, no more, and says how much that is.
    GeometryReader { space in
      ScrollViewReader { proxy in
        ScrollView(.horizontal) {
          HStack(spacing: 0) {
            ForEach(pages, id: \.page.view) { content in
              ForecastPageView(
                page: content.page,
                theme: content.theme,
                glyph: content.glyph,
                still: still,
                pageWidth: space.size.width,
                actions: actions,
                end: pageEnd(content.page.view)
              )
              .refreshable { [refresh] in await refresh() }
              .frame(width: space.size.width, height: space.size.height)
              .id(content.page.view)
              .accessibilityHidden(content.page.view != selection)
            }
          }
          .scrollTargetLayout()
        }
        .scrollTargetBehavior(.paging)
        .modifier(PagerSync(selection: $selection, views: pages.map(\.page.view), proxy: proxy))
        .scrollIndicators(.hidden)
        .accessibilityIdentifier("pager")
        // The pages on the view the app opens on, in case the first position
        // `scrollPosition(id:)` is given isn't applied.
        .onAppear { proxy.scrollTo(selection, anchor: .leading) }
      }
    }
  }
}

/// The pages and `selection` kept together. A tap, a route or the return after a long time away
/// sets `selection`, and the pages move to it at once, not animated: an animated scroll passes
/// the pages between. The scroll view reports the page it is on through `scrollPosition(id:)`
/// into a position of its own, `shown`, which the app never writes: it starts at the view the
/// app opens on, so the scroll view opens there, and a report of the page the pages are still on
/// can never be written back over a tap's view. On PR #34's macOS run on cf4eb74, while
/// `scrollPosition(id:)` shared `selection`, a tap on Today was drawn pressed and let go with
/// nothing else moving, and Now was still chosen in the next frame (DECISIONS, "After #34's
/// second full run").
///
/// What the pages set `selection` to: on iOS 18 only a swipe, as it comes to rest, the page it
/// rests on (`PagerRest`), read from where the scroll view is then. Not every rest: the scroll
/// view comes to rest at launch too, on Now, before it is moved to the view the app opens on,
/// and following that rest opened every launch on Now on 8bcc82b's run. iOS 17 has no scroll
/// phases, so there the change of page the scroll view reports sets it.
private struct PagerSync: ViewModifier {
  @Binding var selection: AppView
  let views: [AppView]
  let proxy: ScrollViewProxy
  /// The page the scroll view reports it is on: at first the view the app opens on, which it
  /// then scrolls to.
  @State private var shown: AppView?
  /// Whether a finger has moved the pages since they last came to rest.
  @State private var swiped = false

  init(selection: Binding<AppView>, views: [AppView], proxy: ScrollViewProxy) {
    _selection = selection
    self.views = views
    self.proxy = proxy
    _shown = State(initialValue: selection.wrappedValue)
  }

  func body(content: Content) -> some View {
    let placed = content.scrollPosition(id: $shown)
    if #available(iOS 18, *) {
      placed
        .onChange(of: selection) { _, view in
          // Always moved: a swipe's page is where the pages already rest, so that moves nothing,
          // and nothing here relies on the scroll view reporting the reader's moves.
          proxy.scrollTo(view, anchor: .leading)
        }
        .onScrollPhaseChange { _, phase, context in
          if phase == .interacting { swiped = true }
          guard phase == .idle, swiped else { return }
          swiped = false
          guard
            let rest = PagerRest.view(
              midX: Double(context.geometry.visibleRect.midX),
              width: Double(context.geometry.containerSize.width),
              contentWidth: Double(context.geometry.contentSize.width),
              views: views
            ),
            rest != selection
          else { return }
          selection = rest
        }
    } else {
      placed
        .onChange(of: selection) { _, view in
          // Set from a swipe's report, the pages are there already: moving them again would
          // jump them under the finger. It relies on the scroll view reporting the reader's
          // moves as it does a swipe's; the UI tests run on iOS 26.5, so none checks it.
          guard view != shown else { return }
          proxy.scrollTo(view, anchor: .leading)
        }
        .onChange(of: shown) { _, page in
          if let page, page != selection { selection = page }
        }
    }
  }
}
