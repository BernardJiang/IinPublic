package com.iinpublic.app

import android.webkit.JavascriptInterface

/** Policy/events bridge. Identity material never crosses this WebView interface. */
class BackgroundAgentJavascriptBridge {
    @JavascriptInterface fun configure(configJson: String): Boolean =
        NodeForegroundService.configureBackgroundAgent(configJson)

    @JavascriptInterface fun events(): String = NodeForegroundService.backgroundAgentEvents()

    @JavascriptInterface fun acknowledge(idsJson: String): Boolean =
        NodeForegroundService.acknowledgeBackgroundAgentEvents(idsJson)

    @JavascriptInterface fun status(): String = NodeForegroundService.backgroundAgentStatus()

    /** The secret this app's embedded node requires on loopback (the device core, OPEN-91 P5). */
    @JavascriptInterface fun localNodeToken(): String = NodeForegroundService.localNodeToken()
}
