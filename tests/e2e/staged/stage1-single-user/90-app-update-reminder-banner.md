# 90-app-update-reminder-banner

covers: SPEC-19.13, SPEC-10.3

Android sideload-update reminder banner: a sideloaded APK has no update channel, so the app
reminds the user when the downloads manifest publishes a newer version than the running one — a
dismissible banner linking to the APK plus a "!" badge on the Settings gear. Boots the app the
way the real Android WebView would (`?native_platform=android&app_version=`) against a mocked
manifest and asserts the full DOM lifecycle: show at boot, dismiss persisted via localStorage,
re-remind for a still-newer version, no banner when not newer or on a non-Android shell.
