package com.iinpublic.app

import android.content.Context
import java.io.File

/**
 * Thin wrapper around the embedded Node runtime. Kept isolated so the rest of
 * the app does not depend on the exact JNI/libnode integration details.
 *
 * On first launch the bundled Node project (copied into assets at build time
 * from platforms/mobile/nodejs-project + the compiled dist/) is unpacked into
 * filesDir, then started in the embedded Node runtime.
 *
 * Wire-up: there is no Gradle dependency coordinate for nodejs-mobile (no
 * `com.janeasystems:nodejs-mobile` artifact exists) — see the detailed
 * correction in android/app/build.gradle for the real integration path
 * (download the release ZIP from
 * https://github.com/nodejs-mobile/nodejs-mobile/releases, wire libnode.so
 * via CMake/JNI, expose a `startNodeWithArguments(String[])` native method).
 * `startProject` below calls that native method once it exists; until then it
 * logs the intended invocation so this module still compiles and the
 * foreground service + WebView path are real and testable independent of the
 * native Node engine.
 */
object NodeBridge {

    private var started = false

    fun startProject(context: Context, scriptInProject: String, startPayloadJson: String) {
        if (started) return
        started = true

        val nodeDir = File(context.filesDir, "nodejs-project")
        unpackIfNeeded(context, nodeDir)

        // --- libnode JNI invocation (pseudocode against the wire-up documented
        // in android/app/build.gradle — no Gradle dependency provides this) ---
        // System.loadLibrary("node")            // libnode.so, see CMakeLists.txt setup
        // System.loadLibrary("native-lib")      // this app's JNI shim (not yet written)
        // startNodeWithArguments(arrayOf(        // native method backed by node::Start()
        //     "node", File(nodeDir, scriptInProject).absolutePath, startPayloadJson,
        // ))
        //
        // Until the JNI shim + libnode.so are added to the build, this is a
        // no-op stub so the module compiles; the foreground service path and
        // WebView are real.
        AndroidLog.i("NodeBridge", "would start node project '$scriptInProject' with $startPayloadJson in $nodeDir")
    }

    /**
     * Recursively copies `assets/nodejs-project/**` (staged at build time by
     * `stageNodeProject`/`stageNodeDist` in android/app/build.gradle — the
     * nodejs-project sources plus the compiled dist/server + dist/web) into
     * `filesDir/nodejs-project` so the embedded Node runtime has a writable
     * working directory (radisk persistence requires a writable filesystem;
     * the APK's assets are read-only).
     *
     * Idempotent: callers already guard with `if (nodeDir.exists()) return`,
     * but this is also safe to call again — existing files are left in place
     * and only missing ones are written, so an interrupted first-run copy
     * can resume on next launch instead of leaving a half-unpacked project.
     *
     * Note: if the nodejs-mobile-gradle plugin is added later, it stages and
     * unpacks its own copy of "the project" via its own asset convention; at
     * that point this manual copy of `assets/nodejs-project` either becomes
     * redundant (and can be deleted) or remains as the source the plugin
     * itself unpacks from, depending on how the AAR is wired up.
     */
    private fun unpackIfNeeded(context: Context, nodeDir: File) {
        val assetRoot = "nodejs-project"
        if (!nodeDir.exists() && !nodeDir.mkdirs()) {
            AndroidLog.e("NodeBridge", "could not create node dir: ${nodeDir.absolutePath}")
            return
        }
        try {
            copyAssetDirRecursive(context, assetRoot, nodeDir)
            AndroidLog.i("NodeBridge", "unpacked $assetRoot -> ${nodeDir.absolutePath}")
        } catch (e: Exception) {
            AndroidLog.e("NodeBridge", "failed to unpack $assetRoot: ${e.message}")
        }
    }

    private fun copyAssetDirRecursive(context: Context, assetPath: String, destDir: File) {
        val assetManager = context.assets
        // AssetManager.list() returns child entries for a directory and an
        // empty array for a file (or a directory with no children), so we use
        // it to distinguish files from directories without throwing.
        val children = assetManager.list(assetPath) ?: emptyArray()
        if (children.isEmpty()) {
            // Leaf asset (a file). Copy it unless it already exists with the
            // same size — cheap idempotency check for resumable unpacking.
            copyAssetFileIfNeeded(context, assetPath, destDir)
            return
        }
        if (!destDir.exists()) destDir.mkdirs()
        for (child in children) {
            // Recurse for every child; copyAssetFileIfNeeded itself detects
            // "this was actually a directory" (AssetManager.open() throws
            // FileNotFoundException on a directory path) and recurses back
            // into copyAssetDirRecursive, so we don't need a separate
            // file-vs-directory pre-check here.
            copyAssetDirRecursive(context, "$assetPath/$child", File(destDir, child))
        }
    }

    private fun copyAssetFileIfNeeded(context: Context, assetPath: String, destFile: File) {
        val assetManager = context.assets
        val opened = try {
            assetManager.open(assetPath)
        } catch (e: java.io.FileNotFoundException) {
            // AssetManager.list() returned no children, but open() also
            // failed: this is a genuinely empty directory (not a file), so
            // just create it. (NOT a recursive call back into
            // copyAssetDirRecursive — that would re-list the same empty path
            // and loop forever.)
            if (!destFile.exists()) destFile.mkdirs()
            return
        }
        opened.use { input ->
            destFile.parentFile?.let { if (!it.exists()) it.mkdirs() }
            if (destFile.exists() && destFile.length() == input.available().toLong() && input.available() > 0) {
                // Best-effort skip for files that already look fully copied.
                return
            }
            java.io.FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        }
    }
}

/** Tiny logging indirection so this file has no hard android.util import churn. */
object AndroidLog {
    fun i(tag: String, msg: String) = android.util.Log.i(tag, msg)
    fun e(tag: String, msg: String) = android.util.Log.e(tag, msg)
}
