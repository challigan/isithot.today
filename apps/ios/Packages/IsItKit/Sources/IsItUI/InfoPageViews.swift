import IsItLogic
import IsItModel
import SwiftUI

/// "How it works" (section 10.6): headed sections of plain paragraphs, in the system's text
/// styles, so they grow with Dynamic Type; each heading is a heading for VoiceOver.
struct HowItWorksView: View {
  let page: HowItWorks

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
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
      .padding(.horizontal, 20)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle(Text(verbatim: page.title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// "Credits and licences" (section 10.6): the forecast data's credits, each with its sources and
/// licences as rows of their own, which a tap opens in Safari; and the typeface and software,
/// each opening its notice in full.
///
/// A credit's words are whole in its first row, its linked phrases plain, and each phrase is a
/// row under it: not links inside the sentence, as the home screen's footer has them, whose hit
/// regions are only as tall as their line. The footer's are an exception its audit allows, as
/// WCAG 2.2's target size allows a link inside a sentence, and the attribution belongs beside the
/// data there; this page's audit allows nothing, and nothing here asks for the links to sit in
/// the sentence, so each is a row at least 44 points tall.
struct CreditsView: View {
  let page: CreditsPage
  /// A bundled notice's text, by its resource name.
  let notice: (String) -> String?

  var body: some View {
    Form {
      Section {
        Text(verbatim: page.models)
          .fixedSize(horizontal: false, vertical: true)
      } header: {
        Text(verbatim: page.dataHeading)
          .foregroundStyle(SheetStyle.secondary)
      }
      ForEach(Array(page.data.enumerated()), id: \.offset) { _, credit in
        Section {
          Text(verbatim: credit.map(\.text).joined())
            .fixedSize(horizontal: false, vertical: true)
          ForEach(Array(credit.enumerated()), id: \.offset) { _, part in
            if let url = part.url {
              Link(destination: url) {
                LeavingRow(title: part.text)
              }
            }
          }
        }
      }
      Section {
        ForEach(page.notices) { item in
          NavigationLink {
            NoticeView(title: item.name, url: item.url, text: notice(item.file))
          } label: {
            VStack(alignment: .leading, spacing: 4) {
              Text(verbatim: item.name)
                .fontWeight(.semibold)
              Text(verbatim: item.summary)
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 2)
          }
          .accessibilityIdentifier("notice-\(item.file)")
        }
      } header: {
        Text(verbatim: page.softwareHeading)
          .foregroundStyle(SheetStyle.secondary)
      }
    }
    .navigationTitle(Text(verbatim: page.title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// A notice in full, as its owners wrote it, under its project's address.
struct NoticeView: View {
  let title: String
  let url: URL?
  let text: String?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
        if let url {
          // As tall as a tap needs, as the footer's links are: one line of footnote text is
          // about half that, under the audit's hit region.
          Link(destination: url) {
            Text(verbatim: url.absoluteString)
              .font(.footnote)
              .multilineTextAlignment(.leading)
              .frame(minHeight: HitTarget.minimum)
              .contentShape(Rectangle())
          }
        }
        if let text {
          Text(verbatim: text)
            .font(.footnote.monospaced())
            .fixedSize(horizontal: false, vertical: true)
            .textSelection(.enabled)
            .accessibilityIdentifier("notice-text")
        }
      }
      .padding(.horizontal, 20)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .navigationTitle(Text(verbatim: title))
    .navigationBarTitleDisplayMode(.inline)
  }
}

/// "Your privacy" (section 10.6): the plain lines, then what is kept for notifications with the
/// button that deletes it, while registered (phase 8), then the full policy in Safari. A page of
/// paragraphs that scrolls, as How it works is, not a `Form`: during the audit's text-size check
/// a `Form` jumped back to its top and stayed there through every size, so the full policy's
/// row, at its foot where the test had scrolled, was on screen at no other size, and was failed
/// for Dynamic Type and as clipped on PR #33's two macOS runs. A scroll view keeps its offset,
/// held to its end: no text a scroll view had brought into view was failed so (the home pages,
/// How it works).
struct YourPrivacyView: View {
  let page: YourPrivacy
  /// Turn off notifications and delete my data; nil until phase 8.
  let deleteMyData: (() -> Void)?

  @Environment(\.openURL) private var openURL

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 16) {
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
      .padding(.horizontal, 20)
      .padding(.vertical, 16)
      .frame(maxWidth: .infinity, alignment: .leading)
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
