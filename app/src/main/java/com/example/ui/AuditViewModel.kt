package com.example.ui

import androidx.lifecycle.ViewModel
import com.example.data.AuditRepository
import com.example.model.AuditCategory
import com.example.model.AuditCheckItem
import com.example.model.AuditSeverity
import com.example.model.PlatformAuditReport
import com.example.model.PlatformType
import com.example.model.TechStackComparison
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

data class AuditUiState(
    val selectedPlatform: PlatformType? = null, // null means overview / all
    val selectedSeverity: AuditSeverity? = null,
    val selectedCategory: AuditCategory? = null,
    val isPersianLanguage: Boolean = true,
    val activeItemDetail: AuditCheckItem? = null,
    val showStackComparisonDialog: Boolean = false,
    val showShareReportDialog: Boolean = false,
    val reports: List<PlatformAuditReport> = emptyList(),
    val items: List<AuditCheckItem> = emptyList(),
    val stackComparisons: List<TechStackComparison> = emptyList(),
    val snackbarMessage: String? = null
)

class AuditViewModel : ViewModel() {

    private val _uiState = MutableStateFlow(AuditUiState())
    val uiState: StateFlow<AuditUiState> = _uiState.asStateFlow()

    init {
        loadData()
    }

    private fun loadData() {
        val items = AuditRepository.getAuditItems()
        val reports = AuditRepository.getPlatformReports()
        val comparisons = AuditRepository.getStackComparisons()
        _uiState.update {
            it.copy(
                items = items,
                reports = reports,
                stackComparisons = comparisons
            )
        }
    }

    fun selectPlatform(platform: PlatformType?) {
        _uiState.update { it.copy(selectedPlatform = platform) }
    }

    fun selectSeverity(severity: AuditSeverity?) {
        _uiState.update {
            val next = if (it.selectedSeverity == severity) null else severity
            it.copy(selectedSeverity = next)
        }
    }

    fun selectCategory(category: AuditCategory?) {
        _uiState.update {
            val next = if (it.selectedCategory == category) null else category
            it.copy(selectedCategory = next)
        }
    }

    fun toggleLanguage() {
        _uiState.update { it.copy(isPersianLanguage = !it.isPersianLanguage) }
    }

    fun openItemDetail(item: AuditCheckItem?) {
        _uiState.update { it.copy(activeItemDetail = item) }
    }

    fun showStackComparison(show: Boolean) {
        _uiState.update { it.copy(showStackComparisonDialog = show) }
    }

    fun showShareReport(show: Boolean) {
        _uiState.update { it.copy(showShareReportDialog = show) }
    }

    fun dismissSnackbar() {
        _uiState.update { it.copy(snackbarMessage = null) }
    }

    fun getFilteredItems(): List<AuditCheckItem> {
        val state = _uiState.value
        return state.items.filter { item ->
            val matchPlatform = state.selectedPlatform == null || item.platform == state.selectedPlatform
            val matchSeverity = state.selectedSeverity == null || item.severity == state.selectedSeverity
            val matchCategory = state.selectedCategory == null || item.category == state.selectedCategory
            matchPlatform && matchSeverity && matchCategory
        }
    }

    fun generateFullReportText(): String {
        val isFa = _uiState.value.isPersianLanguage
        val reports = _uiState.value.reports
        val items = _uiState.value.items

        val sb = StringBuilder()
        if (isFa) {
            sb.appendLine("📊 گزارش فوق‌ممیزی ساختار پروژه‌های چندسکویی (APK, IPA, PWA)")
            sb.appendLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            reports.forEach { report ->
                sb.appendLine("${report.platform.iconEmoji} ${report.platform.titleFa} (${report.platform.extension}):")
                sb.appendLine("  • درصد آمادگی: ${report.readinessPercentage}%")
                sb.appendLine("  • موارد تأیید شده: ${report.passedCount}")
                sb.appendLine("  • کمبودهای حیاتی: ${report.criticalCount}")
                sb.appendLine("  • هشدارهای بهینه‌سازی: ${report.warningCount}")
                sb.appendLine("  • تحلیل: ${report.summaryFa}")
                sb.appendLine()
            }
            sb.appendLine("🚨 چک‌لیست مهم‌ترین کمبودها:")
            items.filter { it.severity == AuditSeverity.CRITICAL }.forEach { item ->
                sb.appendLine("❌ [${item.platform.titleFa}] ${item.titleFa}")
                sb.appendLine("   وضعیت: ${item.currentStatusFa}")
                sb.appendLine("   راهکار: ${item.remedyFa}")
            }
        } else {
            sb.appendLine("📊 Cross-Platform Ultra-Audit Report (APK, IPA, PWA)")
            sb.appendLine("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
            reports.forEach { report ->
                sb.appendLine("${report.platform.iconEmoji} ${report.platform.titleEn}:")
                sb.appendLine("  • Readiness: ${report.readinessPercentage}%")
                sb.appendLine("  • Passed: ${report.passedCount} / Critical: ${report.criticalCount} / Warnings: ${report.warningCount}")
                sb.appendLine("  • Summary: ${report.summaryEn}")
                sb.appendLine()
            }
        }
        return sb.toString()
    }
}
