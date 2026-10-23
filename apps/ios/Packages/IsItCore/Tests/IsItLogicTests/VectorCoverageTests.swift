import IsItTestSupport
import Testing

/// Phase 3's exit (iOS build spec, section 19): the set of vector files the tests load equals the
/// set pnpm mobile:generate writes, so none is skipped. Every file is loaded here and checked by
/// its port, which must check every case of every function in it. Until phase 3 has ported them
/// all, this fails for each file not yet ported, by name.
@Suite("Every vector file is checked by its port")
struct VectorCoverageTests {
  @Test("the files phase 3 must cover are the files pnpm mobile:generate writes")
  func listed() throws {
    let files = PortedVectors.all.map(\.file)
    #expect(Set(files).count == files.count, "a file is listed twice in PortedVectors.all")
    #expect(files.sorted() == (try Vectors.names()))
  }

  @Test(
    "each file is ported, and its port checks every case of every function",
    arguments: try Vectors.names()
  )
  func ported(_ name: String) throws {
    let entry = try #require(
      PortedVectors.all.first { $0.file == name },
      "\(name).json is generated but not in PortedVectors.all"
    )
    guard let port = entry.port else {
      Issue.record(
        "\(name).json is not ported yet (phase \(entry.by)): port it, then set its port in PortedVectors.swift"
      )
      return
    }
    let file = try VectorFile(name)
    try port.check(file)
    let missed = file.unchecked.map {
      "\($0) (\(file.checkedCount($0)) of \(file.counts[$0] ?? 0) checked)"
    }
    #expect(
      missed.isEmpty,
      "\(name).json: not every case was checked for \(missed.joined(separator: ", "))"
    )
  }
}
