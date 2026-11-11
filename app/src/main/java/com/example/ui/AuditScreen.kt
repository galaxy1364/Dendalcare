package com.example.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Assessment
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CompareArrows
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.FilterList
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.model.AuditSeverity
import com.example.model.PlatformType
import com.example.ui.components.AuditDetailModal
import com.example.ui.components.AuditItemCard
import com.example.ui.components.AuditScoreCard
import com.example.ui.components.StackComparisonModal
import com.example.ui.theme.AmberWarning
import com.example.ui.theme.EmeraldSuccess
import com.example.ui.theme.RoseCritical

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AuditScreen(viewModel: AuditViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val isPersian = uiState.isPersianLanguage
    val layoutDirection = if (isPersian) LayoutDirection.Rtl else LayoutDirection.Ltr

    CompositionLocalProvider(LocalLayoutDirection provides layoutDirection) {
        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(
                    title = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(
                                imageVector = Icons.Default.Security,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                                modifier = Modifier.size(24.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = if (isPersian) "فوق‌ممیزی پلتفرم‌ها" else "Cross-Platform Audit",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.Bold
                            )
                        }
                    },
                    actions = {
                        IconButton(
                            onClick = { viewModel.showStackComparison(true) },
                            modifier = Modifier.testTag("action_stack_matrix")
                        ) {
                            Icon(
                                imageVector = Icons.Default.CompareArrows,
                                contentDescription = "Compare Stacks",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                        IconButton(
                            onClick = { viewModel.toggleLanguage() },
                            modifier = Modifier.testTag("action_toggle_lang")
                        ) {
                            Icon(
                                imageVector = Icons.Default.Language,
                                contentDescription = "Toggle Language",
                                tint = MaterialTheme.colorScheme.onSurface
                            )
                        }
                    },
                    colors = TopAppBarDefaults.centerAlignedTopAppBarColors(
                        containerColor = MaterialTheme.colorScheme.surface
                    )
                )
            },
            floatingActionButton = {
                FloatingActionButton(
                    onClick = {
                        val report = viewModel.generateFullReportText()
                        val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                        clipboard.setPrimaryClip(ClipData.newPlainText("Audit Report", report))
                        Toast.makeText(
                            context,
                            if (isPersian) "گزارش ممیزی در کلیپ‌بورد کپی شد" else "Audit report copied to clipboard",
                            Toast.LENGTH_SHORT
                        ).show()
                    },
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary,
                    modifier = Modifier.testTag("fab_copy_report")
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(imageVector = Icons.Default.ContentCopy, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (isPersian) "کپی گزارش کامل" else "Copy Report",
                            fontWeight = FontWeight.Bold
                        )
                    }
                }
            }
        ) { paddingValues ->
            val filteredItems = viewModel.getFilteredItems()

            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                // Header Banner
                item {
                    AuditIntroBanner(isPersian = isPersian) {
                        viewModel.showStackComparison(true)
                    }
                }

                // Platform Score Cards (Android, iOS, PWA)
                item {
                    Text(
                        text = if (isPersian) "وضعیت آمادگی به تفکیک پلتفرم:" else "Platform Readiness Status:",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                items(uiState.reports) { report ->
                    AuditScoreCard(
                        report = report,
                        isSelected = uiState.selectedPlatform == report.platform,
                        isPersian = isPersian,
                        onClick = {
                            val next = if (uiState.selectedPlatform == report.platform) null else report.platform
                            viewModel.selectPlatform(next)
                        }
                    )
                }

                // Filters Bar
                item {
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = if (isPersian) "فیلتر چک‌لیست و کمبودها:" else "Audit Checklist Filter:",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(6.dp))

                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .horizontalScroll(rememberScrollState()),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        // All Platform filter chip
                        FilterChip(
                            selected = uiState.selectedPlatform == null,
                            onClick = { viewModel.selectPlatform(null) },
                            label = { Text(if (isPersian) "تمام پلتفرم‌ها" else "All Platforms") },
                            colors = FilterChipDefaults.filterChipColors()
                        )

                        // Severity Filters
                        AuditSeverity.values().forEach { severity ->
                            val chipColor = when (severity) {
                                AuditSeverity.CRITICAL -> RoseCritical
                                AuditSeverity.WARNING -> AmberWarning
                                AuditSeverity.PASSED -> EmeraldSuccess
                                AuditSeverity.INFO -> MaterialTheme.colorScheme.primary
                            }
                            FilterChip(
                                selected = uiState.selectedSeverity == severity,
                                onClick = { viewModel.selectSeverity(severity) },
                                label = {
                                    Text(
                                        text = if (isPersian) severity.labelFa else severity.labelEn,
                                        color = if (uiState.selectedSeverity == severity) Color.White else chipColor
                                    )
                                },
                                leadingIcon = if (uiState.selectedSeverity == severity) {
                                    { Icon(Icons.Default.Check, contentDescription = null, modifier = Modifier.size(14.dp)) }
                                } else null,
                                colors = FilterChipDefaults.filterChipColors(
                                    selectedContainerColor = chipColor
                                )
                            )
                        }
                    }
                }

                // Item count header
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = if (isPersian)
                                "یافته‌های ممیزی (${filteredItems.size} مورد)"
                            else
                                "Audit Findings (${filteredItems.size} items)",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold
                        )
                    }
                }

                // Audit Items List
                items(filteredItems, key = { it.id }) { item ->
                    AuditItemCard(
                        item = item,
                        isPersian = isPersian,
                        onClick = { viewModel.openItemDetail(item) }
                    )
                }

                // Extra padding for FAB
                item {
                    Spacer(modifier = Modifier.height(72.dp))
                }
            }
        }

        // Modals
        uiState.activeItemDetail?.let { item ->
            AuditDetailModal(
                item = item,
                isPersian = isPersian,
                onDismiss = { viewModel.openItemDetail(null) }
            )
        }

        if (uiState.showStackComparisonDialog) {
            StackComparisonModal(
                comparisons = uiState.stackComparisons,
                isPersian = isPersian,
                onDismiss = { viewModel.showStackComparison(false) }
            )
        }
    }
}

@Composable
private fun AuditIntroBanner(
    isPersian: Boolean,
    onCompareClick: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceVariant
        )
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = MaterialTheme.colorScheme.primaryContainer
                ) {
                    Icon(
                        imageVector = Icons.Default.Assessment,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier
                            .padding(6.dp)
                            .size(20.dp)
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Text(
                    text = if (isPersian) "نتیجه ممیزی ساختار مخزن فعلی" else "Repository Structure Audit",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = if (isPersian)
                    "این مخزن در حال حاضر یک پروژه نیتیو اندروید (Kotlin + Compose) است. برای تولید فایل‌های آیفون (.ipa) و وب‌پیشرو (PWA) نیازمند ساختار تکمیلی است. روی هر بخش یا دکمه مقایسه کلیک کنید تا کمبودها و راهکارها را مشاهده نمایید."
                else
                    "This repo is currently a Native Android app. Generating iOS (.ipa) and Web (PWA) requires additional project shells or multiplatform migration.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
    }
}
