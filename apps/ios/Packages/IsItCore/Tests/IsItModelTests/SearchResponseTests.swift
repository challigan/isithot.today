import Foundation
import IsItModel
import IsItTestSupport
import Testing

@Suite("Search results decode")
struct SearchResponseTests {
  @Test("a result with a city page and one without, with fields the app doesn't know ignored")
  func results() throws {
    let json = #"""
      {"results":[
        {"name":"Leeds","region":"England","country":"GB","countryName":"United Kingdom",
         "lat":53.7965,"lon":-1.5478,"slug":"leeds-gb","geonameId":2644688,"elevation":50,
         "population":455123},
        {"name":"Bath & Wells","region":null,"country":null,"countryName":null,
         "lat":51.2134,"lon":-2.6474}
      ],"source":"geonames"}
      """#
    let response = try SearchResponse.decode(from: Data(json.utf8))
    #expect(response.results.count == 2)
    let leeds = try #require(response.results.first)
    #expect(leeds.slug == "leeds-gb")
    #expect(leeds.elevation == 50)
    #expect(Target(search: leeds) == .city(slug: "leeds-gb", name: "Leeds"))
    let bath = try #require(response.results.last)
    #expect(bath.region == nil && bath.slug == nil && bath.elevation == nil)
    #expect(Target(search: bath).key == "search:51.2,-2.65")
  }

  @Test("no results")
  func none() throws {
    #expect(try SearchResponse.decode(from: Data(#"{"results":[]}"#.utf8)).results.isEmpty)
  }
}

@Suite("The search fixtures decode")
struct SearchFixtureTests {
  @Test("every search fixture pnpm mobile:generate writes is here, and decodes")
  func every() throws {
    #expect(try Fixtures.searchNames() == ["search-kathmandu", "search-leeds", "search-none"])
    for name in try Fixtures.searchNames() {
      let info = try Fixtures.searchInfo(name)
      #expect(info.query.hasPrefix("q="), "\(name)")
      #expect(ApiJSON.parseDate(info.now) != nil, "\(name)")
      #expect(!info.note.isEmpty, "\(name)")
      _ = try SearchResponse.decode(from: Fixtures.search(name))
    }
    #expect(try Fixtures.searchInfo("search-leeds").query == "q=Leeds")
  }

  @Test("Leeds has a city page; Kathmandu is a point on the grid; Xyzzy is nowhere")
  func places() throws {
    let leeds = try SearchResponse.decode(from: Fixtures.search("search-leeds")).results
    #expect(leeds.map(\.name) == ["Leeds"])
    #expect(Target(search: leeds[0]) == .city(slug: "leeds-gb", name: "Leeds"))
    let kathmandu = try SearchResponse.decode(from: Fixtures.search("search-kathmandu")).results
    #expect(kathmandu.map(\.name) == ["Kathmandu"])
    #expect(kathmandu[0].slug == nil)
    #expect(Target(search: kathmandu[0]).key == "search:27.7,85.3")
    // The point kathmandu-0545 answers.
    #expect(try Target(query: Fixtures.info("kathmandu-0545").query)?.key == "search:27.7,85.3")
    #expect(try SearchResponse.decode(from: Fixtures.search("search-none")).results.isEmpty)
  }
}
