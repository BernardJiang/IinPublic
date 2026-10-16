package com.iinpublic.app

/** Keeps physical-test network overrides out of production launcher behavior. */
internal object AndroidLaunchNetworkPolicy {
    fun allowsTestOverrides(debugBuild: Boolean): Boolean = debugBuild

    fun hubOverride(debugBuild: Boolean, requested: String?): String? =
        requested?.takeIf { debugBuild && it.isNotBlank() }

    fun disableLanDiscovery(debugBuild: Boolean, requested: Boolean): Boolean =
        debugBuild && requested
}
