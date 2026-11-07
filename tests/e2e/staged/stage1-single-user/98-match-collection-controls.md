# 98-match-collection-controls

covers: SPEC-3.7, SPEC-6.1

Match-collection (outing) controls on the phone-width Nearby list: the outing handlers stay wired
after their UI entry points moved into the collection card. Normalizes the default-on collection
state to stopped, then starts an outing — broadcast, review, and stop controls appear — opens the
review overlay ("No one has been reached") and closes it, and stops the outing, restoring the
start/review controls and removing stop.
