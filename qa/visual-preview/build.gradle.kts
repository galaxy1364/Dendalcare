plugins { id("com.android.application") version "9.1.1" }
android {
    namespace = "com.minadental.visualpreview"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.aistudio.auditpro.kxmfzq.visualpreview"
        minSdk = 24
        targetSdk = 36
        versionCode = 1
        versionName = "QA-visual"
    }
}
dependencies { implementation("androidx.webkit:webkit:1.14.0") }
