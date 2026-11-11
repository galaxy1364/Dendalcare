package com.example

import android.os.Bundle
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.InstallMobile
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.FloatingActionButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.example.server.LocalAssetServer
import com.example.ui.AuditScreen
import com.example.ui.AuditViewModel
import com.example.ui.DentalCareWebView
import com.example.ui.components.InstallManagementModal
import com.example.ui.theme.MyApplicationTheme

class MainActivity : ComponentActivity() {

    private val auditViewModel: AuditViewModel by viewModels()
    private var assetServer: LocalAssetServer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        // Configure App Check with launch intent before any UI or Firebase operations
        configureAppCheck(this, intent)

        // Start internal local asset server for PWA/Web SPA support
        assetServer = LocalAssetServer(applicationContext, port = 8765).apply {
            start()
        }

        setContent {
            MyApplicationTheme {
                MainAppHost(
                    auditViewModel = auditViewModel,
                    onReloadServer = {
                        assetServer?.stop()
                        assetServer?.start()
                    }
                )
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        assetServer?.stop()
    }
}

@Composable
fun MainAppHost(
    auditViewModel: AuditViewModel,
    onReloadServer: () -> Unit
) {
    var showAuditScreen by remember { mutableStateOf(false) }
    var showInstallMenu by remember { mutableStateOf(false) }
    var webViewRef by remember { mutableStateOf<WebView?>(null) }
    val localAppUrl = "http://127.0.0.1:8765/index.html?v=52"

    if (showAuditScreen) {
        BackHandler {
            showAuditScreen = false
        }
        Box(modifier = Modifier.fillMaxSize()) {
            AuditScreen(viewModel = auditViewModel)

            // Return to DentalCare app button
            Surface(
                modifier = Modifier
                    .statusBarsPadding()
                    .padding(start = 16.dp, top = 8.dp)
                    .align(Alignment.TopStart),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
                shadowElevation = 4.dp
            ) {
                IconButton(onClick = { showAuditScreen = false }) {
                    Icon(
                        imageVector = Icons.Default.ArrowBack,
                        contentDescription = "بازگشت به برنامه",
                        tint = MaterialTheme.colorScheme.onPrimaryContainer
                    )
                }
            }
        }
    } else {
        Box(modifier = Modifier.fillMaxSize().background(Color(0xFF0A0E27))) {
            // Main DentalCare Web / PWA container - 100% Fullscreen native WebView with proper system bar insets
            DentalCareWebView(
                url = localAppUrl,
                modifier = Modifier
                    .fillMaxSize()
                    .statusBarsPadding()
                    .navigationBarsPadding(),
                onWebViewCreated = { webViewRef = it }
            )

            if (showInstallMenu) {
                InstallManagementModal(
                    onDismiss = { showInstallMenu = false },
                    onOpenAuditPro = { showAuditScreen = true },
                    onReloadApp = {
                        onReloadServer()
                        webViewRef?.reload()
                    }
                )
            }
        }
    }
}
