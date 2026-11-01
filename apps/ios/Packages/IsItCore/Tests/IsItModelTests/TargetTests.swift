import IsItModel
import Testing

@Suite("A target's own name")
struct TargetNameTests {
  @Test("a city's or a coordinate target's name, never an empty one; IP location has none")
  func ownName() {
    #expect(Target.ip.ownName == nil)
    #expect(Target.city(slug: "leeds-gb", name: "Leeds").ownName == "Leeds")
    #expect(Target.city(slug: "leeds-gb").ownName == nil)
    #expect(Target.city(slug: "leeds-gb", name: "").ownName == nil)
    let kathmandu = Target.Coordinates(source: .search, lat: 27.7, lon: 85.3, name: "Kathmandu")
    #expect(Target.coords(kathmandu).ownName == "Kathmandu")
    #expect(Target.coords(.init(source: .search, lat: 51.2, lon: -2.65)).ownName == nil)
    #expect(Target.coords(.init(source: .search, lat: 51.2, lon: -2.65, name: "")).ownName == nil)
    // The phone's own point has no name: the answer names it.
    #expect(Target.device(lat: 53.8, lon: -1.55).ownName == nil)
  }
}
