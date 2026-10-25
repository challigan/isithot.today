import IsItLogic
import IsItModel
import SwiftUI

/// A page's footer (iOS build spec, section 10.2, item 7): when the forecast was fetched; the
/// offline, unavailable or stale line, with Retry under it after a failed request (section 4);
/// the links out, which open in Safari; the places nearby, which load in
/// place; and the credits as the API gives them, with Open-Meteo, the licences and NASA POWER
/// linked, next to the data as the licence asks. Every link, the credits' included, goes through
/// `actions.openLink`.
struct PageFooterView: View {
  let footer: HomePage.Footer
  /// The page's "Retry", drawn under the footer's line.
  let retry: String?
  let actions: HomeActions

  var body: some View {
    VStack(alignment: .leading, spacing: 20) {
      if footer.updated != nil || footer.notice != nil || retry != nil {
        VStack(alignment: .leading, spacing: 6) {
          if let updated = footer.updated {
            Text(verbatim: updated)
              .accessibilityIdentifier("updated")
          }
          if let notice = footer.notice {
            Text(verbatim: notice)
              .fixedSize(horizontal: false, vertical: true)
              .accessibilityIdentifier("notice")
          }
          if let retry {
            RetryButton(title: retry, action: actions.retry)
              .padding(.top, 4)
          }
        }
        .font(.footnote)
      }
      if !footer.links.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text(verbatim: footer.outboundIntro)
            .fixedSize(horizontal: false, vertical: true)
          FlowLayout(spacing: 16, lineSpacing: 0) {
            ForEach(Array(footer.links.enumerated()), id: \.offset) { _, link in
              Link(destination: link.url) {
                Text(verbatim: link.name)
                  .fontWeight(.semibold)
                  .underline()
                  .frame(minHeight: HitTarget.minimum)
                  .contentShape(Rectangle())
              }
            }
          }
        }
      }
      if !footer.nearby.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          Text(verbatim: footer.nearbyLabel)
          FlowLayout(spacing: 16, lineSpacing: 0) {
            ForEach(Array(footer.nearby.enumerated()), id: \.offset) { _, city in
              // Its element its words' band of the line, as "Use my location"'s (`WordsButton`);
              // the links above pass the audit as the whole line.
              WordsButton {
                actions.selectNearby(city)
              } label: {
                Text(verbatim: city.name)
                  .underline()
              }
              .accessibilityIdentifier("nearby-\(city.slug)")
            }
          }
        }
      }
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(footer.credits.enumerated()), id: \.offset) { _, credit in
          Text(Self.attributed(credit))
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .font(.footnote)
      // The page's last lines, which the audits scroll to, and whose links they know by it.
      .accessibilityElement(children: .contain)
      .accessibilityIdentifier("credits")
    }
    .environment(
      \.openURL,
      OpenURLAction { url in
        actions.openLink(url)
        return .handled
      })
  }

  /// A credit as one text, its linked phrases in bold, which a tap opens.
  static func attributed(_ credit: [CreditPart]) -> AttributedString {
    var text = AttributedString()
    for part in credit {
      var piece = AttributedString(part.text)
      if let url = part.url {
        piece.link = url
        piece.inlinePresentationIntent = .stronglyEmphasized
      }
      text.append(piece)
    }
    return text
  }
}
