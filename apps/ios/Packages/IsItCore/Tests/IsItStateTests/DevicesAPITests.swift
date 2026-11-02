import Foundation
import IsItLogic
import IsItModel
import IsItState
import IsItTestSupport
import Testing

#if canImport(FoundationNetworking)
  import FoundationNetworking
#endif

/// The set the devices fixture `name` (a version 2 PUT's 200) holds, as the client reads it.
private func storedSet(_ name: String) throws -> DeviceResponse {
  try JSONDecoder().decode(DeviceResponse.self, from: Fixtures.deviceInfo(name).reply)
}

/// The token every devices fixture registers with: the tests type none.
private func token() throws -> String {
  try sentBody("put-here-ip").token
}

/// The devices calls (iOS build spec, section 8.2; version 2, phase 8.4a): each request as the
/// server takes it, and each reply the real server gave (`Fixtures/Devices`) as the client rules
/// read it.
@Suite("The devices calls")
struct DevicesAPITests {
  /// Every devices fixture but the version 2 sets, by the call it answers, with what the app
  /// makes of its reply.
  static let replies: [(name: String, sync: AlertSync.SyncReply?, test: AlertSync.TestOutcome?)] =
    [
      ("put-twice", .retry(afterSeconds: 50), nil),
      ("rate-limited", .retry(afterSeconds: 60), .failed),
      (
        "put-unlocated",
        .placeRefused(
          message: "We couldn't tell where you are from your internet connection. Try again "
            + "later, or use your location."), nil
      ),
      // 8.1's answer to its version 1 body: this app couldn't read one.
      ("put-leeds", .failed, nil),
      ("delete", .forgotten, nil),
      ("test-sent", nil, .sent(count: 1)),
      ("test-dryrun", nil, .dryRun),
      ("test-limited", nil, .limited),
      ("test-quiet", nil, .quiet),
      ("test-gone", nil, .notRegistered),
      ("test-unregistered", nil, .notRegistered),
      ("test-down", nil, .failed),
    ]

  @Test(
    "a registration is a PUT of version 2's body as JSON, with Accept and Content-Type, in 12 s")
  func theRegistration() async throws {
    let transport = FakeTransport([try deviceReply("put-here-ip")])
    let reply = await APIClient(transport: transport).registerDevice(try sentBody("put-here-ip"))
    let request = try #require(transport.requests.first)
    #expect(transport.requests.count == 1)
    #expect(request.method == .put)
    #expect(request.url.absoluteString == "https://willitsnow.today/api/v1/devices")
    #expect(
      request.headers == ["Accept": "application/json", "Content-Type": "application/json"])
    #expect(request.timeout == 12)
    #expect(try sortedJSON(request.body) == deviceSentJSON("put-here-ip"))
    // Its keys sorted, so the same registration is always the same bytes: where you are for the
    // server to locate, and no saved place.
    #expect(
      request.body.flatMap { String(data: $0, encoding: .utf8) }
        == #"{"alerts":{"snow":{"evening":true,"morning":false,"possible":false}},"#
        + #""app":"snow","appVersion":"1.0 (42)","env":"sandbox","here":{"source":"ip"},"#
        + #""platform":"ios","saved":[],"token":""# + (try token()) + #"","units":"c","v":2}"#)
    #expect(reply == .stored(try storedSet("put-here-ip")))
  }

  @Test("the phone's cell is sent as its point alone, and the connection's place each time")
  func theSets() async throws {
    for name in ["put-here-device", "put-here-refresh"] {
      let transport = FakeTransport([try deviceReply(name)])
      let reply = await APIClient(transport: transport).registerDevice(try sentBody(name))
      #expect(try sortedJSON(transport.requests.first?.body) == deviceSentJSON(name), "\(name)")
      #expect(reply == .stored(try storedSet(name)), "\(name)")
    }
    let device = try sentBody("put-here-device")
    #expect(device.here == .device(lat: 53.8, lon: -1.55))
    #expect(device.saved.isEmpty)
    let sent = try #require(try Fixtures.deviceInfo("put-here-device").body)
    let body = String(decoding: sent, as: UTF8.self)
    #expect(body.contains(#""here":{"lat":53.8,"lon":-1.55,"source":"device"}"#))
  }

  @Test("forgetting is a DELETE, and a test a POST, each of the app and the token alone")
  func forgetAndTest() async throws {
    let token = try token()
    let transport = FakeTransport([try deviceReply("delete"), try deviceReply("test-sent")])
    let client = APIClient(transport: transport)
    #expect(await client.forgetDevice(token: token) == .forgotten)
    #expect(await client.testDevice(token: token) == .sent(count: 1))
    let identity = #"{"app":"snow","token":""# + token + #""}"#
    let calls: [(HTTPMethod, String)] = [
      (.delete, "/api/v1/devices"), (.post, "/api/v1/devices/test"),
    ]
    for (request, (method, path)) in zip(transport.requests, calls) {
      #expect(request.method == method)
      #expect(request.url.absoluteString == "https://willitsnow.today" + path)
      #expect(
        request.headers == ["Accept": "application/json", "Content-Type": "application/json"])
      #expect(request.timeout == 12)
      #expect(request.body.flatMap { String(data: $0, encoding: .utf8) } == identity)
    }
    #expect(try sortedJSON(transport.requests.first?.body) == deviceSentJSON("delete"))
    #expect(try sortedJSON(transport.requests.last?.body) == deviceSentJSON("test-sent"))
  }

  @Test("every reply the server gave means what the client rules say, Retry-After and all")
  func everyReply() async throws {
    let token = try token()
    for (name, sync, test) in Self.replies {
      let info = try Fixtures.deviceInfo(name)
      let client = APIClient(transport: FakeTransport([try deviceReply(name)]))
      if let sync {
        let rule = AlertSync.syncReply(
          status: info.status, body: Data(info.text.utf8), retryAfter: info.retryAfter)
        #expect(rule == sync, "\(name)")
        if name == "delete" {
          #expect(await client.forgetDevice(token: token) == sync)
        } else {
          #expect(await client.registerDevice(try sentBody("put-here-ip")) == sync, "\(name)")
        }
      }
      if let test {
        #expect(AlertSync.testOutcome(status: info.status, body: Data(info.text.utf8)) == test)
        #expect(await client.testDevice(token: token) == test, "\(name)")
      }
    }
  }

  @Test("no answer at all is a failure, never a throw")
  func noAnswer() async throws {
    let token = try token()
    for code in [URLError.Code.notConnectedToInternet, .timedOut, .cancelled] {
      let client = APIClient(transport: FakeTransport([.failure(code)]))
      #expect(await client.registerDevice(try sentBody("put-here-ip")) == .failed)
      #expect(await client.forgetDevice(token: token) == .failed)
      #expect(await client.testDevice(token: token) == .failed)
    }
  }

  @Test("a deploy preview's origin, with or without its slash")
  func preview() throws {
    for origin in ["https://deploy-preview-7--willitsnow.netlify.app", "https://x.example/"] {
      let client = APIClient(
        origin: try #require(URL(string: origin)), transport: FakeTransport([]))
      let request = try #require(
        client.deviceRequest(.post, path: "/api/v1/devices/test", body: Data("{}".utf8)))
      #expect(!request.url.absoluteString.contains("//api"))
      #expect(request.url.path == "/api/v1/devices/test")
      #expect(request.body == Data("{}".utf8))
    }
  }
}
