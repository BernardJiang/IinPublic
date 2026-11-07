# 79-techsupport-survives-restrictive-filters

covers: SPEC-3.2, SPEC-19.7

Sets maximally restrictive talk intake filters (language, distance, age, grammar, dirty words) on an
ordinary, non-age-verified user — the strictest possible receiver configuration — and proves a
TechSupport DM still arrives: the signed greeting still renders, and a live FAQ auto-answer round
trip through a real K3-mode TechSupport session still delivers. Intake filters gate only the
talk-delivery path (`talkPassesIntakeFilters`); the support conversation is plain DM messaging,
structurally outside that pipeline.
