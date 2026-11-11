package com.example.server

import android.content.Context
import android.util.Log
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder

class LocalAssetServer(private val context: Context, val port: Int = 8765) {
    private var serverSocket: ServerSocket? = null
    @Volatile private var isRunning = false
    private var serverThread: Thread? = null

    fun start() {
        if (isRunning && serverSocket?.isClosed == false) return
        stop()
        isRunning = true
        try {
            // Bind synchronously with reuseAddress = true so rapid restarts never fail with EADDRINUSE
            val socket = ServerSocket()
            socket.reuseAddress = true
            socket.bind(InetSocketAddress("127.0.0.1", port))
            serverSocket = socket
            Log.d("LocalAssetServer", "DentalCare Local Server listening on http://127.0.0.1:$port")
        } catch (e: Exception) {
            Log.e("LocalAssetServer", "Failed to bind server socket on port $port: ${e.message}")
            isRunning = false
            return
        }

        serverThread = Thread {
            try {
                while (isRunning) {
                    val client = serverSocket?.accept() ?: break
                    Thread { handleClient(client) }.start()
                }
            } catch (e: Exception) {
                if (isRunning) {
                    Log.e("LocalAssetServer", "Server accept exception: ${e.message}")
                }
            }
        }.apply {
            isDaemon = true
            start()
        }
    }

    private fun handleClient(client: Socket) {
        try {
            client.use { socket ->
                socket.soTimeout = 8000
                val reader = socket.getInputStream().bufferedReader()
                val line = reader.readLine() ?: return
                val parts = line.split(" ")
                if (parts.size < 2 || (parts[0] != "GET" && parts[0] != "HEAD")) {
                    send404(socket)
                    return
                }

                var path = try {
                    URLDecoder.decode(parts[1].substringBefore("?"), "UTF-8")
                } catch (e: Exception) {
                    parts[1].substringBefore("?")
                }
                if (path == "/" || path.isEmpty()) path = "/index.html"
                while (path.startsWith("/") || path.startsWith("./")) {
                    path = if (path.startsWith("./")) path.substring(2) else path.substring(1)
                }
                if (path.isEmpty()) path = "index.html"
                val assetPath = "www/$path"

                val isStaticFileWithExtension = path.contains(".") && !path.endsWith(".html")

                val inputStream: InputStream? = try {
                    context.assets.open(assetPath)
                } catch (e: Exception) {
                    if (isStaticFileWithExtension) {
                        // Static asset (.js, .css, .png, etc.) is missing - send 404, DO NOT return index.html
                        null
                    } else {
                        // Fallback to index.html ONLY for SPA navigation routes
                        try { context.assets.open("www/index.html") } catch (e2: Exception) { null }
                    }
                }

                if (inputStream == null) {
                    send404(socket)
                    return
                }

                val mime = when {
                    path.endsWith(".html") -> "text/html; charset=utf-8"
                    path.endsWith(".js") || path.endsWith(".mjs") -> "application/javascript; charset=utf-8"
                    path.endsWith(".css") -> "text/css; charset=utf-8"
                    path.endsWith(".svg") -> "image/svg+xml"
                    path.endsWith(".json") || path.endsWith(".webmanifest") -> "application/json; charset=utf-8"
                    path.endsWith(".png") -> "image/png"
                    path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
                    path.endsWith(".ico") -> "image/x-icon"
                    path.endsWith(".woff2") -> "font/woff2"
                    path.endsWith(".woff") -> "font/woff"
                    path.endsWith(".ttf") -> "font/ttf"
                    path.endsWith(".apk") -> "application/vnd.android.package-archive"
                    path.endsWith(".mobileconfig") -> "application/x-apple-aspen-config"
                    else -> "application/octet-stream"
                }

                val bytes = inputStream.use { it.readBytes() }
                val out = socket.getOutputStream()
                val header = "HTTP/1.1 200 OK\r\n" +
                        "Content-Type: $mime\r\n" +
                        "Content-Length: ${bytes.size}\r\n" +
                        "Access-Control-Allow-Origin: *\r\n" +
                        "Cache-Control: no-cache\r\n" +
                        "Connection: close\r\n\r\n"
                out.write(header.toByteArray(Charsets.UTF_8))
                out.write(bytes)
                out.flush()
            }
        } catch (e: Exception) {
            // Client closed socket or timed out
        }
    }

    private fun send404(socket: Socket) {
        try {
            val out = socket.getOutputStream()
            val response = "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            out.write(response.toByteArray(Charsets.UTF_8))
            out.flush()
        } catch (e: Exception) {
            // ignore
        }
    }

    fun stop() {
        isRunning = false
        try {
            serverSocket?.close()
        } catch (e: Exception) {
            // ignore
        }
    }
}
