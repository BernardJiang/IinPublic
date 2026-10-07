package com.iinpublic.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.Locale
import java.util.concurrent.Executors

/**
 * OPEN-38: receive while the phone sleeps. Android 12+ freezes the WebView page while dozing,
 * so the page's mesh can't take delivery — senders then fall back to the encrypted mailbox. This
 * runs inside the always-on foreground service and polls the embedded node's own
 * `GET /api/mailbox/<user>` (which already merges this phone's local envelopes with the hub's).
 * It only reads envelope ids — never ciphertext, sender, or kind — and, while the app is not in
 * the foreground, posts one "new activity" notification for ids it hasn't seen. Opening the app
 * lets the page drain the mailbox exactly as it already does on wake.
 */
internal class MailboxWatcher(private val context: Context, private val port: Int) {
    companion object {
        private const val PREFS = "iinpublic_mailbox_watch"
        private const val RECIPIENT_PREF = "recipient"
        private const val SEEN_PREF = "seen_ids"
        private const val CHANNEL_ID = "iinpublic_activity"
        private const val NOTIF_ID = 2
        internal const val POLL_INTERVAL_MS = 30_000L
        private const val MAX_SEEN = 500

        /** Envelope ids present now that were not present at the last poll (pure, unit-tested). */
        internal fun newIds(current: Collection<String>, seen: Collection<String>): Set<String> =
            current.toSet() - seen.toSet()

        /** Ids worth remembering: what still exists now (drained ones fall away), bounded. */
        internal fun nextSeen(current: Collection<String>): Set<String> = current.toSet().take(MAX_SEEN).toSet()

        /**
         * Posts (or replaces) the single "new activity" notification. Shared by the mailbox poll
         * (page frozen) and the page itself (alive but hidden) so the user sees one entry.
         */
        internal fun postActivityNotification(context: Context, text: String) {
            val mgr = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val zh = Locale.getDefault().language == "zh"
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                mgr.createNotificationChannel(
                    NotificationChannel(CHANNEL_ID, if (zh) "新动态" else "New activity", NotificationManager.IMPORTANCE_DEFAULT)
                )
            }
            val open = PendingIntent.getActivity(
                context,
                3,
                Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
                Notification.Builder(context, CHANNEL_ID) else Notification.Builder(context)
            val notification = builder
                .setContentTitle("IinPublic")
                .setContentText(text.take(200))
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentIntent(open)
                .setAutoCancel(true)
                .build()
            try {
                mgr.notify(NOTIF_ID, notification)
            } catch (_: SecurityException) {
                // POST_NOTIFICATIONS not granted (Android 13+): the page still shows it on open.
            }
        }

        /** Envelope ids from a `GET /api/mailbox/<id>` body; malformed input yields none. */
        internal fun parseEnvelopeIds(body: String): List<String> = try {
            val envelopes = JSONObject(body).optJSONArray("envelopes")
            if (envelopes == null) emptyList() else (0 until envelopes.length())
                .mapNotNull { envelopes.optJSONObject(it)?.optString("id")?.takeIf { id -> id.isNotBlank() } }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val handler = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var running = false
    private val tick = object : Runnable {
        override fun run() {
            io.execute { pollOnce() }
            if (running) handler.postDelayed(this, POLL_INTERVAL_MS)
        }
    }

    fun setRecipient(userId: String) {
        val clean = userId.trim().take(128)
        if (clean == prefs.getString(RECIPIENT_PREF, "")) return
        // A different identity on this install: forget the old one's seen ids.
        prefs.edit().putString(RECIPIENT_PREF, clean).remove(SEEN_PREF).apply()
    }

    fun start() {
        if (running) return
        running = true
        handler.postDelayed(tick, POLL_INTERVAL_MS)
    }

    fun stop() {
        running = false
        handler.removeCallbacks(tick)
    }

    private fun pollOnce() {
        val recipient = prefs.getString(RECIPIENT_PREF, "").orEmpty()
        if (recipient.isBlank()) return
        val ids = fetchEnvelopeIds(recipient) ?: return
        val seen = prefs.getStringSet(SEEN_PREF, emptySet()).orEmpty()
        val fresh = newIds(ids, seen)
        prefs.edit().putStringSet(SEEN_PREF, nextSeen(ids)).apply()
        // In the foreground the page is live and handles everything itself.
        if (fresh.isEmpty() || MainActivity.isInForeground) return
        notifyNewActivity(fresh.size)
    }

    private fun fetchEnvelopeIds(recipient: String): List<String>? = try {
        val path = URLEncoder.encode(recipient, "UTF-8").replace("+", "%20")
        val conn = URL("http://127.0.0.1:$port/api/mailbox/$path").openConnection() as HttpURLConnection
        conn.connectTimeout = 5_000
        conn.readTimeout = 10_000
        try {
            if (conn.responseCode != 200) null
            else parseEnvelopeIds(conn.inputStream.bufferedReader().use { it.readText() })
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        null
    }

    private fun notifyNewActivity(count: Int) {
        val zh = Locale.getDefault().language == "zh"
        postActivityNotification(
            context,
            if (zh) "你有 $count 条新动态 — 打开 IinPublic 查看"
            else if (count == 1) "You have new activity — open IinPublic to see it"
            else "You have $count new items — open IinPublic to see them",
        )
    }
}
