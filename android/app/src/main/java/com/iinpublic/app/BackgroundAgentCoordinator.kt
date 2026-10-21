package com.iinpublic.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Native custody -> loopback embedded-node boundary for unattended Talk processing. */
internal class BackgroundAgentCoordinator(
    context: Context,
    private val port: Int,
    private val token: String,
) {
    private val appContext = context.applicationContext
    private val store = BackgroundAgentStore(appContext)
    private val io = Executors.newSingleThreadExecutor()

    fun configure(configJson: String) {
        val parsed = JSONObject(configJson)
        require(parsed.optInt("version") == 1) { "unsupported background config" }
        require(store.write(parsed.toString())) { "background config commit failed" }
        io.execute { runCatching { provision() } }
    }

    fun drainBlocking(): Int {
        if (!provision()) return 0
        val response = request("POST", "/api/native/background-agent/drain", "{}") ?: return 0
        return response.optJSONArray("events")?.length() ?: 0
    }

    fun eventsBlocking(): String {
        if (!provision()) return JSONObject().put("events", JSONArray()).toString()
        return request("GET", "/api/native/background-agent/events", null)?.toString()
            ?: JSONObject().put("events", JSONArray()).toString()
    }

    fun acknowledgeBlocking(idsJson: String): Boolean {
        val ids = runCatching { JSONArray(idsJson) }.getOrNull() ?: return false
        if (!provision()) return false
        return request("POST", "/api/native/background-agent/events/ack", JSONObject().put("ids", ids).toString()) != null
    }

    fun statusBlocking(): String = if (!provision()) {
        JSONObject().put("provisioned", false).put("enabled", false).put("pendingEvents", 0).toString()
    } else {
        request("GET", "/api/native/background-agent/events", null)?.optJSONObject("status")?.toString()
            ?: JSONObject().put("provisioned", true).put("enabled", false).put("pendingEvents", 0).toString()
    }

    private fun provision(): Boolean {
        val config = runCatching { store.read() }.getOrNull() ?: return false
        val pair = runCatching { NativeCustodyBridge(appContext).readPairForBackground() }.getOrNull() ?: return false
        val body = JSONObject().put("config", JSONObject(config)).put("pair", pair).toString()
        return request("POST", "/api/native/background-agent/provision", body) != null
    }

    private fun request(method: String, path: String, body: String?): JSONObject? = try {
        val connection = URL("http://127.0.0.1:$port$path").openConnection() as HttpURLConnection
        connection.requestMethod = method
        connection.connectTimeout = 5_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("Authorization", "Bearer $token")
        if (body != null) {
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        }
        try {
            if (connection.responseCode !in 200..299) null
            else JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
        } finally {
            connection.disconnect()
        }
    } catch (_: Exception) {
        null
    }
}
