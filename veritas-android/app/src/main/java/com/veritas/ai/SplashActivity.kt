package com.veritas.ai

import android.animation.AnimatorSet
import android.animation.ObjectAnimator
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.veritas.ai.auth.AuthManager

class SplashActivity : AppCompatActivity() {

    companion object {
        private const val SPLASH_DELAY = 1800L
    }

    private lateinit var auth: AuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        auth = AuthManager.getInstance(this)

        // Fullscreen immersive from the start
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false)
            window.setFlags(
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
            )
        } else {
            @Suppress("DEPRECATION")
            window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                )
        }

        window.setFlags(
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS
        )

        val rootView = buildSplashUI()
        setContentView(rootView)
        animateSplash(rootView)

        // Check for deep link or shortcut data
        val deepLink = intent.data?.toString()

        Handler(Looper.getMainLooper()).postDelayed({
            // Route based on auth state + deep link
            val target = when {
                deepLink != null -> Intent(this, RouteActivity::class.java).apply {
                    putExtra("deep_link", deepLink)
                }
                auth.isLoggedIn -> Intent(this, MainActivity::class.java)
                else -> Intent(this, LoginActivity::class.java)
            }
            startActivity(target)
            overridePendingTransition(android.R.anim.fade_in, android.R.anim.fade_out)
            finish()
        }, SPLASH_DELAY)
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun buildSplashUI(): FrameLayout {
        val root = FrameLayout(this).apply {
            setBackgroundColor(0xFF0A0F1C.toInt())
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            layoutParams = FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        }

        // Logo circle
        val logoView = View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(0xFF50C878.toInt())
            }
            layoutParams = LinearLayout.LayoutParams(dp(96), dp(96)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
            }
            tag = "logo"
        }

        // Title
        val titleText = TextView(this).apply {
            text = "VERITAS"
            setTextColor(0xFF50C878.toInt())
            textSize = 36f
            typeface = Typeface.DEFAULT_BOLD
            letterSpacing = 0.2f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(20)
                gravity = Gravity.CENTER_HORIZONTAL
            }
            tag = "title"
        }

        // Subtitle
        val subtitleText = TextView(this).apply {
            text = "AI  ·  OSINT  ·  Analisis"
            setTextColor(0xFF64748B.toInt())
            textSize = 12f
            letterSpacing = 0.3f
            textAlignment = TextView.TEXT_ALIGNMENT_CENTER
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.ITALIC)
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                topMargin = dp(8)
                gravity = Gravity.CENTER_HORIZONTAL
            }
            tag = "subtitle"
        }

        container.addView(logoView)
        container.addView(titleText)
        container.addView(subtitleText)
        root.addView(container)
        return root
    }

    private fun animateSplash(root: FrameLayout) {
        val logo = root.findViewWithTag<View>("logo")
        val title = root.findViewWithTag<TextView>("title")
        val subtitle = root.findViewWithTag<TextView>("subtitle")

        logo.alpha = 0f
        logo.scaleX = 0.6f
        logo.scaleY = 0.6f
        title.alpha = 0f
        title.translationY = 20f
        subtitle.alpha = 0f
        subtitle.translationY = 20f

        // Staggered animations
        AnimatorSet().apply {
            play(
                ObjectAnimator.ofFloat(logo, "alpha", 0f, 1f).apply { duration = 600 }
            ).with(
                ObjectAnimator.ofFloat(logo, "scaleX", 0.6f, 1f).apply { duration = 600 }
            ).with(
                ObjectAnimator.ofFloat(logo, "scaleY", 0.6f, 1f).apply { duration = 600 }
            )
            startDelay = 100
            start()
        }

        AnimatorSet().apply {
            play(
                ObjectAnimator.ofFloat(title, "alpha", 0f, 1f).apply { duration = 500 }
            ).with(
                ObjectAnimator.ofFloat(title, "translationY", 20f, 0f).apply { duration = 500 }
            )
            startDelay = 500
            start()
        }

        AnimatorSet().apply {
            play(
                ObjectAnimator.ofFloat(subtitle, "alpha", 0f, 1f).apply { duration = 500 }
            ).with(
                ObjectAnimator.ofFloat(subtitle, "translationY", 20f, 0f).apply { duration = 500 }
            )
            startDelay = 700
            start()
        }
    }

    override fun onBackPressed() {
        // Prevent back press during splash
    }
}