import IsItLogic
import IsItModel
import Testing

/// Where the home screen's pager has come to rest (`PagerRest`), the only way a swipe sets the
/// view: three pages on a 402-point iPhone, Now, the middle view and This week, 1206 points of
/// content in all.
@Suite("Where the pager comes to rest")
struct PagerRestTests {
  let views: [AppView] = [.now, .today, .week]
  let width = 402.0
  let content = 1206.0

  func rest(_ midX: Double) -> AppView? {
    PagerRest.view(midX: midX, width: width, contentWidth: content, views: views)
  }

  @Test("each page at rest, its middle in the middle of the screen")
  func eachPage() {
    for (index, view) in views.enumerated() {
      #expect(rest(Double(index) * width + width / 2) == view, "page \(index)")
    }
  }

  @Test("the page under the middle, changing exactly at each page's leading edge")
  func halves() {
    #expect(rest(0) == .now)
    #expect(rest(401.9) == .now)
    #expect(rest(402) == .today)
    #expect(rest(803.9) == .today)
    #expect(rest(804) == .week)
  }

  @Test("pulled past either end, the end page")
  func ends() {
    #expect(rest(-50) == .now)
    #expect(rest(-1e30) == .now)
    #expect(rest(1300) == .week)
    #expect(rest(1e30) == .week)
  }

  @Test("content half a point short of the pages still followed, as a 3x screen may round")
  func rounded() {
    let short = PagerRest.view(midX: 603, width: width, contentWidth: 1205.6, views: views)
    #expect(short == .today)
  }

  @Test("nothing to follow: no width, no finite middle or no pages")
  func nothing() {
    for bad in [0, -402, Double.nan, .infinity] {
      let view = PagerRest.view(midX: 201, width: bad, contentWidth: content, views: views)
      #expect(view == nil, "width \(bad)")
    }
    for bad in [Double.nan, .infinity, -.infinity] {
      #expect(rest(bad) == nil, "middle \(bad)")
    }
    // A finite middle and width whose quotient isn't.
    let huge = PagerRest.view(midX: 1e300, width: 1e-300, contentWidth: content, views: views)
    #expect(huge == nil)
    #expect(PagerRest.view(midX: 201, width: width, contentWidth: content, views: []) == nil)
  }

  @Test("nothing to follow in content narrower than the pages: not laid out, or a page's own")
  func narrow() {
    for narrow in [0, width, 1205, Double.nan] {
      let view = PagerRest.view(midX: 201, width: width, contentWidth: narrow, views: views)
      #expect(view == nil, "content \(narrow) wide")
    }
  }
}
