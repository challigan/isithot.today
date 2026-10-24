import IsItLogic
import IsItModel
import SwiftUI

/// "How it works" (section 10.6): headed sections of plain paragraphs, in the system's text
/// styles, so they grow with Dynamic Type, on a page that scrolls (`SheetPage`); each heading is a
/// heading for VoiceOver.
struct HowItWorksView: View {
  let page: HowItWorks

  var body: some View {
    SheetPage(spacing: 24) {
      ForEach(Array(page.sections.enumerated()), id: \.offset) { _, section in
        VStack(alignment: .leading, spacing: 10) {
          if let heading = section.heading {
            Text(verbatim: heading)
              .font(.title3.weight(.semibold))
              .accessibilityAddTraits(.isHeader)
          }
          ForEach(Array(section.paragraphs.enumerated()), id: \.offset) { _, paragraph in
            Text(verbatim: paragraph)
              .fixedSize(horizontal: false, vertical: true)
          }
        }
      }
    }
    .navigationTitle(Text(verbatim: page.title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// "Credits and licences" (section 10.6): the forecast data's credits, each with its sources and
/// licences as rows of their own, which a tap opens in Safari; and the typeface and software,
/// each opening its notice in full. Sections of rows on cards that scroll, as Settings' are
/// (`SheetPage(.grouped)`), not a `Form`, whose rows and headers the audit failed on Settings; no
/// run has yet audited this page.
///
/// A credit's words are whole in its first row, its linked phrases plain, and each phrase is a
/// row under it: not links inside the sentence, as the home screen's footer has them, whose hit
/// regions are only as tall as their line. The footer's are an exception its audit allows, as
/// WCAG 2.2's target size allows a link inside a sentence, and the attribution belongs beside the
/// data there; this page's audit allows nothing, and nothing here asks for the links to sit in
/// the sentence, so each is a row at least 52 points tall, the whole row its button
/// (`SheetRowStyle`).
struct CreditsView: View {
  let page: CreditsPage
  /// A bundled notice's text, by its resource name.
  let notice: (String) -> String?

  @Environment(\.openURL) private var openURL

  var body: some View {
    SheetPage(.grouped, spacing: 24) {
      SheetSection(header: page.dataHeading) {
        Text(verbatim: page.models)
          .fixedSize(horizontal: false, vertical: true)
          .sheetRow()
      }
      ForEach(Array(page.data.enumerated()), id: \.offset) { _, credit in
        SheetSection {
          Text(verbatim: credit.map(\.text).joined())
            .fixedSize(horizontal: false, vertical: true)
            .sheetRow()
          ForEach(Array(credit.enumerated()), id: \.offset) { _, part in
            if let url = part.url {
              SheetDivider()
              Button {
                openURL(url)
              } label: {
                LeavingRow(title: part.text)
              }
              .buttonStyle(SheetRowStyle())
            }
          }
        }
      }
      SheetSection(header: page.softwareHeading) {
        ForEach(Array(page.notices.enumerated()), id: \.element.id) { index, item in
          if index > 0 {
            SheetDivider()
          }
          NavigationLink {
            NoticeView(
              title: item.name, url: item.url, urlLabel: item.urlLabel, text: notice(item.file))
          } label: {
            PageRowLabel {
              VStack(alignment: .leading, spacing: 4) {
                Text(verbatim: item.name)
                  .fontWeight(.semibold)
                Text(verbatim: item.summary)
                  .font(.footnote)
                  .fixedSize(horizontal: false, vertical: true)
              }
            }
          }
          .buttonStyle(SheetRowStyle())
          .accessibilityIdentifier("notice-\(item.file)")
        }
      }
    }
    .navigationTitle(Text(verbatim: page.title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// A notice in full, as its owners wrote it, under its project's address, on a page that scrolls
/// (`SheetPage`). The address is a link that shows the URL, held to its full height; its
/// accessibility label is in words (`urlLabel`, "Bricolage Grotesque's project page") and its
/// value the URL, as the Debug recorder's lines are: a URL as a label was "not human-readable" to
/// the audit on PR #33's second macOS run, and the recorder's line showing a URL under a shorter
/// label, held, passed on its third.
struct NoticeView: View {
  let title: String
  let url: URL?
  let urlLabel: String
  let text: String?

  var body: some View {
    SheetPage {
      if let url {
        // As tall as a tap needs, as the footer's links are: one line of footnote text is about
        // half that, under the audit's hit region.
        Link(destination: url) {
          Text(verbatim: url.absoluteString)
            .font(.footnote)
            .multilineTextAlignment(.leading)
            .fixedSize(horizontal: false, vertical: true)
            .frame(minHeight: HitTarget.minimum)
            .contentShape(Rectangle())
        }
        .accessibilityLabel(Text(verbatim: urlLabel))
        .accessibilityValue(Text(verbatim: url.absoluteString))
      }
      if let text {
        Text(verbatim: text)
          .font(.footnote.monospaced())
          .fixedSize(horizontal: false, vertical: true)
          .textSelection(.enabled)
          .accessibilityIdentifier("notice-text")
      }
    }
    .navigationTitle(Text(verbatim: title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// "Your privacy" (section 10.6): the plain lines, then what is kept for notifications with the
/// button that deletes it, while registered (phase 8), then the full policy in Safari. A page of
/// paragraphs that scrolls (`SheetPage`), as How it works is, not a `Form`: as a `Form`'s row,
/// the full policy's, at the page's foot where the test had scrolled, was failed for Dynamic Type
/// and as clipped on PR #33's first two macOS runs. On the third, as a scroll view's, it passed,
/// though the page went back to its top as the audit's text-size check began, as the `Form` had,
/// so the row was on screen only at the two smallest sizes: what failed it was the `Form`'s cells,
/// made only while on screen, not where the page was (`SheetPage`).
struct YourPrivacyView: View {
  let page: YourPrivacy
  /// Turn off notifications and delete my data; nil until phase 8.
  let deleteMyData: (() -> Void)?

  @Environment(\.openURL) private var openURL

  var body: some View {
    SheetPage {
      ForEach(Array(page.lines.enumerated()), id: \.offset) { index, line in
        Text(verbatim: line)
          .fixedSize(horizontal: false, vertical: true)
          .accessibilityIdentifier("privacy-line-\(index)")
      }
      if let kept = page.kept {
        VStack(alignment: .leading, spacing: 10) {
          Text(verbatim: kept.heading)
            .font(.title3.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityAddTraits(.isHeader)
          ForEach(Array(kept.lines.enumerated()), id: \.offset) { _, line in
            Text(verbatim: line)
              .fixedSize(horizontal: false, vertical: true)
          }
          if let deleteMyData {
            Button(role: .destructive) {
              deleteMyData()
            } label: {
              Text(verbatim: kept.delete)
                .multilineTextAlignment(.leading)
                .frame(minHeight: HitTarget.minimum)
            }
            .accessibilityIdentifier("delete-my-data")
          }
        }
      }
      if let policy = page.policy, let url = policyURL {
        Button {
          openURL(url)
        } label: {
          LeavingRow(title: policy.title)
            .frame(minHeight: HitTarget.minimum)
        }
        .accessibilityIdentifier(policy.id)
      }
    }
    .navigationTitle(Text(verbatim: page.title))
    .navigationBarTitleDisplayMode(.inline)
  }

  /// Where the policy row goes: willitsnow.today/privacy.
  private var policyURL: URL? {
    guard let action = page.policy?.action, case .open(let url) = action else { return nil }
    return url
  }
}
