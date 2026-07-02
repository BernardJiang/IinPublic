# 31: Intake filter settings persist across page reload

Verify that all intake filter settings in the Settings tab persist after `page.reload()`.
Changes are made to: allowed incoming languages, min/max distance, grammar/dirty words toggles,
talk type filters (flow/survey/tag/route), and custom blocked terms.
After reload, navigates back to settings and asserts every changed control still shows the modified value.
