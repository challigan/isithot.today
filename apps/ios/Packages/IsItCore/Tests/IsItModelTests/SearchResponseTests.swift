import Foundation
import IsItModel
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
