import CoreBluetooth
import CryptoKit
import Foundation
import Network
import UIKit
import WebKit

/// Open Apple platform adapter. Radio/service identifiers are discovery hints only;
/// the web layer must verify a SEA-signed connectivity binding before trust.
final class AppleConnectivityBridge: NSObject, WKScriptMessageHandler, CBCentralManagerDelegate, CBPeripheralManagerDelegate {
    static let scriptName = "iinpublicNearby"
    static let bonjourType = "_iinpublic._tcp"
    static let bleService = CBUUID(string: "7DB78A2E-30F4-4E86-9FB7-33A318EA7E81")

    weak var webView: WKWebView?
    private let queue = DispatchQueue(label: "com.iinpublic.connectivity")
    private var browser: NWBrowser?
    private var service: NetService?
    private var central: CBCentralManager?
    private var peripheral: CBPeripheralManager?
    private var seaPub = ""

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String else { return }
        switch action {
        case "capabilities": emit(name: "iinpublic-nearby-capabilities", detail: capabilities())
        case "start":
            seaPub = body["seaPub"] as? String ?? ""
            startBonjour(); startBluetooth()
        case "stop": stop()
        case "share":
            guard let urlString = body["url"] as? String, let url = URL(string: urlString) else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, let controller = self.webView?.window?.rootViewController else { return }
                controller.present(UIActivityViewController(activityItems: [url], applicationActivities: nil), animated: true)
            }
        default: emit(name: "iinpublic-nearby-status", detail: ["provider": "apple", "state": "failed", "reason": "unknown-action"])
        }
    }

    func capabilities() -> [String: Any] {
        var value: [String: Any] = [
            "version": 1, "bonjour": true, "ble": true, "bleDataTransport": false,
            "ipfsOverBle": false, "airDropBackgroundSync": false, "multipeerRequired": false,
        ]
        if #available(iOS 26.0, *) { value["wifiAwareApiAvailable"] = true } else { value["wifiAwareApiAvailable"] = false }
        return value
    }

    private func startBonjour() {
        let parameters = NWParameters.tcp
        parameters.includePeerToPeer = true
        let browser = NWBrowser(for: .bonjour(type: Self.bonjourType, domain: "local."), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready: self?.emit(name: "iinpublic-nearby-status", detail: ["provider": "apple-bonjour", "state": "running"])
            case .failed(let error): self?.emit(name: "iinpublic-nearby-status", detail: ["provider": "apple-bonjour", "state": "failed", "reason": error.localizedDescription])
            default: break
            }
        }
        browser.browseResultsChangedHandler = { [weak self] results, _ in
            for result in results {
                guard case let .service(name, type, domain, _) = result.endpoint, name != UIDevice.current.identifierForVendor?.uuidString else { continue }
                self?.emitCandidate(source: "mdns", transportId: "bonjour:\(name)", endpoint: "ws://\(name).\(type)\(domain):\(NodeRunner.localPort)/gun", capabilities: ["bonjour", "ip", "gun-websocket"])
            }
        }
        self.browser = browser
        browser.start(queue: queue)

        let name = UIDevice.current.identifierForVendor?.uuidString ?? UUID().uuidString
        let service = NetService(domain: "local.", type: "\(Self.bonjourType).", name: name, port: Int32(NodeRunner.localPort))
        service.includesPeerToPeer = true; service.publish(); self.service = service
    }

    private func startBluetooth() {
        central = CBCentralManager(delegate: self, queue: queue)
        peripheral = CBPeripheralManager(delegate: self, queue: queue)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else { emit(name: "iinpublic-nearby-status", detail: ["provider": "apple-ble", "state": central.state == .unauthorized ? "permission-denied" : "unavailable"]); return }
        central.scanForPeripherals(withServices: [Self.bleService], options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        guard let data = (advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data])?[Self.bleService], let id = String(data: data, encoding: .utf8) else { return }
        emitCandidate(source: "platform-nearby", transportId: "ble:\(id)", endpoint: nil, capabilities: ["ble-discovery", "upgrade-required"])
    }

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        guard peripheral.state == .poweredOn else { return }
        peripheral.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [Self.bleService], CBAdvertisementDataServiceDataKey: [Self.bleService: Data(rotatingId().utf8)]])
        emit(name: "iinpublic-nearby-status", detail: ["provider": "apple-ble", "state": "running"])
    }

    func stop() {
        browser?.cancel(); browser = nil; service?.stop(); service = nil
        central?.stopScan(); central = nil; peripheral?.stopAdvertising(); peripheral = nil
    }

    private func rotatingId() -> String {
        let epoch = UInt64(Date().timeIntervalSince1970 / 900)
        return SHA256.hash(data: Data("\(seaPub):\(epoch)".utf8)).prefix(12).map { String(format: "%02x", $0) }.joined()
    }

    private func emitCandidate(source: String, transportId: String, endpoint: String?, capabilities: [String]) {
        emit(name: "iinpublic-nearby-candidate", detail: ["version": 1, "source": source, "transportId": transportId, "endpoint": endpoint as Any, "capabilities": capabilities, "authenticated": false])
    }

    private func emit(name: String, detail: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(detail), let data = try? JSONSerialization.data(withJSONObject: detail), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent(\(String(reflecting: name)),{detail:\(json)}));") }
    }
}
