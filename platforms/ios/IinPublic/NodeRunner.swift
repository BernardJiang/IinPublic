import Foundation

/// Boots the embedded Node (Gun P2P) runtime via nodejs-mobile on iOS.
///
/// The bundled Node project (platforms/mobile/nodejs-project + compiled dist/)
/// is copied into the app bundle at build time. On launch we start it on a
/// background thread; it boots the SAME embedded local node as desktop —
/// discovery via the hub, on-device persistence, web SPA served on
/// 127.0.0.1:<port>.
///
/// nodejs-mobile for iOS exposes the C entrypoint `startNodeWithArguments`
/// (bridged via the NodeMobile framework). We pass the script path inside the
/// app's copied project plus the data dir in the app sandbox.
final class NodeRunner {

    static let shared = NodeRunner()
    static let localPort = 8088
    static let hubGunURL = "https://www.iinpublic.com/gun"

    private var started = false

    func start() {
        guard !started else { return }
        started = true

        let fm = FileManager.default
        let sandbox = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let dataDir = sandbox.appendingPathComponent("node-data")
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)

        // The Node project is shipped read-only in the bundle; copy to a
        // writable location so radisk + project resolution work.
        guard let bundledProject = Bundle.main.url(
            forResource: "nodejs-project", withExtension: nil
        ) else {
            NSLog("[NodeRunner] nodejs-project missing from app bundle")
            return
        }
        let workProject = sandbox.appendingPathComponent("nodejs-project")
        if !fm.fileExists(atPath: workProject.path) {
            try? fm.copyItem(at: bundledProject, to: workProject)
        }

        let mainScript = workProject.appendingPathComponent("main.js").path

        // Environment passed to the embedded node (read in main.js / embedded-node.ts).
        setenv("IINPUBLIC_EMBEDDED_NODE", "1", 1)
        setenv("IINPUBLIC_PLATFORM", "ios", 1)
        setenv("IINPUBLIC_LOCAL_PORT", String(NodeRunner.localPort), 1)
        setenv("PORT", String(NodeRunner.localPort), 1)
        setenv("IINPUBLIC_HUB_GUN_URL", NodeRunner.hubGunURL, 1)
        setenv("IINPUBLIC_DATA_DIR", dataDir.path, 1)
        setenv("IINPUBLIC_LOOPBACK_ONLY", "1", 1)
        setenv("NODEJS_MOBILE_PLATFORM", "ios", 1)

        Thread {
            // NodeMobile bridge — pinned framework provides this symbol.
            // NodeRunnerBridge.startEngine(withArguments: ["node", mainScript])
            //
            // Until the NodeMobile framework is linked (see Podfile), this logs
            // the intended invocation so the Swift target still compiles.
            NSLog("[NodeRunner] would start node with script: \(mainScript)")
        }.start()
    }
}
