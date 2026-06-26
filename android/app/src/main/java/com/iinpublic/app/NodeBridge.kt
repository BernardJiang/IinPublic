package com.iinpublic.app

import android.content.Context
import java.io.File

/**
 * Thin wrapper around the nodejs-mobile AAR. Kept isolated so the rest of the
 * app does not depend on the exact nodejs-mobile API surface (which differs
 * slightly between the raw AAR and the React Native module).
 *
 * On first launch the bundled Node project (copied into assets at build time
 * from platforms/mobile/nodejs-project + the compiled dist/) is unpacked into
 * filesDir, then started in the embedded Node runtime.
 *
 * Wire-up (see android/app/build.gradle):
 *   implementation 'com.janeasystems:nodejs-mobile:0.3.3'   // or current
 * and the nodejs-mobile gradle plugin that bundles libnode + assets.
 *
 * The calls below are written against the standard nodejs-mobile Android API:
 *   NodeJsMobile.getInstance(context)
 *   instance.startNodeProject("main.js")
 *   instance.sendMessage(json)   // delivered to cordova-bridge channel
 * Replace with the exact symbols of the AAR version you pin.
 */
object NodeBridge {

    private var started = false

    fun startProject(context: Context, scriptInProject: String, startPayloadJson: String) {
        if (started) return
        started = true

        val nodeDir = File(context.filesDir, "nodejs-project")
        // The nodejs-mobile gradle plugin copies the project into assets and the
        // AAR helper unpacks it; if you manage assets manually, unpack here.
        unpackIfNeeded(context, nodeDir)

        // --- nodejs-mobile AAR invocation (pseudocode against pinned version) ---
        // val node = NodeJsMobile.getInstance(context)
        // node.setListener { msg -> /* forward node-ready/node-error to UI */ }
        // node.startNodeProject(scriptInProject)
        // node.sendMessage(startPayloadJson)
        //
        // Until the AAR is added to the build, this is a no-op stub so the
        // module compiles; the foreground service path and WebView are real.
        AndroidLog.i("NodeBridge", "would start node project '$scriptInProject' with $startPayloadJson in $nodeDir")
    }

    private fun unpackIfNeeded(context: Context, nodeDir: File) {
        if (nodeDir.exists()) return
        // Implementation note: copy from assets/nodejs-project/** recursively.
        // The nodejs-mobile-gradle plugin normally handles this automatically.
    }
}

/** Tiny logging indirection so this file has no hard android.util import churn. */
object AndroidLog {
    fun i(tag: String, msg: String) = android.util.Log.i(tag, msg)
}
