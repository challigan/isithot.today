import IsItLogic
import IsItModel
import SwiftUI

/// A page's footer (iOS build spec, section 10.2, item 7) in the website's type and spacing
/// (Views.astro, Footer.astro; DECISIONS, "The iPhone app in the website's look"): when the
/// forecast was fetched; the offline, unavailable or stale line, with Retry under it after a
/// failed request (section 4); the links out, which open in Safari; the places nearby, which
/// load in place, listed as the website lists them; a hairline; and the credits as the API gives
/// them, with Open-Meteo, the licences and NASA POWER linked and underlined, next to the data as
/// the licence asks. Every link, the credits' included, goes through `actions.openLink`. The
/// links and places each keep a 44-point line to tap, rather than sit inline in their sentence
/// as on the website: an inline link is a target shorter than 44, which only the credits have an
/// exception for (WCAG 2.5.8, inside a sentence).
struct PageFooterView: View {
  let footer: HomePage.Footer
  /// The page's "Retry", drawn under the footer's line.
  let retry: String?
  let actions: HomeActions

  @SurfaceTokens private var tokens

  /// Spelt out, since the page makes one from another file, and the private tokens could
  /// leave the memberwise initialiser private to this one.
  init(footer: HomePage.Footer, retry: String?, actions: HomeActions) {
    self.footer = footer
    self.retry = retry
    self.actions = actions
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let updated = footer.updated {
        Text(verbatim: updated)
          .brandFont(.note)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("updated")
          .padding(.top, 12)
      }
      if let notice = footer.notice {
        Text(verbatim: notice)
          .brandFont(.note)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("notice")
          .padding(.top, 12)
      }
      if let retry {
        RetryButton(title: retry, action: actions.retry)
          .padding(.top, 20)
      }
      if !footer.links.isEmpty {
        // The website's 44 above, and the half-leading of its 1.6 line height.
        Text(verbatim: footer.outboundIntro)
          .brandFont(.label, lineSpacing: 0.4)
          .fixedSize(horizontal: false, vertical: true)
          .padding(.top, 47.2)
        FlowLayout(spacing: 16, lineSpacing: 0) {
          ForEach(Array(footer.links.enumerated()), id: \.offset) { _, link in
            Link(destination: link.url) {
              Text(verbatim: link.name)
                .underline()
                .frame(minHeight: HitTarget.minimum)
                .contentShape(Rectangle())
            }
          }
        }
        .brandFont(.labelStrong)
      }
      if !footer.nearby.isEmpty {
        nearby
          .padding(.top, footer.links.isEmpty ? 47.2 : 4)
      }
      // A rule, no element.
      Rectangle()
        .fill(tokens.hairline)
        .frame(height: 1)
        .padding(.top, 40)
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(footer.credits.enumerated()), id: \.offset) { _, credit in
          Text(Self.attributed(credit))
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      // The website's 1.5 line height on its credits.
      .brandFont(.caption, lineSpacing: 0.3)
      // The page's last lines, which the audits scroll to, and whose links they know by it.
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("credits")
      .padding(.top, 20)
    }
    .environment(
      \.openURL,
      OpenURLAction { url in
        actions.openLink(url)
        return .handled
      })
  }

  /// "Nearby:", then each place, underlined, with a comma after all but the last, as one run of
  /// words that wraps. Each place is a button with its own element, its words' band of the
  /// 44-point line (`WordsButton`), read as its name alone so the comma isn't spoken.
  private var nearby: some View {
    FlowLayout(spacing: 4, lineSpacing: 0) {
      Text(verbatim: footer.nearbyLabel)
        .frame(minHeight: HitTarget.minimum)
      ForEach(Array(footer.nearby.enumerated()), id: \.offset) { index, city in
        WordsButton {
          actions.selectNearby(city)
        } label: {
          // One text, not two side by side: the audit judges each text in a button as an
          // element of its own, and on PR #34's macOS runs failed every comma for contrast, a
          // text 2.3 points wide with no identifier, which no exception may match.
          Text(Self.nearbyName(city.name, comma: index < footer.nearby.count - 1))
        }
        .accessibilityLabel(Text(verbatim: city.name))
        .accessibilityIdentifier("nearby-\(city.slug)")
      }
    }
    // The website's 1.6 line height, for a name that wraps.
    .brandFont(.line, lineSpacing: 0.4)
  }

  /// A place nearby as one text: its name underlined, and the comma after it, outside the
  /// underline, when another place follows.
  static func nearbyName(_ name: String, comma: Bool) -> AttributedString {
    var text = AttributedString(name)
    text.underlineStyle = Text.LineStyle.single
    if comma {
      text.append(AttributedString(AppCopy.listComma))
    }
    return text
  }

  /// A credit as one text, its linked phrases underlined, which a tap opens: the website's
  /// links, not bold.
  static func attributed(_ credit: [CreditPart]) -> AttributedString {
    var text = AttributedString()
    for part in credit {
      var piece = AttributedString(part.text)
      if let url = part.url {
        piece.link = url
        piece.underlineStyle = Text.LineStyle.single
      }
      text.append(piece)
    }
    return text
  }
}
