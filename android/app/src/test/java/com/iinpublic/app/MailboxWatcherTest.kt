package com.iinpublic.app

import org.junit.Assert.assertEquals
import org.junit.Test

class MailboxWatcherTest {
    @Test
    fun newIdsAreOnlyThoseNotSeenBefore() {
        assertEquals(setOf("c"), MailboxWatcher.newIds(listOf("a", "b", "c"), setOf("a", "b")))
        assertEquals(emptySet<String>(), MailboxWatcher.newIds(listOf("a"), setOf("a", "z")))
    }

    @Test
    fun drainedEnvelopesFallOutOfTheSeenSet() {
        // "a" was drained by the page; only what still exists is remembered.
        assertEquals(setOf("b"), MailboxWatcher.nextSeen(listOf("b")))
    }

    @Test
    fun aReappearingIdAfterDrainIsNewAgain() {
        val seen = MailboxWatcher.nextSeen(emptyList())
        assertEquals(setOf("a"), MailboxWatcher.newIds(listOf("a"), seen))
    }
}
