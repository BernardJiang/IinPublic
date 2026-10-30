package com.iinpublic.app

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.util.concurrent.Executors

/** Policy/events bridge. Identity material never crosses this WebView interface. */
class BackgroundAgentJavascriptBridge(private val webView: WebView) {
    // JavascriptInterface calls suspend the WebView's JS thread until they return. The native
    // policy store and loopback node can take seconds during foreground recovery, so never run
    // those operations on a bridge call from the page.
    private val io = Executors.newSingleThreadExecutor()
    private val policyIo = Executors.newSingleThreadExecutor()

    @JavascriptInterface fun configure(configJson: String): Boolean = enqueue(policyIo) {
        NodeForegroundService.configureBackgroundAgent(configJson)
    }

    @JavascriptInterface fun requestEvents(requestId: String): Boolean {
        if (requestId.length !in 1..80 || !requestId.all { it.isLetterOrDigit() || it == '-' || it == '_' }) return false
        return enqueue {
            val events = runCatching { NodeForegroundService.backgroundAgentEvents() }
                .getOrDefault("{\"events\":[]}")
            val script = "window.dispatchEvent(new CustomEvent('iinpublic-background-agent-events', " +
                "{detail:{id:${JSONObject.quote(requestId)},payload:${JSONObject.quote(events)}}}));"
            webView.post {
                if (webView.isAttachedToWindow) webView.evaluateJavascript(script, null)
            }
        }
    }

    @JavascriptInterface fun acknowledgeAsync(idsJson: String): Boolean = enqueue {
        NodeForegroundService.acknowledgeBackgroundAgentEvents(idsJson)
    }

    private fun enqueue(executor: java.util.concurrent.Executor = io, action: () -> Unit): Boolean = try {
        executor.execute(action)
        true
    } catch (_: Exception) {
        false
    }

    fun close() {
        io.shutdownNow()
        policyIo.shutdownNow()
    }

    @JavascriptInterface fun status(): String = NodeForegroundService.backgroundAgentStatus()

    /** The secret this app's embedded node requires on loopback (the device core, OPEN-91 P5). */
    @JavascriptInterface fun localNodeToken(): String = NodeForegroundService.localNodeToken()
}
