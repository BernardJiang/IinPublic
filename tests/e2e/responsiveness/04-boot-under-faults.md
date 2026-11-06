covers: SPEC-5.1, SPEC-5.2, SPEC-5.4

# Boot under network faults

Cold boot must finish within the faulted-start budget when all hub calls fail or hang, or when one
major endpoint family hangs. Navigation remains responsive, and a Talk submitted while startup is
still completing is retained instead of being dropped.
