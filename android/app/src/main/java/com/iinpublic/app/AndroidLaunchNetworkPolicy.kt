package com.iinpublic.app

/** Keeps physical-test network overrides out of production launcher behavior. */
internal object AndroidLaunchNetworkPolicy {
    fun allowsTestOverrides(debugBuild: Boolean): Boolean = debugBuild

    /**
     * Test automation skips the first-launch permission dialogs (`skip_first_launch_location`) and
     * the first-run tour (`skip_first_run_tour`). Debug builds only: a release always shows both.
     */
    fun skipFirstLaunchPrompts(debugBuild: Boolean, requested: Boolean): Boolean = debugBuild && requested

    fun hubOverride(debugBuild: Boolean, requested: String?): String? =
        requested?.takeIf { debugBuild && it.isNotBlank() }

    fun disableLanDiscovery(debugBuild: Boolean, requested: Boolean): Boolean =
        debugBuild && requested
}
