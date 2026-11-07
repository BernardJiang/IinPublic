# 83-incoming-talk-gesture-actions

covers: SPEC-3.6, SPEC-13.6

Verifies swipe/tap gesture semantics on incoming Talks rows. For Flow, Survey, and Route talks:
a down drag retains the talk (role becomes `copied`), a left drag Ignores it (row disappears,
role becomes `ignored`, restorable from the Ignored filter), and a right drag is deliberately a
no-op — it must not invent an answer. For tag talks, Pass (left swipe) is content-scoped: a new
tag with the same content from a different sender is still suppressed; tapping an ignored row
restores it; and a Like can be reversed to a Pass (and back) from the outgoing list, with the
Me-tab answer entry appearing and disappearing in step.
