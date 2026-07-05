package com.iinpublic.app

import android.content.Context
import java.io.File

/**
 * Thin wrapper around the embedded Node runtime (nodejs-mobile v18.20.4).
 *
 * On first launch the bundled Node project (copied into assets at build time
 * from platforms/mobile/nodejs-project + the compiled dist/) is unpacked into
 * filesDir, then started in the embedded Node runtime via JNI:
 *
 *     nativeStartNode(dataDir, "main.js", 8088, hubUrl)
 *       ↳ sets IINPUBLIC_* env vars
 *       ↳ calls node::Start() in a detached pthread
 *         ↳ runs main.js → boots Express on 127.0.0.1:8088 + Gun mesh
 */
object NodeBridge {

    private var started = false

    init {
        try {
            System.loadLibrary("native-lib")
        } catch (e: UnsatisfiedLinkError) {
            android.util.Log.e("NodeBridge", "failed to load native-lib: ${e.message}")
            throw e
        }
    }

    /* ── JNI entry point ──────────────────────────────────────────────── */
    @JvmStatic
    external fun nativeStartNode(dataDir: String, scriptPath: String, port: Int, hubUrl: String)

    /** Called by NodeForegroundService.onStartCommand(). */
    fun startProject(context: Context, scriptInProject: String, nodePort: Int, dataDirPath: String, hubUrl: String) {
        if (started) return
        started = true

        val nodeDataDir = File(dataDirPath).absolutePath
        android.util.Log.i("NodeBridge", "unpacking assets → $nodeDataDir")
        unpackIfNeeded(context, File(nodeDataDir))

        android.util.Log.i("NodeBridge", "calling nativeStartNode(port=$nodePort, hub=$hubUrl)")
        nativeStartNode(nodeDataDir, scriptInProject, nodePort, hubUrl)
    }

    /* ── asset unpacking ──────────────────────────────────────────────── */

    /**
     * Recursively copies all assets/nodejs-project files (staged at build time by
     * stageNodeProject/stageNodeDist in android/app/build.gradle — the
     * nodejs-project sources plus the compiled dist/server and dist/web) into
     * `filesDir/nodejs-project` so the embedded Node runtime has a writable
     * working directory (radisk persistence requires a writable filesystem;
     * the APK's assets are read-only).
     */
    private fun unpackIfNeeded(context: Context, nodeDir: File) {
        val assetRoot = "nodejs-project"
        if (!nodeDir.exists() && !nodeDir.mkdirs()) {
            android.util.Log.e("NodeBridge", "could not create node dir: ${nodeDir.absolutePath}")
            return
        }
        try {
            copyAssetDirRecursive(context, assetRoot, nodeDir)
            android.util.Log.i("NodeBridge", "unpacked $assetRoot -> ${nodeDir.absolutePath}")
        } catch (e: Exception) {
            android.util.Log.e("NodeBridge", "failed to unpack $assetRoot: ${e.message}")
        }
    }

    private fun copyAssetDirRecursive(context: Context, assetPath: String, destDir: File) {
        val children = context.assets.list(assetPath) ?: emptyArray()
        if (children.isEmpty()) {
            copyAssetFileIfNeeded(context, assetPath, destDir)
            return
        }
        if (!destDir.exists()) destDir.mkdirs()
        for (child in children) {
            copyAssetDirRecursive(context, "$assetPath/$child", File(destDir, child))
        }
    }

    private fun copyAssetFileIfNeeded(context: Context, assetPath: String, destFile: File) {
        val opened = try {
            context.assets.open(assetPath)
        } catch (e: java.io.FileNotFoundException) {
            if (!destFile.exists()) destFile.mkdirs()
            return
        }
        opened.use { input ->
            destFile.parentFile?.let { if (!it.exists()) it.mkdirs() }
            if (destFile.exists() && destFile.length() == input.available().toLong() && input.available() > 0) {
                return
            }
            java.io.FileOutputStream(destFile).use { output ->
                input.copyTo(output)
            }
        }
    }
}
