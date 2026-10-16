package com.iinpublic.app

import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidLaunchNetworkPolicyTest {
    @Test
    fun releaseIgnoresEveryTestNetworkOverride() {
        assertFalse(AndroidLaunchNetworkPolicy.allowsTestOverrides(debugBuild = false))
        assertNull(AndroidLaunchNetworkPolicy.hubOverride(false, "http://attacker.invalid/gun"))
        assertFalse(AndroidLaunchNetworkPolicy.disableLanDiscovery(false, requested = true))
    }

    @Test
    fun debugBuildAllowsThePhysicalTestHarnessOverrides() {
        assertTrue(AndroidLaunchNetworkPolicy.allowsTestOverrides(debugBuild = true))
        assertEquals(
            "http://127.0.0.1:9078/gun",
            AndroidLaunchNetworkPolicy.hubOverride(true, "http://127.0.0.1:9078/gun"),
        )
        assertTrue(AndroidLaunchNetworkPolicy.disableLanDiscovery(true, requested = true))
    }
}
