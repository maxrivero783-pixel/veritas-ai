package com.veritas.ai.fcm

import android.util.Log
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.veritas.ai.auth.AuthManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/**
 * Firebase Cloud Messaging service for Veritas AI.
 *
 * Handles:
 * - New token registration -> sends to Veritas backend
 * - Incoming push notifications -> shows system notification
 *
 * NOTE: google-services.json contains placeholder values.
 * Replace with real Firebase project config to enable FCM.
 * The app works fine without FCM, notifications are a nice-to-have.
 */
class VeritasFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val TAG = "VeritasFCM"
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        Log.d(TAG, "New FCM token received")
        sendTokenToBackend(token)
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        Log.d(TAG, "Message received from: ${message.from}")

        val title = message.notification?.title ?: "Veritas AI"
        val body = message.notification?.body ?: return
        val deepLink = message.data["deep_link"]

        NotificationHelper.createNotificationChannels(this)
        val notification = NotificationHelper.buildNotification(this, title, body, deepLink)
        val id = System.currentTimeMillis().toInt()

        val manager = getSystemService(android.content.Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.notify(id, notification)
    }

    private fun sendTokenToBackend(token: String) {
        val auth = AuthManager.getInstance(this)
        if (!auth.isLoggedIn) {
            Log.w(TAG, "Not logged in, skipping token registration")
            return
        }

        CoroutineScope(Dispatchers.IO).launch {
            try {
                auth.registerFcmToken(token)
                Log.d(TAG, "FCM token registered with backend")
            } catch (e: Exception) {
                Log.w(TAG, "Failed to register FCM token", e)
            }
        }
    }
}
