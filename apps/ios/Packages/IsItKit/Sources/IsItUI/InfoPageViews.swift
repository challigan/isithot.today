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

/// "Credits and licences" (section 10.6): the forecast data's credits, their sources and
/// licences linked (a tap opens them in Safari), and the typeface and software, each opening its
/// notice in full.
struct CreditsView: View {
  let page: CreditsPage
  /// A bundled notice's text, by its resource name.
  let notice: (String) -> String?

  var body: some View {
    Form {
      Section {
        Text(verbatim: page.models)
          .fixedSize(horizontal: false, vertical: true)
        ForEach(Array(page.data.enumerated()), id: \.offset) { _, credit in
          Text(PageFooterView.attributed(credit))
            .fixedSize(horizontal: false, vertical: true)
        }
      } header: {
        Text(verbatim: page.dataHeading)
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
          Link(destination: url) {
            Text(verbatim: url.absoluteString)
              .font(.footnote)
              .multilineTextAlignment(.leading)
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
/// button that deletes it, while registered (phase 8), then the full policy in Safari.
struct YourPrivacyView: View {
  let page: YourPrivacy
  /// Turn off notifications and delete my data; nil until phase 8.
  let deleteMyData: (() -> Void)?

  @Environment(\.openURL) private var openURL

  var body: some View {
    Form {
      Section {
        ForEach(Array(page.lines.enumerated()), id: \.offset) { index, line in
          Text(verbatim: line)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("privacy-line-\(index)")
        }
      }
      if let kept = page.kept {
        Section {
          ForEach(Array(kept.lines.enumerated()), id: \.offset) { _, line in
            Text(verbatim: line)
          }
          if let deleteMyData {
            Button(role: .destructive) {
              deleteMyData()
            } label: {
              Text(verbatim: kept.delete)
            }
            .accessibilityIdentifier("delete-my-data")
          }
        } header: {
          Text(verbatim: kept.heading)
        }
      }
      if let policy = page.policy, let url = policyURL {
        Section {
          Button {
            openURL(url)
          } label: {
            LeavingRow(title: policy.title)
          }
          .accessibilityIdentifier(policy.id)
        }
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
