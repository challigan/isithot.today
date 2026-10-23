import IsItModel
import IsItWidgetUI
import SwiftUI
import UIKit
import XCTest

/// The widget's entries drawn with `ImageRenderer` and attached to the result bundle, for the
/// contact sheet (iOS build spec, sections 11.4 and 18.1). They are review artefacts, not pixel
/// comparisons: the checks are that each one draws, at the small family's size.
final class WidgetSnapshotTests: XCTestCase {
  /// A small widget on a 402-point-wide iPhone, and the margins WidgetKit gives its content.
  private static let size = CGSize(width: 170, height: 170)
  private static let margin: CGFloat = 16
  private static let scale: CGFloat = 3

  @MainActor
  func testAberdeenSnow() throws {
    let answer = try XCTUnwrap(SavedAnswer(response: try TestFixtures.response("aberdeen-snow")))
    try attach(SavedAnswerEntry(date: Date(), answer: answer), named: "widget-small-aberdeen-snow")
  }

  @MainActor
  func testLeedsDry() throws {
    let answer = try XCTUnwrap(SavedAnswer(response: try TestFixtures.response("leeds-dry")))
    XCTAssertEqual(answer.label, "Rain")
    try attach(SavedAnswerEntry(date: Date(), answer: answer), named: "widget-small-leeds-dry")
  }

  @MainActor
  func testNothingSaved() throws {
    try attach(SavedAnswerEntry(date: Date(), answer: nil), named: "widget-small-nothing-saved")
  }

  /// Draws `entry` as the small widget does, on the system's widget background, and attaches it.
  @MainActor
  private func attach(_ entry: SavedAnswerEntry, named name: String) throws {
    let widget = SavedAnswerView(entry: entry)
      .padding(Self.margin)
      .frame(width: Self.size.width, height: Self.size.height)
      .background(
        Color(uiColor: .secondarySystemBackground),
        in: RoundedRectangle(cornerRadius: 22, style: .continuous)
      )
    let renderer = ImageRenderer(content: widget)
    renderer.scale = Self.scale
    let image = try XCTUnwrap(renderer.uiImage, "ImageRenderer drew nothing for \(name)")
    XCTAssertEqual(image.size, Self.size)
    XCTAssertEqual(image.scale, Self.scale)

    // PNG, as the contact sheet reads it.
    let png = try XCTUnwrap(image.pngData(), "No PNG for \(name)")
    let attachment = XCTAttachment(data: png, uniformTypeIdentifier: "public.png")
    attachment.name = name
    attachment.lifetime = .keepAlways
    add(attachment)
  }
}
