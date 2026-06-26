import UIKit
import WebKit

/// Loads the reused web SPA in a WKWebView from the local embedded node.
///
/// The WebView is UI-only; the Node process is the actual Gun P2P peer. This
/// sidesteps WKWebView's limited WebRTC support — the mesh/transport lives in
/// Node, the WebView just renders the existing browser UI over loopback.
final class ViewController: UIViewController {

    private var webView: WKWebView!

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: config)
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        NodeRunner.shared.start()
        waitForNodeThenLoad()
    }

    private func waitForNodeThenLoad(deadline: Date = Date().addingTimeInterval(20)) {
        let port = NodeRunner.localPort
        let url = URL(string: "http://127.0.0.1:\(port)/health")!
        var req = URLRequest(url: url)
        req.timeoutInterval = 1
        URLSession.shared.dataTask(with: req) { [weak self] _, resp, _ in
            guard let self = self else { return }
            if (resp as? HTTPURLResponse) != nil {
                DispatchQueue.main.async {
                    self.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:\(port)/")!))
                }
            } else if Date() < deadline {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                    self.waitForNodeThenLoad(deadline: deadline)
                }
            }
        }.resume()
    }
}
