package com.iinpublic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import org.json.JSONObject

/**
 * Hosts the embedded Node (Gun P2P) runtime via nodejs-mobile as an Android
 * foreground service.
 *
 * The Node project (platforms/mobile/nodejs-project, copied into assets at
 * build time) boots the SAME embedded local node used on desktop. It dials the
 * hub for discovery only and serves the web SPA on 127.0.0.1:<port>, which
 * MainActivity's WebView then loads.
 *
 * NOTE: `startNodeWithScript` / `startNodeProject` come from the nodejs-mobile
 * AAR (`com.janeasystems:nodejs-mobile:<ver>`). Add that dependency and the
 * `nodejs-mobile-gradle` plugin (see android/app/build.gradle) to resolve it.
 */
class NodeForegroundService : Service() {

    companion object {
        const val CHANNEL_ID = "iinpublic_node"
        const val NOTIF_ID = 1001
        const val LOCAL_PORT = 8088
        const val HUB_GUN_URL = "https://www.iinpublic.com/gun"

        @Volatile var nodeStarted = false
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIF_ID, buildNotification())
        if (!nodeStarted) {
            nodeStarted = true
            startEmbeddedNode()
        }
        return START_STICKY
    }

    private fun startEmbeddedNode() {
        val dataDir = filesDir.absolutePath + "/node-data"
        java.io.File(dataDir).mkdirs()

        // Pass host config to the Node project via env-style argument JSON.
        // The nodejs-mobile bridge channel delivers this as the {type:'start'}
        // message handled in nodejs-project/main.js.
        val startPayload = JSONObject().apply {
            put("type", "start")
            put("dataDir", dataDir)
            put("platform", "android")
            put("localPort", LOCAL_PORT)
            put("hub", HUB_GUN_URL)
        }

        Thread {
            // The nodejs-mobile project is unpacked from assets to filesDir on
            // first run by NodeJsMobile.getInstance()... (see README).
            NodeBridge.startProject(this, "main.js", startPayload.toString())
        }.start()
    }

    private fun buildNotification(): Notification {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            mgr.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID,
                    "IinPublic peer node",
                    NotificationManager.IMPORTANCE_LOW,
                )
            )
        }
        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID) else Notification.Builder(this)
        return builder
            .setContentTitle("IinPublic")
            .setContentText("Peer node running — discovering and talking P2P")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setOngoing(true)
            .build()
    }
}
