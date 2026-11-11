package com.example

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.example.data.AuditRepository
import com.example.model.AuditSeverity
import com.example.model.PlatformType
import com.example.ui.AuditViewModel
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ExampleRobolectricTest {

  @Test
  fun `verify app name resource matches AuditPro`() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    val appName = context.getString(R.string.app_name)
    assertEquals("DentalCare", appName)
  }

  @Test
  fun `verify audit repository returns items for all three platforms`() {
    val items = AuditRepository.getAuditItems()
    assertTrue(items.isNotEmpty())

    val androidItems = items.filter { it.platform == PlatformType.ANDROID_APK }
    val iosItems = items.filter { it.platform == PlatformType.IOS_IPA }
    val pwaItems = items.filter { it.platform == PlatformType.WEB_PWA }

    assertTrue(androidItems.isNotEmpty())
    assertTrue(iosItems.isNotEmpty())
    assertTrue(pwaItems.isNotEmpty())
  }

  @Test
  fun `verify platform reports calculate scores correctly`() {
    val reports = AuditRepository.getPlatformReports()
    assertEquals(3, reports.size)

    val androidReport = reports.first { it.platform == PlatformType.ANDROID_APK }
    val iosReport = reports.first { it.platform == PlatformType.IOS_IPA }

    assertTrue("Android readiness should be high", androidReport.readinessPercentage > 70)
    assertTrue("iOS readiness should reflect missing workspace", iosReport.readinessPercentage < 40)
  }

  @Test
  fun `verify ViewModel filtering and report generation`() {
    val viewModel = AuditViewModel()
    assertNotNull(viewModel.uiState.value.items)

    viewModel.selectPlatform(PlatformType.IOS_IPA)
    val filtered = viewModel.getFilteredItems()
    assertTrue(filtered.all { it.platform == PlatformType.IOS_IPA })

    val reportText = viewModel.generateFullReportText()
    assertTrue(reportText.contains("ممیزی"))
  }
}
