// Run with scripts/check-apple-custody.sh (OPEN-26).
import Foundation
import WebKit

final class FakeMessage: WKScriptMessage {
    let fakeBody: Any
    init(_ body: Any) { fakeBody = body; super.init() }
    override var body: Any { fakeBody }
}

let bridge = AppleCustodyBridge()
let ucc = WKUserContentController()
var failures = 0
func send(_ body: [String: Any]) -> (Any?, String?) {
    var out: (Any?, String?) = (nil, "no-reply")
    bridge.userContentController(ucc, didReceive: FakeMessage(body)) { out = ($0, $1) }
    return out
}
func check(_ name: String, _ ok: Bool, _ got: Any?) {
    print(ok ? "PASS" : "FAIL", name, ok ? "" : String(describing: got))
    if !ok { failures += 1 }
}
let pair = ["pub": "P1", "epub": "E1", "priv": "k1", "epriv": "ek1"]
let other = ["pub": "P2", "epub": "E2", "priv": "k2", "epriv": "ek2"]

let d = send(["op": "describe"]).0 as? [String: Any]
check("describe", d?["provider"] as? String == "apple-keychain" && d?["hardwareBacked"] is NSNull, d)
_ = send(["op": "remove", "pub": "P1", "epub": "E1"]); _ = send(["op": "remove", "pub": "P2", "epub": "E2"])
check("read empty", (send(["op": "read"]).0 as? [String: Any])?["pair"] is NSNull, send(["op": "read"]))
check("write", (send(["op": "write", "pair": pair]).0 as? [String: Any])?["ok"] as? Bool == true, nil)
check("read back", (send(["op": "read"]).0 as? [String: Any])?["pair"] as? [String: String] == pair, send(["op": "read"]))
check("overwrite", (send(["op": "write", "pair": other]).0 as? [String: Any])?["ok"] as? Bool == true, nil)
check("read overwrite", (send(["op": "read"]).0 as? [String: Any])?["pair"] as? [String: String] == other, nil)
check("invalid pair refused", send(["op": "write", "pair": ["pub": "x"]]).1 == "invalid-pair", nil)
check("remove wrong pub refused", (send(["op": "remove", "pub": "P1", "epub": "E1"]).0 as? [String: Any])?["ok"] as? Bool == false, nil)
check("still stored", (send(["op": "read"]).0 as? [String: Any])?["pair"] as? [String: String] == other, nil)
check("remove", (send(["op": "remove", "pub": "P2", "epub": "E2"]).0 as? [String: Any])?["ok"] as? Bool == true, nil)
check("gone", (send(["op": "read"]).0 as? [String: Any])?["pair"] is NSNull, nil)
check("unknown op", send(["op": "zap"]).1 == "unknown-op", nil)
check("bad message", send(["x": 1]).1 == "invalid-message", nil)
print(failures == 0 ? "ALL PASS" : "\(failures) FAILED")
exit(failures == 0 ? 0 : 1)
