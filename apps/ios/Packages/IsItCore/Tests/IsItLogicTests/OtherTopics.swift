import Foundation

/// The words that would name another weather type, website or app (iOS build spec, section
/// 10.8): the app is about snow alone.
private let otherTopicWords: Set<String> = [
  "website", "websites", "isithot", "isitwet", "isitwindy", "hot", "wet", "wind", "windy",
  "rain", "rainy", "rainfall", "android",
]

/// The first word of `text` that names another weather type, website or app, or nil; words are
/// runs of letters, in any case.
func otherTopic(in text: String) -> String? {
  text.lowercased()
    .split { !$0.isLetter }
    .map(String.init)
    .first { otherTopicWords.contains($0) }
}
