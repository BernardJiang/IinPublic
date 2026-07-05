import Foundation
import NodeMobile

/// Boots the embedded Node (Gun P2P) runtime via nodejs-mobile on iOS.
final class NodeRunner {

    static let shared = NodeRunner()
    static let localPort = 8088
    static let hubGunURL = "https://www.iinpublic.com/gun"

    private var started = false

    func start() {
        guard !started else { return }
        started = true

        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self = self else { return }
            autoreleasepool {  // Node.js runs forever on this thread so autorelease memory won't leak
                self.runNode()
            }
        }
    }

    private func runNode() {
        let fm = FileManager.default

        guard let mainJS = Bundle.main.url(forResource: "main", withExtension: "js"),
              let packageJSON = Bundle.main.url(forResource: "package", withExtension: "json"),
              let bundledDist = Bundle.main.url(forResource: "dist", withExtension: nil) else {
            NSLog("[NodeRunner] bundled node assets missing; run npm run build:embedded before building iOS")
            return
        }

        let supportDir = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let projectDir = supportDir.appendingPathComponent("nodejs-project")
        try? fm.createDirectory(at: projectDir, withIntermediateDirectories: true)

        copyReplacing(mainJS, to: projectDir.appendingPathComponent("main.js"))
        copyReplacing(packageJSON, to: projectDir.appendingPathComponent("package.json"))
        copyReplacing(bundledDist, to: projectDir.appendingPathComponent("dist"))

        let dataDir = projectDir.appendingPathComponent("node-data")
        try? fm.createDirectory(at: dataDir, withIntermediateDirectories: true)

        setenv("IINPUBLIC_EMBEDDED_NODE", "1", 1)
        setenv("IINPUBLIC_PLATFORM", "ios", 1)
        setenv("IINPUBLIC_LOCAL_PORT", "\(NodeRunner.localPort)", 1)
        setenv("PORT", "\(NodeRunner.localPort)", 1)
        setenv("IINPUBLIC_HUB_GUN_URL", NodeRunner.hubGunURL, 1)
        setenv("IINPUBLIC_DATA_DIR", dataDir.path, 1)
        setenv("IINPUBLIC_LOOPBACK_ONLY", "1", 1)
        setenv("NODEJS_MOBILE_PLATFORM", "ios", 1)

        let oldCwd = fm.currentDirectoryPath
        _ = fm.changeCurrentDirectoryPath(projectDir.path)

        let args = ["node", "main.js"]
        let cArgs = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: args.count + 1)
        for (i, arg) in args.enumerated() {
            cArgs[i] = strdup(arg)
        }
        cArgs[args.count] = nil

        node_start(Int32(args.count), cArgs)

        for i in 0..<args.count {
            free(cArgs[i])
        }
        cArgs.deallocate()
        _ = fm.changeCurrentDirectoryPath(oldCwd)
    }

    private func copyReplacing(_ source: URL, to destination: URL) {
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            try? fm.removeItem(at: destination)
        }
        do {
            try fm.copyItem(at: source, to: destination)
        } catch {
            NSLog("[NodeRunner] failed to copy \(source.lastPathComponent): \(error)")
        }
    }
}
