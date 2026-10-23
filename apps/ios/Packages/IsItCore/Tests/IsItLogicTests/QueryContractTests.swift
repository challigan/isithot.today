import Foundation
import IsItModel
import IsItTestSupport
import Testing

/// The query contract (iOS build spec, sections 11.2 and 17.2): the widgets and the App Intent
/// ask with the query the app would, made by the same `TodayQuery.build` from what the app
/// stored for them, `place.v1` (the target's JSON, nothing for approximate IP location) and
/// `units.v1` ("c", "f" or nothing), for every form of target.
@Suite("The widgets ask as the app does")
struct QueryContractTests {
  /// Every target the vectors have, in every form, with their awkward names and numbers: the
  /// inputs of query.json's `todayQuery` cases, as the client wrote them.
  static func targets() throws -> [Target] {
    let cases = try Vectors.cases(
      "query", fn: "todayQuery", input: TodayInput.self, output: String.self)
    var found: [Target] = []
    for item in cases where !found.contains(item.input.target) {
      found.append(item.input.target)
    }
    return found
  }

  @Test("the targets cover every form: IP location, a city, the device's and a searched place")
  func forms() throws {
    let forms = Set(
      try Self.targets().map { target in
        switch target {
        case .ip: "ip"
        case .city: "city"
        case .coords(let place): place.source.rawValue
        }
      })
    #expect(forms == ["ip", "city", "device", "search"])
  }

  @Test(
    "the stored place and units make the app's query, for every target",
    arguments: [Units.c, .f, nil]
  )
  func stored(units: Units?) throws {
    for target in try Self.targets() {
      let app = TodayQuery.build(target, units: units, ahead: [.snow])
      // What the app writes to the App Group, and the widget reads back.
      let place = try target.stored()
      let unitsValue = units?.rawValue
      let read = Target(stored: place)
      let widget = TodayQuery.build(
        read,
        units: unitsValue.flatMap(Units.init(rawValue:)),
        ahead: [.snow]
      )
      #expect(widget == app, "\(target)")
      #expect(read == target)
      #expect(read.key == target.key)
    }
  }

  @Test("approximate IP location is stored as nothing, and nothing reads back as it")
  func ip() throws {
    #expect(try Target.ip.stored() == nil)
    #expect(Target(stored: nil) == .ip)
    #expect(Target(stored: Data("not a place".utf8)) == .ip)
    #expect(Target(stored: Data(#"{"kind":"town"}"#.utf8)) == .ip)
    #expect(TodayQuery.build(Target(stored: nil), units: nil, ahead: [.snow]) == "ahead=snow")
  }

  @Test("a place the client stored reads as the client wrote it, null fields as absent ones")
  func clientJSON() throws {
    let json = #"""
      {"kind":"coords","source":"search","lat":56.15,"lon":-3.65,"name":"Dollar$ $& $1",
       "region":null,"country":null,"geonameId":0}
      """#
    let read = Target(stored: Data(json.utf8))
    #expect(
      read
        == .coords(
          Target.Coordinates(
            source: .search, lat: 56.15, lon: -3.65, name: "Dollar$ $& $1", geonameId: 0)))
    #expect(Target(stored: try read.stored()) == read)
  }
}

/// A `todayQuery` case's input, as far as the contract needs it.
private struct TodayInput: Decodable, Sendable {
  let target: Target
}
