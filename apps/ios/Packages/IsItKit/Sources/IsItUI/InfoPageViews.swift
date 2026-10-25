import IsItLogic
import IsItModel
import SwiftUI

/// "How it works" (section 10.6), the website's About page as a content page (`SheetPage`): the
/// title, the introduction on a reading card, then each section's heading on the page (a heading
/// for VoiceOver) and its paragraphs on a reading card of their own. The website sets the
/// paragraphs on the page; here they are on cards, as the audit has passed paragraphs only on
/// flat fills (`ReadingCard`).
struct HowItWorksView: View {
  let page: HowItWorks

  var body: some View {
    SheetPage(title: page.title) {
      ForEach(Array(page.sections.enumerated()), id: \.offset) { index, section in
        if let heading = section.heading {
          PageHeading(text: heading, first: index == 0)
        }
        ReadingCard {
          ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, paragraph in
            Text(verbatim: paragraph)
              .paragraph()
          }
        }
      }
    }
  }
}

/// "Credits and licences" (section 10.6): the forecast data's credits, each on a card of its own
/// with its sources and licences as rows under it, which a tap opens in Safari; and the typeface
/// and software, each a row opening its notice in full.
///
/// A credit's words are whole at its card's top, its linked phrases plain, and each phrase is a
/// row under it: not links inside the sentence, as the home screen's footer has them, whose hit
/// regions are only as tall as their line. The footer's are an exception its audit allows, as
/// WCAG 2.2's target size allows a link inside a sentence, and the attribution belongs beside the
/// data there; this page's audit allows nothing, and nothing here asks for the links to sit in
/// the sentence, so each is a row at least 54 points tall, the whole row its button
/// (`SheetRowStyle`).
struct CreditsView: View {
  let page: CreditsPage
  /// A bundled notice's text, by its resource name.
  let notice: (String) -> String?

  @Environment(\.openURL) private var openURL

  var body: some View {
    SheetPage(title: page.title) {
      PageHeading(text: page.dataHeading, first: true)
      VStack(alignment: .leading, spacing: 12) {
        ReadingCard {
          Text(verbatim: page.models)
            .paragraph()
        }
        ForEach(Array(page.data.enumerated()), id: \.offset) { _, credit in
          SheetCard {
            Text(verbatim: credit.map(\.text).joined())
              .brandFont(.label)
              .fixedSize(horizontal: false, vertical: true)
              .padding(.horizontal, SheetMetrics.rowInset)
              .padding(.vertical, 16)
            ForEach(Array(credit.enumerated()), id: \.offset) { _, part in
              if let url = part.url {
                SheetDivider()
                Button {
                  openURL(url)
                } label: {
                  RowLabel(title: part.text, end: .leaves)
                }
                .buttonStyle(SheetRowStyle())
              }
            }
          }
        }
      }
      PageHeading(text: page.softwareHeading)
      SheetCard {
        ForEach(Array(page.notices.enumerated()), id: \.element.id) { index, item in
          if index > 0 {
            SheetDivider()
          }
          NavigationLink {
            NoticeView(
              title: item.name, url: item.url, urlLabel: item.urlLabel, text: notice(item.file))
          } label: {
            RowLabel(title: item.name, detail: item.summary, end: .page)
          }
          .buttonStyle(SheetRowStyle())
          .accessibilityIdentifier("notice-\(item.file)")
        }
      }
    }
  }
}

/// A notice in full, as its owners wrote it, under its project's name: the project's page as a
/// page button showing its URL, underlined as the website underlines a link, with its arrow out
/// in `affordance`, as every arrow and chevron is; then the notice on a card, in the system's
/// monospaced footnote type (the app's one text not in Bricolage), selectable. The button's
/// accessibility label is in words (`urlLabel`, "Bricolage Grotesque's project page") and its
/// value the URL, as the Debug recorder's lines are: a URL as a label was "not human-readable" to
/// the audit on PR #33's second macOS run, and the recorder's line showing a URL under a shorter
/// label passed on its third.
struct NoticeView: View {
  let title: String
  let url: URL?
  let urlLabel: String
  let text: String?

  @Environment(\.openURL) private var openURL
  @SurfaceTokens private var tokens

  var body: some View {
    SheetPage(title: title) {
      VStack(alignment: .leading, spacing: 16) {
        if let url {
          PillButton(.wide) {
            openURL(url)
          } label: {
            HStack(spacing: 12) {
              Text(verbatim: url.absoluteString)
                .underline()
                .brandFont(.button)
              Spacer(minLength: 0)
              Image(systemName: "arrow.up.forward")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(tokens.affordance)
                .accessibilityHidden(true)
            }
          }
          .accessibilityLabel(Text(verbatim: urlLabel))
          .accessibilityValue(Text(verbatim: url.absoluteString))
        }
        if let text {
          SheetCard {
            Text(verbatim: text)
              .font(.system(.footnote, design: .monospaced))
              .fixedSize(horizontal: false, vertical: true)
              .textSelection(.enabled)
              .accessibilityIdentifier("notice-text")
              .padding(.horizontal, SheetMetrics.rowInset)
              .padding(.vertical, 16)
          }
        }
      }
    }
  }
}

/// "Your privacy" (section 10.6): the plain lines on a reading card, each its own text
/// (`privacy-line-<n>`); then, while registered for notifications (phase 8), what is kept for them
/// under its heading, a line to a row on a card, with the button that deletes it; then the full
/// policy in Safari, a page button. A page that scrolls (`SheetPage`), not a `Form`: as a
/// `Form`'s row, the full policy's was failed for Dynamic Type and as clipped on PR #33's first
/// two macOS runs, and as a scroll view's it passed on the third, though the page went back to
/// its top as the audit's text-size check began: what failed it was the `Form`'s cells, made only
/// while on screen, not where the page was.
struct YourPrivacyView: View {
  let page: YourPrivacy
  /// Turn off notifications and delete my data; nil until phase 8.
  let deleteMyData: (() -> Void)?

  @Environment(\.openURL) private var openURL

  var body: some View {
    SheetPage(title: page.title) {
      ReadingCard {
        ForEach(Array(page.lines.enumerated()), id: \.offset) { index, line in
          Text(verbatim: line)
            .paragraph()
            .accessibilityIdentifier("privacy-line-\(index)")
        }
      }
      if let kept = page.kept {
        PageHeading(text: kept.heading)
        SheetCard {
          ForEach(Array(kept.lines.enumerated()), id: \.offset) { index, line in
            if index > 0 {
              SheetDivider()
            }
            // Lines, not buttons: nothing happens on a tap.
            Text(verbatim: line)
              .brandFont(.row)
              .fixedSize(horizontal: false, vertical: true)
              .sheetRow()
          }
        }
        if let deleteMyData {
          PillButton(.wide, role: .destructive, action: deleteMyData) {
            HStack(spacing: 10) {
              Image(systemName: "trash")
                .font(.callout)
                .accessibilityHidden(true)
              Text(verbatim: kept.delete)
                .brandFont(.labelStrong)
            }
          }
          .accessibilityIdentifier("delete-my-data")
          .padding(.top, 16)
        }
      }
      if let policy = page.policy, let url = policyURL {
        PillButton(.wide) {
          openURL(url)
        } label: {
          LeavingLabel(title: policy.title)
        }
        .accessibilityIdentifier(policy.id)
        .padding(.top, 16)
      }
    }
  }

  /// Where the policy row goes: willitsnow.today/privacy.
  private var policyURL: URL? {
    guard let action = page.policy?.action, case .open(let url) = action else { return nil }
    return url
  }
}
