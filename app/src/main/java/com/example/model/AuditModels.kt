package com.example.model

enum class PlatformType(
    val titleFa: String,
    val titleEn: String,
    val iconEmoji: String,
    val extension: String
) {
    ANDROID_APK("اندروید", "Android", "🤖", ".apk / .aab"),
    IOS_IPA("آیفون", "iOS", "🍏", ".ipa"),
    WEB_PWA("وب‌پیشرو", "PWA", "🌐", "Web Manifest / SW")
}

enum class AuditSeverity(
    val labelFa: String,
    val labelEn: String,
    val weight: Int
) {
    CRITICAL("حیاتی (مانع انتشار)", "Critical Blocker", 3),
    WARNING("هشدار (کمبود فنی)", "Warning / Deficit", 2),
    PASSED("تأیید شده", "Passed / Ready", 1),
    INFO("توضیحات تکمیلی", "Informational", 0)
}

enum class AuditCategory(val titleFa: String, val titleEn: String) {
    CORE_STRUCTURE("معماری و ساختار پایه", "Core Architecture"),
    MANIFEST_METADATA("مانیفست و مشخصات", "Manifest & Identity"),
    SIGNING_SECURITY("امضا، گواهی و امنیت", "Signing & Security"),
    STORE_COMPLIANCE("قوانین و استانداردهای استور", "Store Compliance"),
    OFFLINE_HARDWARE("آفلاین و دسترسی سخت‌افزار", "Offline & Capabilities")
}

data class AuditCheckItem(
    val id: String,
    val titleFa: String,
    val titleEn: String,
    val platform: PlatformType,
    val category: AuditCategory,
    val severity: AuditSeverity,
    val descriptionFa: String,
    val descriptionEn: String,
    val currentStatusFa: String,
    val remedyFa: String,
    val codeSnippet: String? = null
)

data class PlatformAuditReport(
    val platform: PlatformType,
    val readinessPercentage: Int,
    val totalChecks: Int,
    val passedCount: Int,
    val criticalCount: Int,
    val warningCount: Int,
    val summaryFa: String,
    val summaryEn: String
)

data class TechStackComparison(
    val name: String,
    val apkSupport: String,
    val ipaSupport: String,
    val pwaSupport: String,
    val codeSharingPercentage: String,
    val performanceLevel: String,
    val recommendationFa: String
)
